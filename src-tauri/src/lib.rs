#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

// -----------------------------------------------------------------------------
// Data Structures: Arena Tree & Payloads
// -----------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub struct DiskNode {
    pub name: Box<str>,
    pub size: u64,
    pub is_dir: bool,
    pub modified_secs: u64,
    pub parent_id: u32,
    pub first_child: u32,
    pub next_sibling: u32,
    pub is_tombstoned: bool,
}

#[derive(Default)]
pub struct ArenaTree {
    pub nodes: Vec<DiskNode>,
}

#[derive(Serialize)]
pub struct ExtensionStat {
    pub extension: String,
    pub total_bytes: u64,
    pub file_count: usize,
}

#[derive(Serialize)]
pub struct TopFileNode {
    pub id: u32,
    pub name: String,
    pub size: u64,
    pub modified_secs: u64,
}

#[derive(Serialize)]
pub struct DirectoryPayload {
    pub current_id: u32,
    pub current_path: String,
    pub parent_id: Option<u32>,
    pub items: Vec<UiDiskNode>,
    pub extension_stats: Vec<ExtensionStat>,
    pub top_files: Vec<TopFileNode>,
    pub total_scanned_items: usize,
}

#[derive(Serialize)]
pub struct UiDiskNode {
    pub id: u32,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_secs: u64,
    pub percentage_of_parent: f32,
}

#[derive(Debug, Serialize)]
pub struct DiskInfo {
    pub total_bytes: u64,
    pub free_bytes: u64,
}

pub struct AppState {
    pub arena: Arc<RwLock<ArenaTree>>,
    pub cancel_flag: Mutex<Arc<AtomicBool>>,
}

#[derive(Clone)]
pub struct DirEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_reparse_point: bool,
    pub modified_secs: u64,
}

#[derive(Eq, PartialEq)]
struct TopCandidate {
    size: u64,
    id: u32,
}

impl Ord for TopCandidate {
    fn cmp(&self, other: &Self) -> Ordering {
        other.size.cmp(&self.size) // Reverse ordering for min-heap behavior
    }
}

impl PartialOrd for TopCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// -----------------------------------------------------------------------------
// Protection Rules
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Scanners (Windows NT API + Standard Library Fallback)
// -----------------------------------------------------------------------------

#[cfg(windows)]
mod windows_scanner {
    use super::DirEntry;
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

