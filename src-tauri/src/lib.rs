#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{collections::HashMap, path::Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use jwalk::WalkDir;
use serde::Serialize;
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use std::sync::atomic::AtomicUsize;
#[cfg(windows)]
use rayon::prelude::*;

#[derive(Debug, Serialize, Clone)]
pub struct FlatFileEntry {
    path: String,
    parent_path: String,
    name: String,
    size: u64,
    is_dir: bool,
    modified_secs: u64,
}

pub struct AppState {
    pub cancel_flag: Mutex<Arc<AtomicBool>>,
}

fn is_protected_path(path: &Path) -> bool {
    let components: Vec<_> = path.components().collect();

    #[cfg(windows)]
    let min_depth: usize = 4;
    #[cfg(not(windows))]
    let min_depth: usize = 3;

    if components.len() < min_depth {
        return true;
    }

    #[cfg(windows)]
    let top_idx: usize = 2;
    #[cfg(not(windows))]
    let top_idx: usize = 1;

    if let Some(top) = components.get(top_idx) {
        let name = top.as_os_str().to_string_lossy().to_ascii_lowercase();

        #[cfg(windows)]
        let blocked: &[&str] = &[
            "windows", "system32", "syswow64", "program files",
            "program files (x86)", "programdata", "recovery", "boot",
            "$recycle.bin", "system volume information",
        ];

        #[cfg(target_os = "macos")]
        let blocked: &[&str] = &[
            "bin", "sbin", "usr", "etc", "lib",
            "dev", "private", "system", "library", "cores", "volumes",
        ];

        #[cfg(all(not(windows), not(target_os = "macos")))]
        let blocked: &[&str] = &[
            "bin", "sbin", "usr", "etc", "lib", "lib64", "lib32",
            "boot", "dev", "proc", "sys", "run", "tmp", "var",
            "root", "snap", "lost+found",
        ];

        if blocked.contains(&name.as_str()) {
            return true;
        }
    }

    false
}

#[cfg(windows)]
mod windows_scanner {
    use std::ffi::c_void;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::PCWSTR;
    use windows::Wdk::Storage::FileSystem::{FileDirectoryInformation, NtQueryDirectoryFileEx};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, STATUS_NO_MORE_FILES, STATUS_SUCCESS};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_LIST_DIRECTORY, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::IO::IO_STATUS_BLOCK;

    // Starting buffer size for each NtQueryDirectoryFileEx call. Bumped from 64KB to
    // 256KB: cuts down on the "buffer too small, retry" round trip for directories
    // with unusually many or long-named entries. Cheap to increase further if needed
    // (memory cost is trivial even multiplied across many parallel threads), but this
    // is a secondary lever compared to reducing the number of directory calls overall.
    const INITIAL_QUERY_BUFFER_SIZE: usize = 256 * 1024;

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

    #[derive(Clone)]
    pub struct DirEntry {
        pub name: String,
        pub size: u64,
        pub is_dir: bool,
        pub is_reparse_point: bool,
        pub modified_secs: u64,
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

    // NOTE: this function is unchanged from before, aside from the initial buffer
    // size constant above. Each call to list_directory opens its own fresh HANDLE
    // (via open_directory), so this remains safe to call concurrently from multiple
    // threads -- no HANDLE is ever shared across threads.
    pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
        let guard = open_directory(path)?;
        let mut buffer: Vec<u8> = vec![0u8; INITIAL_QUERY_BUFFER_SIZE];
        let mut entries = Vec::new();
        let mut restart_scan = true;

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
            const MAX_QUERY_BUFFER_SIZE: usize = 16 * 1024 * 1024;
            if status.0 == STATUS_BUFFER_OVERFLOW {
                if buffer.len() >= MAX_QUERY_BUFFER_SIZE {
                    return Err(io::Error::new(
                        io::ErrorKind::OutOfMemory,
                        "NtQueryDirectoryFileEx buffer exceeded maximum limit (16MB)",
                    ));
                }
                let new_len = buffer.len() * 2;
                buffer.resize(new_len, 0);
                continue;
            }

            if status != STATUS_SUCCESS {
                return Err(io::Error::other(format!(
                    "NtQueryDirectoryFileEx failed with NTSTATUS 0x{:08X}",
                    status.0 as u32
                )));
            }

            let bytes_returned = iosb.Information as usize;
            if bytes_returned == 0 {
                break;
            }

            parse_entries(&buffer[..bytes_returned], &mut entries)?;
        }

        Ok(entries)
    }

    fn parse_entries(buf: &[u8], out: &mut Vec<DirEntry>) -> io::Result<()> {
        const HEADER_SIZE: usize = std::mem::size_of::<FileDirectoryInformationRaw>();
        let mut offset = 0usize;
        let mut guard_iterations = 0usize;
        const MAX_ITERATIONS: usize = 1_000_000;

        loop {
            guard_iterations += 1;
            if guard_iterations > MAX_ITERATIONS {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "directory buffer parsing exceeded sane iteration count"));
            }

            if offset + HEADER_SIZE > buf.len() {
                break;
            }

            let header_ptr = unsafe { buf.as_ptr().add(offset) as *const FileDirectoryInformationRaw };
            let header = unsafe { std::ptr::read_unaligned(header_ptr) };

            let name_len_bytes = header.file_name_length as usize;
            let name_start = offset + HEADER_SIZE;
            let name_end = name_start.checked_add(name_len_bytes).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "file name length overflow")
            })?;

            if name_end > buf.len() { break; }

            if name_len_bytes % 2 == 0 {
                let name_slice = &buf[name_start..name_end];
                let utf16: Vec<u16> = name_slice
                    .chunks_exact(2)
                    .map(|b| u16::from_ne_bytes([b[0], b[1]]))
                    .collect();
                let name = String::from_utf16_lossy(&utf16);

                if name != "." && name != ".." {
                    let is_dir = header.file_attributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
                    let is_reparse = header.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0;

                    let tw = header.last_write_time as u64;
                    let modified_secs = if tw >= 116_444_736_000_000_000 {
                        (tw - 116_444_736_000_000_000) / 10_000_000
                    } else { 0 };

                    out.push(DirEntry {
                        name,
                        size: header.end_of_file.max(0) as u64,
                        is_dir,
                        is_reparse_point: is_reparse,
                        modified_secs,
                    });
                }
            } else {
                eprintln!("Skipping entry with odd name byte length: {}", name_len_bytes);
            }

            if header.next_entry_offset == 0 { break; }

            let next_offset = offset.checked_add(header.next_entry_offset as usize).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "next entry offset overflow")
            })?;

            if next_offset <= offset { break; }
            offset = next_offset;
        }

        Ok(())
    }
}

