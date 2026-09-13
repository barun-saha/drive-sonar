//! Linux-specific directory scanner.
//!
//! Strategy: open the directory once, then batch-read its entries with the raw
//! `getdents64` syscall into a large, thread-local, reusable buffer. Sizes and
//! timestamps come from `fstatat` issued *relative to the open directory fd*,
//! so the kernel never re-resolves the full path for each child.
//!
//! This is filesystem-agnostic: `getdents64`/`fstatat` live in the kernel's VFS
//! layer, so ext4, btrfs, xfs, zfs, overlayfs and NFS all work identically.
//! Any unsupported/odd condition falls back to the portable `read_dir` version.

use crate::models::DirEntry;
use std::io;
use std::path::Path;

// ---------------------------------------------------------------------------
// 32-bit targets: `libc::stat` can carry a 32-bit `st_size` (files >2 GiB would
// be reported wrong). Not worth the risk — just use the portable path there.
// ---------------------------------------------------------------------------
#[cfg(not(target_pointer_width = "64"))]
pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
    super::default::list_directory(path)
}

#[cfg(target_pointer_width = "64")]
pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
    match fast::list_directory(path) {
        Ok(entries) => Ok(entries),
        // Kernel/sandbox doesn't support the raw syscall path -> portable fallback
        Err(e) if fast::is_unsupported(&e) => super::default::list_directory(path),
        // Real errors (EACCES, ENOENT, ...) propagate; the caller counts them as skipped
        Err(e) => Err(e),
    }
}

#[cfg(target_pointer_width = "64")]
mod fast {
    use super::*;
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    /// Buffer handed to `getdents64`. Bigger buffer = fewer syscalls per directory
    const DENTS_BUF_SIZE: usize = 64 * 1024;

    /// Byte offsets inside `struct linux_dirent64` (kernel ABI, identical on all architectures):
    ///   0..8   d_ino    (u64)
    ///   8..16  d_off    (i64)
    ///   16..18 d_reclen (u16)  — total size of this record
    ///   18     d_type   (u8)   — DT_DIR / DT_REG / DT_LNK / DT_UNKNOWN ...
    ///   19..   d_name   (NUL-terminated bytes, padded to 8-byte alignment)
    const D_RECLEN_OFF: usize = 16;
    const D_TYPE_OFF: usize = 18;
    const D_NAME_OFF: usize = 19;

    // Reused across every directory a given rayon worker thread scans, so we
    // don't allocate 64 KB per call. Stale bytes are never read: we only parse
    // `&buf[..n]` where `n` is what the syscall reported.
    std::thread_local! {
        static DENTS_BUF: std::cell::RefCell<Vec<u8>> =
            std::cell::RefCell::new(vec![0u8; DENTS_BUF_SIZE]);
    }

    /// RAII wrapper so the directory fd is always closed, even on early return/panic
    struct FdGuard(libc::c_int);

    impl Drop for FdGuard {
        fn drop(&mut self) {
            unsafe {
                libc::close(self.0);
            }
        }
    }

    /// True if the error means "this fast path isn't available here", not
    /// "this directory is unreadable"
    pub fn is_unsupported(e: &io::Error) -> bool {
        matches!(
            e.raw_os_error(),
            Some(libc::ENOSYS) | Some(libc::EINVAL) | Some(libc::EPERM) | Some(libc::ENOTSUP)
        )
    }

    pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
        // Paths with an interior NUL can't be passed to the kernel
        let c_path = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL byte"))?;

        // O_DIRECTORY: fail fast if it's not a directory. O_CLOEXEC: don't leak fd to children
        let fd = unsafe {
            libc::open(
                c_path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let dir = FdGuard(fd);

        let mut entries: Vec<DirEntry> = Vec::with_capacity(64);

        DENTS_BUF.with(|cell| -> io::Result<()> {
            let mut buf = cell.borrow_mut();

            loop {
                // Raw syscall: glibc only grew a `getdents64` wrapper in 2.30 and
                // musl doesn't expose one, so we call it directly
                let n = unsafe {
                    libc::syscall(
                        libc::SYS_getdents64,
                        dir.0,
                        buf.as_mut_ptr() as *mut libc::c_void,
                        buf.len() as libc::size_t,
                    )
                };

                if n < 0 {
                    let err = io::Error::last_os_error();
                    // Interrupted by a signal — just retry
                    if err.raw_os_error() == Some(libc::EINTR) {
                        continue;
                    }
                    return Err(err);
                }
                if n == 0 {
                    break; // No more entries
                }

                parse_dents(&buf[..n as usize], dir.0, &mut entries);
            }

            Ok(())
        })?;

        Ok(entries)
    }

    /// Walks the packed `linux_dirent64` records in `buf` and appends them to `out`
    fn parse_dents(buf: &[u8], dirfd: libc::c_int, out: &mut Vec<DirEntry>) {
        let mut off = 0usize;

        while off + D_NAME_OFF <= buf.len() {
            let reclen =
                u16::from_ne_bytes([buf[off + D_RECLEN_OFF], buf[off + D_RECLEN_OFF + 1]]) as usize;

            // Guard against a malformed/truncated record
            if reclen < D_NAME_OFF || off + reclen > buf.len() {
                break;
            }

            let d_type = buf[off + D_TYPE_OFF];
            let name_start = off + D_NAME_OFF;
            let name_region = &buf[name_start..off + reclen];

            // d_name is NUL-terminated inside the record (kernel pads the rest)
            let Some(nul_pos) = name_region.iter().position(|&b| b == 0) else {
                off += reclen; // Shouldn't happen; skip defensively
                continue;
            };
            let name_bytes = &name_region[..nul_pos];

            if name_bytes == b"." || name_bytes == b".." {
                off += reclen;
                continue;
            }

            // The name is already NUL-terminated in place, so we can hand the
            // kernel a pointer straight into the buffer — no CString allocation
            let name_ptr = unsafe { buf.as_ptr().add(name_start) } as *const libc::c_char;

            // Cheap type hints from d_type; some filesystems report DT_UNKNOWN,
            // in which case we derive the type from st_mode below
            let mut is_dir = d_type == libc::DT_DIR;
            let mut is_symlink = d_type == libc::DT_LNK;

            let mut size: u64 = 0;
            let mut modified_secs: u64 = 0;

            // fstatat relative to dirfd: the kernel resolves only this one name,
            // not the whole path. AT_SYMLINK_NOFOLLOW matches std's DirEntry
            // semantics (stat the link itself, never its target)
            let mut st: libc::stat = unsafe { std::mem::zeroed() };
            let rc = unsafe { libc::fstatat(dirfd, name_ptr, &mut st, libc::AT_SYMLINK_NOFOLLOW) };

            if rc == 0 {
                if d_type == libc::DT_UNKNOWN {
                    let fmt = st.st_mode & libc::S_IFMT;
                    is_dir = fmt == libc::S_IFDIR;
                    is_symlink = fmt == libc::S_IFLNK;
                }
                if !is_dir {
                    size = st.st_size.max(0) as u64;
                }
                modified_secs = st.st_mtime.max(0) as u64;
            }
            // If stat failed (permissions, or the file vanished mid-scan) we keep
            // the entry with size/mtime 0 — same behaviour as the default scanner

            out.push(DirEntry {
                // Linux filenames are arbitrary bytes; lossy conversion keeps
                // parity with the default scanner's `to_string_lossy`
                name: String::from_utf8_lossy(name_bytes).into_owned(),
                size,
                is_dir,
                is_reparse_point: is_symlink,
                modified_secs,
            });

            off += reclen;
        }
    }
}