    struct HandleGuard(HANDLE);
    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if !self.0.is_invalid() { unsafe { let _ = CloseHandle(self.0); } }
        }
    }

    fn open_directory(path: &Path) -> io::Result<HandleGuard> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()), FILE_LIST_DIRECTORY.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None,
                OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None,
            )
        }.map_err(|e| io::Error::from_raw_os_error(e.code().0))?;

        if handle.is_invalid() { return Err(io::Error::last_os_error()); }
        Ok(HandleGuard(handle))
    }

    pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
        let guard = open_directory(path)?;
        let mut buffer: Vec<u8> = vec![0u8; INITIAL_QUERY_BUFFER_SIZE];
        let mut entries = Vec::new();
        let mut restart_scan = true;

        loop {
            let mut iosb = IO_STATUS_BLOCK::default();
            let status = unsafe {
                NtQueryDirectoryFileEx(
                    guard.0, None, None, None, &mut iosb,
                    buffer.as_mut_ptr() as *mut c_void, buffer.len() as u32,
                    FileDirectoryInformation, if restart_scan { 0x00000001 } else { 0 }, None,
                )
            };
            restart_scan = false;

            if status == STATUS_NO_MORE_FILES { break; }

            const STATUS_BUFFER_OVERFLOW: i32 = 0x80000005u32 as i32;
            if status.0 == STATUS_BUFFER_OVERFLOW {
                if buffer.len() >= 16 * 1024 * 1024 { return Err(io::Error::new(io::ErrorKind::OutOfMemory, "Buffer overflow")); }
                buffer.resize(buffer.len() * 2, 0);
                continue;
            }

            if status != STATUS_SUCCESS { return Err(io::Error::other("NTSTATUS failure")); }
            let bytes_returned = iosb.Information as usize;
            if bytes_returned == 0 { break; }

            parse_entries(&buffer[..bytes_returned], &mut entries)?;
        }
        Ok(entries)
    }

    fn parse_entries(buf: &[u8], out: &mut Vec<DirEntry>) -> io::Result<()> {
        const HEADER_SIZE: usize = std::mem::size_of::<FileDirectoryInformationRaw>();
        let mut offset = 0usize;

        loop {
            if offset + HEADER_SIZE > buf.len() { break; }
            let header_ptr = unsafe { buf.as_ptr().add(offset) as *const FileDirectoryInformationRaw };
            let header = unsafe { std::ptr::read_unaligned(header_ptr) };

            let name_len = header.file_name_length as usize;
            let name_end = offset + HEADER_SIZE + name_len;
            if name_end > buf.len() { break; }

            let utf16: Vec<u16> = buf[offset + HEADER_SIZE..name_end]
                .chunks_exact(2).map(|b| u16::from_ne_bytes([b[0], b[1]])).collect();
            let name = String::from_utf16_lossy(&utf16);

            if name != "." && name != ".." {
                let tw = header.last_write_time as u64;
                out.push(DirEntry {
                    name,
                    size: header.end_of_file.max(0) as u64,
                    is_dir: header.file_attributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0,
                    is_reparse_point: header.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0,
                    modified_secs: if tw >= 116_444_736_000_000_000 { (tw - 116_444_736_000_000_000) / 10_000_000 } else { 0 },
                });
            }

            if header.next_entry_offset == 0 { break; }
            offset += header.next_entry_offset as usize;
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn standard_list_directory(path: &Path) -> std::io::Result<Vec<DirEntry>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir();
        let is_symlink = file_type.is_symlink();
        let meta = entry.metadata().ok();

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            size: if is_dir { 0 } else { meta.as_ref().map(|m| m.len()).unwrap_or(0) },
            is_dir,
            is_reparse_point: is_symlink,
            modified_secs: meta.as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
    }
    Ok(entries)
}

#[cfg(windows)]
fn get_directory_entries(path: &Path) -> std::io::Result<Vec<DirEntry>> {
    windows_scanner::list_directory(path)
}

#[cfg(not(windows))]
fn get_directory_entries(path: &Path) -> std::io::Result<Vec<DirEntry>> {
    standard_list_directory(path)
}

// -----------------------------------------------------------------------------
// Parallel Arena Tree Builder & Aggregation
// -----------------------------------------------------------------------------

fn scan_dir_parallel(
    dir_path: &Path,
    parent_id: u32,
    cancel_flag: &AtomicBool,
    skipped_count: &AtomicUsize,
    shared_arena: &Mutex<Vec<DiskNode>>,
    depth: usize,
) -> Result<(), String> {
    if cancel_flag.load(AtomicOrdering::Relaxed) {
        return Err("Scan was cancelled".to_string());
    }

    if depth > 256 {
        skipped_count.fetch_add(1, AtomicOrdering::Relaxed);
        return Ok(());
    }

    let dir_entries = match get_directory_entries(dir_path) {
        Ok(e) => e,
        Err(_) => {
            skipped_count.fetch_add(1, AtomicOrdering::Relaxed);
            return Ok(());
        }
    };

    if dir_entries.is_empty() { return Ok(()); }

    let mut local_nodes: Vec<DiskNode> = Vec::with_capacity(dir_entries.len());
    for entry in &dir_entries {
        local_nodes.push(DiskNode {
            name: entry.name.clone().into_boxed_str(),
            size: entry.size,
            is_dir: entry.is_dir,
            modified_secs: entry.modified_secs,
            parent_id,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        });
    }

    let start_idx = {
        let mut arena = shared_arena.lock().unwrap();
        let start = arena.len() as u32;

        for i in 0..local_nodes.len().saturating_sub(1) {
            local_nodes[i].next_sibling = start + i as u32 + 1;
        }

        arena.extend(local_nodes);
        arena[parent_id as usize].first_child = start;
        start
    };

    let mut subdir_tasks = Vec::new();
    for (i, entry) in dir_entries.iter().enumerate() {
        if entry.is_dir && !entry.is_reparse_point {
            let child_id = start_idx + i as u32;
            let child_path = dir_path.join(&entry.name);
            subdir_tasks.push((child_path, child_id));
        }
    }

    subdir_tasks.into_par_iter().try_for_each(|(child_path, child_id)| {
        scan_dir_parallel(&child_path, child_id, cancel_flag, skipped_count, shared_arena, depth + 1)
    })
}