// --- NEW: parallel, hashmap-free recursive scan ---
//
// Replaces the old explicit-queue + HashMap<String,u64> approach. Each call:
//   1. Lists its own directory's immediate entries.
//   2. Recurses into subdirectories in parallel via rayon.
//   3. Sums its own files' sizes + each subdirectory's already-aggregated total
//      (returned from step 2) -- no path hashing, no ancestor walk-up.
//   4. Writes all of this directory's entries (its files + itself) to the shared
//      output list in ONE locked batch, not one lock per file.
//
// This function borrows cancel_flag / skipped_count / sink for the duration of
// the call; that's sound because rayon's .collect() below is fully synchronous --
// it blocks until all parallel work finishes before this function's stack frame
// returns, so nothing outlives the borrow. No unsafe code in this function.
#[cfg(windows)]
fn scan_dir_parallel(
    dir_path: &Path,
    name: &str,
    parent_path_str: &str,
    modified_secs: u64,
    is_reparse_point: bool,
    cancel_flag: &AtomicBool,
    skipped_count: &AtomicUsize,
    sink: &Mutex<Vec<FlatFileEntry>>,
    depth: usize,
) -> Result<u64, String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Scan was cancelled".to_string());
    }

    const MAX_SCAN_DEPTH: usize = 256;
    if depth > MAX_SCAN_DEPTH {
        skipped_count.fetch_add(1, Ordering::Relaxed);
        eprintln!("Skipped path exceeding max depth ({}): {:?}", MAX_SCAN_DEPTH, dir_path);
        return Ok(0);
    }

    let this_path_str = dir_path.to_string_lossy().into_owned();

    // Reparse points (junctions/symlinks): record but don't recurse, to avoid
    // double-counting shared targets or cycles from self-referential junctions.
    if is_reparse_point {
        sink.lock().unwrap().push(FlatFileEntry {
            path: this_path_str,
            parent_path: parent_path_str.to_string(),
            name: name.to_string(),
            size: 0,
            is_dir: true,
            modified_secs,
        });
        return Ok(0);
    }

    let dir_entries = match windows_scanner::list_directory(dir_path) {
        Ok(e) => e,
        Err(e) => {
            // Inaccessible directory: skip it, don't fail the whole scan.
            skipped_count.fetch_add(1, Ordering::Relaxed);
            eprintln!("Skipped inaccessible path {:?}: {}", dir_path, e);
            sink.lock().unwrap().push(FlatFileEntry {
                path: this_path_str,
                parent_path: parent_path_str.to_string(),
                name: name.to_string(),
                size: 0,
                is_dir: true,
                modified_secs,
            });
            return Ok(0);
        }
    };

    let mut local_batch: Vec<FlatFileEntry> = Vec::with_capacity(dir_entries.len() + 1);
    let mut own_total: u64 = 0;
    let mut subdirs: Vec<windows_scanner::DirEntry> = Vec::new();

    for entry in dir_entries {
        if entry.is_dir {
            subdirs.push(entry);
        } else {
            own_total += entry.size;
            local_batch.push(FlatFileEntry {
                path: dir_path.join(&entry.name).to_string_lossy().into_owned(),
                parent_path: this_path_str.clone(),
                name: entry.name,
                size: entry.size,
                is_dir: false,
                modified_secs: entry.modified_secs,
            });
        }
    }

    // Recurse into subdirectories in parallel. Each returns its own aggregated
    // total; the '?' short-circuits promptly on cancellation (already-dispatched
    // closures still run to their next cancel_flag check, so cancellation is
    // cooperative and near-immediate, not instantaneous).
    let subdir_totals: Vec<u64> = subdirs
        .into_par_iter()
        .map(|entry| {
            let child_path = dir_path.join(&entry.name);
            scan_dir_parallel(
                &child_path,
                &entry.name,
                &this_path_str,
                entry.modified_secs,
                entry.is_reparse_point,
                cancel_flag,
                skipped_count,
                sink,
                depth + 1,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    own_total += subdir_totals.iter().sum::<u64>();

    local_batch.push(FlatFileEntry {
        path: this_path_str,
        parent_path: parent_path_str.to_string(),
        name: name.to_string(),
        size: own_total,
        is_dir: true,
        modified_secs,
    });

    // One lock, one batch write, per directory -- not per file.
    sink.lock().unwrap().extend(local_batch);

    Ok(own_total)
}

#[cfg(windows)]
fn init_rayon_thread_pool() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let cpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let threads = cpus.saturating_sub(1).max(1);
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global();
    });
}

