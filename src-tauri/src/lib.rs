#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{collections::HashMap, path::Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use jwalk::WalkDir;
use serde::Serialize;
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Serialize)]
struct FlatFileEntry {
    path: String,
    parent_path: String,
    name: String,
    size: u64,
    is_dir: bool,
    modified_secs: u64,
}

pub struct AppState {
  pub cancel_flag: Arc<AtomicBool>,
}

/// Returns `true` if the path should be refused for deletion.
///
/// Uses a two-layer check compiled per platform at build time:
///
/// **Layer 1 — Minimum depth**: rejects paths that are too shallow.
///   - Windows: requires ≥ 4 components, e.g. `C:\Users\john` (4) is OK,
///     `C:\Windows` (3) and `C:\Users` (3) are blocked.
///   - Unix: requires ≥ 3 components, e.g. `/home/user` (3) is OK,
///     `/etc` (2) and `/home` (2) are blocked.
///
/// **Layer 2 — Top-level blocklist**: rejects paths whose first directory
///   component is a known OS-owned root (e.g. `windows`, `usr`, `etc`).
///   This catches deeper paths like `C:\Windows\System32\kernel32.dll`
///   or `/usr/local/bin` that pass the depth check.
///
/// Note: this is intentionally conservative. It cannot enumerate every
/// system-critical path across all distros and configurations, but it
/// prevents the most dangerous operations (drive roots, OS directories).
///
/// # Arguments
/// * path: The reference to the canonicalized Path to check.
///
/// # Returns
/// A boolean indicating if the path is protected.
fn is_protected_path(path: &Path) -> bool {
    let components: Vec<_> = path.components().collect();

    // Minimum component depth before deletion is allowed.
    //   Windows: [Prefix("C:"), RootDir, Normal("Users"), Normal("john")]  = 4 → OK
    //            [Prefix("C:"), RootDir, Normal("Windows")]                = 3 → blocked
    //   Unix:    [RootDir, Normal("home"), Normal("user")]                 = 3 → OK
    //            [RootDir, Normal("etc")]                                  = 2 → blocked
    #[cfg(windows)]
    let min_depth: usize = 4;
    #[cfg(not(windows))]
    let min_depth: usize = 3;

    if components.len() < min_depth {
        return true;
    }

    // Index of the "top-level" directory (first Normal component after the root).
    //   Windows: [Prefix, RootDir, Normal("top"), ...] → index 2
    //   Unix:    [RootDir, Normal("top"), ...]         → index 1
    #[cfg(windows)]
    let top_idx: usize = 2;
    #[cfg(not(windows))]
    let top_idx: usize = 1;

    if let Some(top) = components.get(top_idx) {
        let name = top.as_os_str().to_string_lossy().to_ascii_lowercase();

        #[cfg(windows)]
        let blocked: &[&str] = &[
            "windows",
            "system32",
            "syswow64",
            "program files",
            "program files (x86)",
            "programdata",
            "recovery",
            "boot",
            "$recycle.bin",
            "system volume information",
        ];

        #[cfg(target_os = "macos")]
        let blocked: &[&str] = &[
            "bin", "sbin", "usr", "etc", "lib",
            "dev", "private", "system", "library", "cores", "volumes",
        ];

        // Linux and other Unix-like systems
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

#[tauri::command]
/// Scans a directory tree in parallel and computes total directory sizes.
///
/// Traverses the filesystem starting from the target path using parallel
/// worker threads via `jwalk`. Aggregates individual file sizes upward through all parent
/// directories up to the scan root, ensuring directory entries reflect their
/// total recursive storage footprint.
///
/// # Arguments
/// * `app`: The Tauri application handle used to emit warning events during traversal.
/// * `target_path`: The absolute string path of the directory root to scan.
/// * `state`: Managed application state containing the atomic cancellation flag.
///
/// # Returns
/// A `Result` containing a `Vec<FlatFileEntry>` array on success,
/// or an error `String` if the path does not exist, cannot be resolved, or if the scan was cancelled.
async fn scan_directory(app: tauri::AppHandle, target_path: String, state: State<'_, AppState>) -> Result<Vec<FlatFileEntry>, String> {
    // Reset the flag to false before starting a new scan
    state.cancel_flag.store(false, Ordering::Relaxed);

    let input_path = Path::new(&target_path);
    if !input_path.exists() {
        return Err(format!("Target path {} doesn't exist!", target_path));
    }

    // Canonicalize resolves '..' traversal components and symlinks,
    // preventing a crafted path like /home/user/../../etc from escaping the intended scan root
    let canonical = input_path
        .canonicalize()
        .map_err(|e| format!("Could not resolve path '{}': {}", target_path, e))?;

    // On Windows, canonicalize() prepends a \\?\ extended-length prefix;
    // strip it so all paths returned to the frontend are in the conventional
    // C:\... form and match the currentViewPath the frontend already holds
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

    // All file items and sizes
    let mut entries: Vec<FlatFileEntry> = Vec::new();
    // A HashMap<String, u64> mapping paths to aggregated sizes
    let mut dir_sizes: HashMap<String, u64> = HashMap::new();

    // Pass 1: Collect entries and aggregate file sizes upward
    for entry_result in WalkDir::new(&base_path).follow_links(false) {
        // QUICK CHECK: Did the frontend ask us to cancel?
        if state.cancel_flag.load(Ordering::Relaxed) {
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
                // Safely extract the modification time
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

        // If this entry is a file and its size > 0, walk up its ancestor chain:
        // start at `file_path.parent()` and loop upwards.
        // Inside the loop:
        //   - Break if the ancestor goes outside the `base_path`
        //   - Insert or update your HashMap using the ancestor path string as the key
        //   - Move to the next parent (`ancestor.parent()`)
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
            size,// This will be 0 for directories right now
            is_dir,
            modified_secs,
        });
    } // End for

    // 2. Second pass: Inject the computed directory sizes into the directory entries
    for entry in &mut entries {
        if entry.is_dir {
            entry.size = *dir_sizes.get(&entry.path).unwrap_or(&0);
        }
    }

    Ok(entries)
}

#[tauri::command]
/// Opens a file or directory in the native OS file explorer.
///
/// Canonicalizes the path to resolve symlinks and relative traversal (`..`) components.
/// If `is_dir` is `true`, opens the directory in the OS file manager.
/// Otherwise, reveals the specific file item within its parent folder.
///
/// # Arguments
/// * `app`: The Tauri application handle.
/// * `path_str`: Absolute string path to open or reveal.
/// * `is_dir`: Whether the target path is a directory.
///
/// # Returns
/// `Ok(())` on success, or an error string if path resolution or file opening fails.
fn open_in_explorer(app: tauri::AppHandle, path_str: String, is_dir: bool) -> Result<(), String> {
  let path = Path::new(&path_str);
  if !path.exists() {
    return Err(format!("Target path {} does not exist!", path_str));
  }

  // Canonicalize resolves '..' relative components and symlinks before passing to OS handlers
  let canonical = path
    .canonicalize()
    .map_err(|e| format!("Could not resolve path '{}': {}", path_str, e))?;

  // On Windows, strip \\?\ prefix for standard OS explorer compatibility
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
    // Opens the folder cleanly in the OS's native file manager
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
/// Safely moves a file or directory to the OS system trash / recycle bin.
///
/// Canonicalizes the target path and evaluates it against system-level blocklists
/// (`is_protected_path`) to prevent accidental deletion of OS roots or critical directories.
///
/// # Arguments
/// * `path_str`: Absolute string path of the item to move to trash.
///
/// # Returns
/// `Ok(())` on success, or an error string if deletion is refused or fails.
fn move_to_trash(path_str: String) -> Result<(), String> {
    let path = Path::new(&path_str);
    if !path.exists() {
        return Err(format!("Target location path {} does not exist!", path.display()));
    }

    // Canonicalize resolves '..' components and symlinks before any safety checks,
    // so a crafted path cannot bypass the blocklist via indirection
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
/// Signals an ongoing directory scan to cancel execution.
///
/// Sets the shared `cancel_flag` in `AppState` to `true`, causing the running
/// `scan_directory` task to abort on its next loop iteration.
///
/// # Arguments
/// * `state`: Managed application state containing the atomic cancellation flag.
fn cancel_scan(state: State<AppState>) {
  // Flip the flag to true
  state.cancel_flag.store(true, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Initializes and executes the Tauri application runtime.
///
/// Configures application state, registers plugins (`opener`, `dialog`),
/// binds command handlers, and starts the main application loop.
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
          cancel_flag: Arc::new(AtomicBool::new(false)),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_directory, open_in_explorer, move_to_trash, cancel_scan])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