pub fn aggregate_node(node_id: u32, arena: &mut [DiskNode]) -> u64 {
    let mut total_size = 0u64;
    let mut child_id = arena[node_id as usize].first_child;

    while child_id != u32::MAX {
        let is_dir = arena[child_id as usize].is_dir;
        let child_size = if is_dir {
            aggregate_node(child_id, arena)
        } else {
            arena[child_id as usize].size
        };

        total_size += child_size;
        child_id = arena[child_id as usize].next_sibling;
    }

    if arena[node_id as usize].is_dir {
        arena[node_id as usize].size = total_size;
    }
    total_size
}

fn init_rayon_thread_pool() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let _ = rayon::ThreadPoolBuilder::new().num_threads(cpus.saturating_sub(1).max(1)).build_global();
    });
}

// -----------------------------------------------------------------------------
// LCRS Navigation Helpers & Aggregation Tools
// -----------------------------------------------------------------------------

fn get_node_path(node_id: u32, arena: &[DiskNode]) -> String {
    let mut parts = Vec::new();
    let mut current_id = node_id;

    while current_id != u32::MAX {
        let node = &arena[current_id as usize];
        parts.push(node.name.as_ref());
        current_id = node.parent_id;
    }

    parts.reverse();
    let mut path_buf = PathBuf::new();
    for part in parts { path_buf.push(part); }
    path_buf.to_string_lossy().into_owned()
}

fn extract_extension(name: &str) -> String {
    if let Some(idx) = name.rfind('.') {
        if idx > 0 && idx < name.len() - 1 {
            return name[idx..].to_lowercase();
        }
    }
    "<no ext>".to_string()
}

fn aggregate_subtree_stats(
    arena: &[DiskNode],
    root_id: u32,
) -> (Vec<ExtensionStat>, Vec<TopFileNode>) {
    let mut ext_map: HashMap<String, (u64, usize)> = HashMap::new();
    let mut min_heap: BinaryHeap<TopCandidate> = BinaryHeap::with_capacity(31);

    let mut stack = vec![arena[root_id as usize].first_child];

    while let Some(mut curr_child) = stack.pop() {
        while curr_child != u32::MAX {
            let node = &arena[curr_child as usize];

            if !node.is_tombstoned {
                if node.is_dir {
                    if node.first_child != u32::MAX {
                        stack.push(node.first_child);
                    }
                } else {
                    let ext = extract_extension(&node.name);
                    let entry = ext_map.entry(ext).or_insert((0, 0));
                    entry.0 += node.size;
                    entry.1 += 1;

                    if min_heap.len() < 30 {
                        min_heap.push(TopCandidate { size: node.size, id: curr_child });
                    } else if let Some(smallest) = min_heap.peek() {
                        if node.size > smallest.size {
                            min_heap.pop();
                            min_heap.push(TopCandidate { size: node.size, id: curr_child });
                        }
                    }
                }
            }

            curr_child = node.next_sibling;
        }
    }

    let mut extension_stats: Vec<ExtensionStat> = ext_map
        .into_iter()
        .map(|(ext, (total_bytes, file_count))| ExtensionStat {
            extension: ext,
            total_bytes,
            file_count,
        })
        .collect();
    extension_stats.sort_unstable_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
    extension_stats.truncate(15);

    let top_files = min_heap
        .into_sorted_vec()
        .into_iter()
        .map(|cand| {
            let n = &arena[cand.id as usize];
            TopFileNode {
                id: cand.id,
                name: n.name.to_string(),
                size: n.size,
                modified_secs: n.modified_secs,
            }
        })
        .collect();

    (extension_stats, top_files)
}