#[cfg(windows)]
fn fast_scan_windows(
    app: &tauri::AppHandle,
    base_path: &Path,
    cancel_flag: &AtomicBool,
) -> Result<Vec<FlatFileEntry>, String> {
    let root_name = base_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| base_path.to_string_lossy().into_owned());

    let root_parent = base_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    let root_modified_secs = std::fs::metadata(base_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let skipped_count = AtomicUsize::new(0);
    let sink: Mutex<Vec<FlatFileEntry>> = Mutex::new(Vec::new());

    scan_dir_parallel(
        base_path,
        &root_name,
        &root_parent,
        root_modified_secs,
        false,
        cancel_flag,
        &skipped_count,
        &sink,
        0,
    )?;

    let skipped = skipped_count.load(Ordering::Relaxed);
    if skipped > 0 {
        let _ = app.emit(
            "scan-warning",
            format!("{} location(s) were inaccessible and skipped.", skipped),
        );
    }

    // Recover the data even if some thread panicked mid-lock elsewhere (poisoned
    // mutex), rather than losing an otherwise-complete scan over an unrelated panic.
    Ok(sink.into_inner().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

#[tauri::command]
async fn scan_directory(app: tauri::AppHandle, target_path: String, state: State<'_, AppState>) -> Result<Vec<FlatFileEntry>, String> {
    let scan_cancel_flag = {
        let mut guard = state.cancel_flag.lock().unwrap();
        guard.store(true, Ordering::Relaxed);
        let new_flag = Arc::new(AtomicBool::new(false));
        *guard = new_flag.clone();
        new_flag
    };

    let input_path = Path::new(&target_path);
    if !input_path.exists() {
        return Err(format!("Target path {} doesn't exist!", target_path));
    }

    let canonical = input_path
        .canonicalize()
        .map_err(|e| format!("Could not resolve path '{}': {}", target_path, e))?;

    #[cfg(windows)]
    let base_path = {
        let s = canonical.to_string_lossy();
        if s.starts_with(r"\\?\") {
            std::path::PathBuf::from(s[4..].to_string())
        } else {
            canonical
        }
    };
    #[cfg(not(windows))]
    let base_path = canonical;

    #[cfg(windows)]
    {
        init_rayon_thread_pool();
        let app_handle = app.clone();
        let base_path_buf = base_path.clone();
        let cancel_flag_clone = scan_cancel_flag.clone();

        let scan_res = tokio::task::spawn_blocking(move || {
            fast_scan_windows(&app_handle, &base_path_buf, &cancel_flag_clone)
        })
        .await;

        match scan_res {
            Ok(Ok(entries)) => return Ok(entries),
            Ok(Err(e)) if scan_cancel_flag.load(Ordering::Relaxed) || e == "Scan was cancelled" => {
                return Err("Scan was cancelled".to_string());
            }
            Ok(Err(e)) => {
                let msg = format!("Fast scan failed ({}), gracefully falling back to standard scanner...", e);
                eprintln!("{}", msg);
                let _ = app.emit("scan-warning", msg);
            }
            Err(_e) if scan_cancel_flag.load(Ordering::Relaxed) => {
                return Err("Scan was cancelled".to_string());
            }
            Err(e) => {
                let msg = format!("Fast scan task panicked ({}), gracefully falling back to standard scanner...", e);
                eprintln!("{}", msg);
                let _ = app.emit("scan-warning", msg);
            }
        }
    }

    // --- jwalk Fallback logic (unchanged) ---
    let mut entries: Vec<FlatFileEntry> = Vec::new();
    let mut dir_sizes: HashMap<String, u64> = HashMap::new();

    for entry_result in WalkDir::new(&base_path).follow_links(false) {
        if scan_cancel_flag.load(Ordering::Relaxed) {
          return Err("Scan was cancelled".into());
        }

        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                let msg = format!("Skipped path due to read error: {}", e);
                eprintln!("{}", msg);
                let _ = app.emit("scan-warning", msg);
                continue;
            }
        };

        let file_path = entry.path();
        let is_dir = entry.file_type.is_dir();
        let mut size: u64 = 0;
        let mut modified_secs: u64 = 0;

        if !is_dir {
            if let Ok(metadata) = entry.metadata() {
                size = metadata.len();
                if let Ok(time) = metadata.modified() {
                  if let Ok(duration) = time.duration_since(std::time::UNIX_EPOCH) {
                    modified_secs = duration.as_secs();
                  }
                }
            }
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let parent_path = file_path
            .parent()
            .map_or("".to_string(), |p| p.to_string_lossy().into_owned());
        let path_str = file_path.to_string_lossy().into_owned();

        if !is_dir && size > 0 {
          let mut current_parent = file_path.parent();

          while let Some(p) = current_parent {
            if !p.starts_with(&base_path) { break; }

            let p_str = p.to_string_lossy().into_owned();
            *dir_sizes.entry(p_str).or_insert(0) += size;
            current_parent = p.parent();
          }
        }

        entries.push(FlatFileEntry {
            path: path_str,
            parent_path,
            name,
            size,
            is_dir,
            modified_secs,
        });
    }

    for entry in &mut entries {
        if entry.is_dir {
            entry.size = *dir_sizes.get(&entry.path).unwrap_or(&0);
        }
    }

    Ok(entries)
}

#[tauri::command]
fn open_in_explorer(app: tauri::AppHandle, path_str: String, is_dir: bool) -> Result<(), String> {
  let path = Path::new(&path_str);
  if !path.exists() {
    return Err(format!("Target path {} does not exist!", path_str));
  }

  let canonical = path
    .canonicalize()
    .map_err(|e| format!("Could not resolve path '{}': {}", path_str, e))?;

  #[cfg(windows)]
  let target_str = {
    let s = canonical.to_string_lossy();
    if s.starts_with(r"\\?\") {
      s[4..].to_string()
    } else {
      s.to_string()
    }
  };
  #[cfg(not(windows))]
  let target_str = canonical.to_string_lossy().to_string();

  if is_dir {
    app.opener()
      .open_path(&target_str, None::<&str>)
      .map_err(|e| e.to_string())?;
  } else {
    app.opener()
      .reveal_item_in_dir(&target_str)
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

#[tauri::command]
fn move_to_trash(path_str: String) -> Result<(), String> {
    let path = Path::new(&path_str);
    if !path.exists() {
        return Err(format!("Target location path {} does not exist!", path.display()));
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Could not resolve path '{}': {}", path_str, e))?;

    if is_protected_path(&canonical) {
        return Err(format!(
            "Refusing to delete protected or system path: {}",
            canonical.display()
        ));
    }

    trash::delete(&canonical).map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    let flag = state.cancel_flag.lock().unwrap().clone();
    flag.store(true, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_directory, open_in_explorer, move_to_trash, cancel_scan])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
