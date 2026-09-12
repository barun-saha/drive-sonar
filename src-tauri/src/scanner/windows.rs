//! High-performance Windows directory scanner utilizing low-level `NtQueryDirectoryFileEx` APIs.

use crate::models::DirEntry;
use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Wdk::Storage::FileSystem::{FileDirectoryInformation, NtQueryDirectoryFileEx};
use windows::Win32::Foundation::{CloseHandle, HANDLE, STATUS_NO_MORE_FILES, STATUS_SUCCESS};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::IO::IO_STATUS_BLOCK;

const INITIAL_QUERY_BUFFER_SIZE: usize = 64 * 1024;

// Reused across every directory a given rayon worker thread scans, instead of
// allocating a fresh 64KB (or larger, if previously grown) buffer per call.
// Safe to reuse without re-zeroing: parse_entries only ever reads
// `&buffer[..bytes_returned]`, where bytes_returned comes from the syscall's
// own iosb.Information, so stale bytes in the unused tail are never read.
std::thread_local! {
    static SCAN_BUFFER: std::cell::RefCell<Vec<u8>> =
        std::cell::RefCell::new(vec![0u8; INITIAL_QUERY_BUFFER_SIZE]);
}

#[repr(C)]
#[derive(Copy, Clone)]
struct FileDirectoryInformationRaw {
    next_entry_offset: u32,
    file_index: u32,
    creation_time: i64,
    last_access_time: i64,
    last_write_time: i64,
    change_time: i64,
    end_of_file: i64,
    allocation_size: i64,
    file_attributes: u32,
    file_name_length: u32,
}

struct HandleGuard(HANDLE);
impl Drop for HandleGuard {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

/// Opens a directory handle configured for listing query operations on Windows.
fn open_directory(path: &Path) -> io::Result<HandleGuard> {
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            FILE_LIST_DIRECTORY.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|e| io::Error::from_raw_os_error(e.code().0))?;

    if handle.is_invalid() {
        return Err(io::Error::last_os_error());
    }
    Ok(HandleGuard(handle))
}

/// Lists entries in a directory using low-level Windows `NtQueryDirectoryFileEx` calls.
pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
    let guard = open_directory(path)?;
    let mut entries = Vec::new();
    let mut restart_scan = true;

    SCAN_BUFFER.with(|cell| -> io::Result<()> {
        let mut buffer = cell.borrow_mut();

        loop {
            let mut iosb = IO_STATUS_BLOCK::default();
            let status = unsafe {
                NtQueryDirectoryFileEx(
                    guard.0,
                    None,
                    None,
                    None,
                    &mut iosb,
                    buffer.as_mut_ptr() as *mut c_void,
                    buffer.len() as u32,
                    FileDirectoryInformation,
                    if restart_scan { 0x00000001 } else { 0 },
                    None,
                )
            };
            restart_scan = false;

            if status == STATUS_NO_MORE_FILES {
                break;
            }

            const STATUS_BUFFER_OVERFLOW: i32 = 0x80000005u32 as i32;
            const STATUS_BUFFER_TOO_SMALL: i32 = 0xC0000023u32 as i32;
            if status.0 == STATUS_BUFFER_OVERFLOW || status.0 == STATUS_BUFFER_TOO_SMALL {
                if buffer.len() >= 16 * 1024 * 1024 {
                    return Err(io::Error::new(
                        io::ErrorKind::OutOfMemory,
                        "Buffer overflow",
                    ));
                }
                let new_len = buffer.len() * 2;
                buffer.resize(new_len, 0);
                continue;
            }

            if status != STATUS_SUCCESS {
                return Err(io::Error::other(format!(
                    "NTSTATUS failure: 0x{:08X}",
                    status.0 as u32
                )));
            }
            let bytes_returned = iosb.Information;
            if bytes_returned == 0 {
                break;
            }

            parse_entries(&buffer[..bytes_returned], &mut entries)?;
        }

        Ok(())
    })?;

    Ok(entries)
}

/// Parses raw directory header bytes from the NT system call into structured `DirEntry` items.
fn parse_entries(buf: &[u8], out: &mut Vec<DirEntry>) -> io::Result<()> {
    const HEADER_SIZE: usize = std::mem::size_of::<FileDirectoryInformationRaw>();
    let mut offset = 0usize;

    loop {
        if offset + HEADER_SIZE > buf.len() {
            break;
        }
        let header_ptr =
            unsafe { buf.as_ptr().add(offset) as *const FileDirectoryInformationRaw };
        let header = unsafe { std::ptr::read_unaligned(header_ptr) };

        let name_len = header.file_name_length as usize;
        let name_end = offset + HEADER_SIZE + name_len;
        if name_end > buf.len() {
            break;
        }

        // Decode UTF-16 directly from the byte-pair iterator: no intermediate
        // Vec<u16> allocation per entry (previously ~1 extra alloc/file).
        // Note: buf is a &[u8], so we can't reinterpret it as &[u16] via a raw
        // pointer cast (that requires 2-byte alignment we can't guarantee at
        // arbitrary offsets); decode_utf16 avoids that unsafety entirely while
        // still being allocation-free for the u16 collection step.
        let name: String = char::decode_utf16(
            buf[offset + HEADER_SIZE..name_end]
                .chunks_exact(2)
                .map(|b| u16::from_ne_bytes([b[0], b[1]])),
        )
        .map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect();

        if name != "." && name != ".." {
            let tw = header.last_write_time as u64;
            out.push(DirEntry {
                name,
                size: header.end_of_file.max(0) as u64,
                is_dir: header.file_attributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0,
                is_reparse_point: header.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0,
                modified_secs: if tw >= 116_444_736_000_000_000 {
                    (tw - 116_444_736_000_000_000) / 10_000_000
                } else {
                    0
                },
            });
        }

        if header.next_entry_offset == 0 {
            break;
        }
        offset += header.next_entry_offset as usize;
    }
    Ok(())
}