fn build_directory_payload(arena: &[DiskNode], node_id: u32) -> Result<DirectoryPayload, String> {
    if node_id as usize >= arena.len() {
        return Err("Invalid node ID".into());
    }

    let node = &arena[node_id as usize];
    if node.is_tombstoned {
        return Err("Node has been removed".into());
    }

    let current_path = get_node_path(node_id, arena);
    let parent_size = node.size.max(1) as f32;

    let mut items = Vec::new();
    let mut child_id = node.first_child;

    while child_id != u32::MAX {
        let child = &arena[child_id as usize];
        if !child.is_tombstoned {
            items.push(UiDiskNode {
                id: child_id,
                name: child.name.to_string(),
                is_dir: child.is_dir,
                size: child.size,
                modified_secs: child.modified_secs,
                percentage_of_parent: (child.size as f32 / parent_size) * 100.0,
            });
        }
        child_id = child.next_sibling;
    }

    items.sort_unstable_by(|a, b| b.size.cmp(&a.size));

    let (extension_stats, top_files) = aggregate_subtree_stats(arena, node_id);
    let total_scanned_items = arena.len().saturating_sub(1);

    Ok(DirectoryPayload {
        current_id: node_id,
        current_path,
        parent_id: if node.parent_id == u32::MAX { None } else { Some(node.parent_id) },
        items,
        extension_stats,
        top_files,
        total_scanned_items,
    })
}

