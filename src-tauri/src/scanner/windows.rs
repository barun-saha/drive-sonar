//! High-performance Windows directory scanner utilizing low-level `NtQueryDirectoryFileEx` APIs.

use crate::models::DirEntry;
use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Wdk::Storage::FileSystem::{
    FileDirectoryInformation, FileFullDirectoryInformation, FileIdBothDirectoryInformation,
    FileIdExtdDirectoryInformation, FileIdFullDirectoryInformation, NtQueryDirectoryFileEx,
    FILE_INFORMATION_CLASS,
};
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

/// Fixed-size header of `FILE_ID_FULL_DIR_INFORMATION`, followed in the buffer by the UTF-16 name.
///
/// This class is used instead of `FileIdBothDirectoryInformation` because it supplies the two
/// fields the scanner needs (`AllocationSize` and `FileId`) without the 8.3 short name, which is
/// never used. `repr(C)` inserts the 4 bytes of padding between `ea_size` and `file_id`, so
/// the header is 80 bytes and the file name starts at offset 80.
#[allow(dead_code)]
#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct FileIdFullDirectoryInformationRaw {
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
    ea_size: u32,
    file_id: i64,
}

/// DIAGNOSTIC BUILD: which NT directory-information class to request and how to read it.
///
/// Selected once from the `DRIVESONAR_NT_CLASS` environment variable (`dir`, `full`, `idfull`,
/// `idboth`, `idextd`; default `idfull`). All classes share the same first 64 bytes up to
/// `FileNameLength` (offsets: write time 24, EndOfFile 40, AllocationSize 48, attributes 56,
/// name length 60); they differ in header size and in whether/where a file id is present.
#[derive(Clone, Copy)]
struct Layout {
    class: FILE_INFORMATION_CLASS,
    header: usize,
    file_id_offset: Option<usize>,
}

fn layout_for(name: Option<&str>) -> Layout {
    match name {
        Some("dir") => Layout {
            class: FileDirectoryInformation,
            header: 64,
            file_id_offset: None,
        },
        Some("full") => Layout {
            class: FileFullDirectoryInformation,
            header: 68,
            file_id_offset: None,
        },
        Some("idboth") => Layout {
            class: FileIdBothDirectoryInformation,
            header: 104,
            file_id_offset: Some(96),
        },
        Some("idextd") => Layout {
            class: FileIdExtdDirectoryInformation,
            header: 88,
            file_id_offset: Some(72),
        },
        _ => Layout {
            class: FileIdFullDirectoryInformation,
            header: 80,
            file_id_offset: Some(72),
        },
    }
}

fn layout() -> Layout {
    static LAYOUT: std::sync::OnceLock<Layout> = std::sync::OnceLock::new();
    *LAYOUT.get_or_init(|| layout_for(std::env::var("DRIVESONAR_NT_CLASS").ok().as_deref()))
}

fn read_u32(buf: &[u8], offset: usize) -> u32 {
    u32::from_ne_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
    ])
}

fn read_i64(buf: &[u8], offset: usize) -> i64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&buf[offset..offset + 8]);
    i64::from_ne_bytes(bytes)
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
    let layout = layout();

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
                    layout.class,
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

            parse_entries(&buffer[..bytes_returned], layout, &mut entries)?;
        }

        Ok(())
    })?;

    Ok(entries)
}

/// Returns true if the UTF-16 (native-endian) name bytes are exactly "." or "..".
fn is_dot_or_dotdot(name_bytes: &[u8]) -> bool {
    const DOT: [u8; 2] = 0x002E_u16.to_ne_bytes();
    match name_bytes.len() {
        2 => name_bytes == DOT,
        4 => name_bytes[..2] == DOT && name_bytes[2..] == DOT,
        _ => false,
    }
}

/// Parses raw directory header bytes from the NT system call into structured `DirEntry` items.
fn parse_entries(buf: &[u8], layout: Layout, out: &mut Vec<DirEntry>) -> io::Result<()> {
    let mut offset = 0usize;

    loop {
        if offset + layout.header > buf.len() {
            break;
        }
        let entry = &buf[offset..];
        let next_entry_offset = read_u32(entry, 0);
        let last_write_time = read_i64(entry, 24);
        let allocation_size = read_i64(entry, 48);
        let file_attributes = read_u32(entry, 56);
        let name_len = read_u32(entry, 60) as usize;
        let file_id = match layout.file_id_offset {
            Some(file_id_offset) => read_i64(entry, file_id_offset) as u64,
            None => 0,
        };

        let name_end = offset + layout.header + name_len;
        if name_end > buf.len() {
            break;
        }

        // Skip "." and ".." on the raw bytes, before allocating anything for them.
        let name_bytes = &buf[offset + layout.header..name_end];
        if !is_dot_or_dotdot(name_bytes) {
            // Decode UTF-16 straight into the final String (lossy for unpaired surrogates,
            // identical to `OsString::to_string_lossy`). This is the only per-entry
            // allocation: no intermediate Vec<u16> or OsString. The capacity is the u16
            // count, which is exact for ASCII names, so the later `into_boxed_str` does
            // not need to shrink it.
            let mut name = String::with_capacity(name_bytes.len() / 2);
            name.extend(
                char::decode_utf16(
                    name_bytes
                        .chunks_exact(2)
                        .map(|b| u16::from_ne_bytes([b[0], b[1]])),
                )
                .map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER)),
            );

            let tw = last_write_time as u64;
            let is_dir = file_attributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
            let is_reparse_point = file_attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0;
            let size = if is_dir || is_reparse_point {
                0
            } else {
                allocation_size.max(0) as u64
            };
            out.push(DirEntry {
                name,
                size,
                is_dir,
                is_reparse_point,
                modified_secs: if tw >= 116_444_736_000_000_000 {
                    (tw - 116_444_736_000_000_000) / 10_000_000
                } else {
                    0
                },
                file_id,
            });
        }

        if next_entry_offset == 0 {
            break;
        }
        offset += next_entry_offset as usize;
    }
    Ok(())
}