fn remove_node_from_tree(node_id: u32, arena: &mut [DiskNode]) {
    if node_id as usize >= arena.len() {
        return;
    }

    let node_to_remove = &arena[node_id as usize];
    let parent_id = node_to_remove.parent_id;
    let next_sibling = node_to_remove.next_sibling;
    let removed_size = node_to_remove.size;

    // 1. Unlink from parent's sibling chain
    if parent_id != u32::MAX && (parent_id as usize) < arena.len() {
        let mut prev_id = u32::MAX;
        let mut curr_id = arena[parent_id as usize].first_child;

        while curr_id != u32::MAX {
            if curr_id == node_id {
                if prev_id == u32::MAX {
                    arena[parent_id as usize].first_child = next_sibling;
                } else {
                    arena[prev_id as usize].next_sibling = next_sibling;
                }
                break;
            }
            prev_id = curr_id;
            curr_id = arena[curr_id as usize].next_sibling;
        }

        // 2. Adjust ancestor sizes
        let mut p = parent_id;
        while p != u32::MAX && (p as usize) < arena.len() {
            arena[p as usize].size = arena[p as usize].size.saturating_sub(removed_size);
            p = arena[p as usize].parent_id;
        }
    }

    // 3. Tombstone node and all its descendants
    let mut stack = vec![node_id];
    while let Some(curr) = stack.pop() {
        if (curr as usize) < arena.len() {
            arena[curr as usize].is_tombstoned = true;
            let mut child = arena[curr as usize].first_child;
            while child != u32::MAX {
                stack.push(child);
                child = arena[child as usize].next_sibling;
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Tauri Commands
// -----------------------------------------------------------------------------

#[tauri::command]
async fn scan_directory(app: tauri::AppHandle, target_path: String, state: State<'_, AppState>) -> Result<DirectoryPayload, String> {
    let scan_cancel_flag = {
        let mut guard = state.cancel_flag.lock().unwrap();
        guard.store(true, AtomicOrdering::Relaxed);
        let new_flag = Arc::new(AtomicBool::new(false));
        *guard = new_flag.clone();
        new_flag
    };

    let canonical = Path::new(&target_path).canonicalize().map_err(|e| e.to_string())?;

    let base_path_str = canonical.to_string_lossy();
    let root_name = if base_path_str.starts_with(r"\\?\") {
        base_path_str[4..].to_string()
    } else {
        base_path_str.into_owned()
    };

    let mut temp_arena = Vec::new();
    temp_arena.push(DiskNode {
        name: root_name.into_boxed_str(),
        size: 0,
        is_dir: true,
        modified_secs: 0,
        parent_id: u32::MAX,
        first_child: u32::MAX,
        next_sibling: u32::MAX,
        is_tombstoned: false,
    });

    let shared_arena = Mutex::new(temp_arena);
    let skipped_count = Arc::new(AtomicUsize::new(0));
    let skipped_count_task = Arc::clone(&skipped_count);

    init_rayon_thread_pool();

    let scan_res = tokio::task::spawn_blocking(move || {
        scan_dir_parallel(&canonical, 0, &scan_cancel_flag, &skipped_count_task, &shared_arena, 0)?;

        let mut final_arena = shared_arena.into_inner().unwrap();
        aggregate_node(0, &mut final_arena);
        Ok::<Vec<DiskNode>, String>(final_arena)
    }).await;

    match scan_res {
        Ok(Ok(completed_arena)) => {
            let skipped = skipped_count.load(AtomicOrdering::Relaxed);
            if skipped > 0 {
                let _ = app.emit("scan-warning", format!("{} location(s) were inaccessible and skipped.", skipped));
            }

            let mut state_arena = state.arena.write().map_err(|_| "Failed to lock state")?;
            state_arena.nodes = completed_arena;

            build_directory_payload(&state_arena.nodes, 0)
        },
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

#[tauri::command]
async fn open_directory(node_id: u32, state: State<'_, AppState>) -> Result<DirectoryPayload, String> {
    let arena_arc = state.arena.clone();
    tokio::task::spawn_blocking(move || {
        let arena = arena_arc.read().map_err(|_| "Failed to lock state")?;
        build_directory_payload(&arena.nodes, node_id)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
fn open_in_explorer(app: tauri::AppHandle, node_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let (path_str, is_dir) = {
        let arena = state.arena.read().map_err(|_| "Failed to lock state")?;
        if node_id as usize >= arena.nodes.len() { return Err("Invalid ID".into()); }
        let node = &arena.nodes[node_id as usize];
        if node.is_tombstoned { return Err("Node has been removed".into()); }
        (get_node_path(node_id, &arena.nodes), node.is_dir)
    };

    if is_dir {
        app.opener().open_path(&path_str, None::<&str>).map_err(|e| e.to_string())?;
    } else {
        app.opener().reveal_item_in_dir(&path_str).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn move_to_trash(node_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let path_str = {
        let arena = state.arena.read().map_err(|_| "Failed to lock state")?;
        if node_id as usize >= arena.nodes.len() { return Err("Invalid ID".into()); }
        let node = &arena.nodes[node_id as usize];
        if node.is_tombstoned { return Err("Node has been removed".into()); }
        get_node_path(node_id, &arena.nodes)
    };

    let path = Path::new(&path_str);
    if is_protected_path(path) {
        return Err(format!("Refusing to delete protected path: {}", path.display()));
    }

    let delete_path = path_str.clone();
    tokio::task::spawn_blocking(move || trash::delete(Path::new(&delete_path)))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        .map_err(|e| e.to_string())?;

    let mut arena = state.arena.write().map_err(|_| "Failed to lock state")?;
    remove_node_from_tree(node_id, &mut arena.nodes);

    Ok(())
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    let flag = state.cancel_flag.lock().unwrap().clone();
    flag.store(true, AtomicOrdering::Relaxed);
}

#[tauri::command]
fn get_disk_info(path: String) -> Result<DiskInfo, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {}", path)); }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0u16)).collect();
        let mut free_caller: u64 = 0;
        let mut total: u64 = 0;
        let mut free_total: u64 = 0;

        let ok = unsafe {
            GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free_caller), Some(&mut total), Some(&mut free_total))
        };

        if ok.is_err() { return Err(format!("GetDiskFreeSpaceExW failed for '{}'", path)); }
        return Ok(DiskInfo { total_bytes: total, free_bytes: free_caller });
    }

    #[cfg(not(windows))]
    {
        use sysinfo::Disks;
        let disks = Disks::new_with_refreshed_list();
        let canonical = p.canonicalize().map_err(|e| e.to_string())?;
        let best = disks.iter()
            .filter(|d| canonical.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len());

        match best {
            Some(disk) => Ok(DiskInfo { total_bytes: disk.total_space(), free_bytes: disk.available_space() }),
            None => Err(format!("No mounted disk found for path '{}'", path)),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            arena: Arc::new(RwLock::new(ArenaTree::default())),
            cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            open_directory,
            open_in_explorer,
            move_to_trash,
            cancel_scan,
            get_disk_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
