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
pub struct BreadcrumbItem {
  pub id: u32,
  pub name: String,
}

#[derive(Serialize)]
pub struct DirectoryPayload {
    pub current_id: u32,
    pub current_path: String,
    pub parent_id: Option<u32>,
    pub ancestors: Vec<BreadcrumbItem>,
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
        // Reverse size ordering for min-heap behavior, then deterministic id tiebreak
        other.size.cmp(&self.size).then_with(|| self.id.cmp(&other.id))
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
        let mut entries = Vec::new();
        let mut restart_scan = true;

        SCAN_BUFFER.with(|cell| -> io::Result<()> {
            let mut buffer = cell.borrow_mut();

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
                const STATUS_BUFFER_TOO_SMALL: i32 = 0xC0000023u32 as i32;
                if status.0 == STATUS_BUFFER_OVERFLOW || status.0 == STATUS_BUFFER_TOO_SMALL {
                    if buffer.len() >= 16 * 1024 * 1024 {
                        return Err(io::Error::new(io::ErrorKind::OutOfMemory, "Buffer overflow"));
                    }
                    let new_len = buffer.len() * 2;
                    buffer.resize(new_len, 0);
                    continue;
                }

                if status != STATUS_SUCCESS {
                    return Err(io::Error::other(format!("NTSTATUS failure: 0x{:08X}", status.0 as u32)));
                }
                let bytes_returned = iosb.Information as usize;
                if bytes_returned == 0 { break; }

                parse_entries(&buffer[..bytes_returned], &mut entries)?;
            }

            Ok(())
        })?;

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
                    modified_secs: if tw >= 116_444_736_000_000_000 { (tw - 116_444_736_000_000_000) / 10_000_000 } else { 0 },
                });
            }

            if header.next_entry_offset == 0 { break; }
            offset += header.next_entry_offset as usize;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
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
    depth_exceeded_count: &AtomicUsize,
    shared_arena: &Mutex<Vec<DiskNode>>,
    depth: usize,
) -> Result<(), String> {
    if cancel_flag.load(AtomicOrdering::Relaxed) {
        return Err("Scan was cancelled".to_string());
    }

    if depth > 256 {
        depth_exceeded_count.fetch_add(1, AtomicOrdering::Relaxed);
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

    // Single pass over dir_entries: build local_nodes and record which entries
    // are subdirectories (as (path, relative-index) pairs) at the same time.
    // entry.name is moved directly into the node (no clone) — the path join for
    // subdirectories happens first, borrowing the name, before it's moved.
    let mut local_nodes: Vec<DiskNode> = Vec::with_capacity(dir_entries.len());
    let mut subdir_relative: Vec<(PathBuf, u32)> = Vec::new();

    for (i, entry) in dir_entries.into_iter().enumerate() {
        let is_subdir = entry.is_dir && !entry.is_reparse_point;
        if is_subdir {
            subdir_relative.push((dir_path.join(&entry.name), i as u32));
        }

        local_nodes.push(DiskNode {
            name: entry.name.into_boxed_str(),
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
        if arena.len() + local_nodes.len() > u32::MAX as usize {
            return Err("Arena exceeded maximum node capacity (4 billion nodes)".to_string());
        }
        let start = arena.len() as u32;

        for i in 0..local_nodes.len().saturating_sub(1) {
            local_nodes[i].next_sibling = start + i as u32 + 1;
        }

        arena.extend(local_nodes);
        arena[parent_id as usize].first_child = start;
        start
    };

    let subdir_tasks: Vec<(PathBuf, u32)> = subdir_relative
        .into_iter()
        .map(|(path, i)| (path, start_idx + i))
        .collect();

    subdir_tasks.into_par_iter().try_for_each(|(child_path, child_id)| {
        scan_dir_parallel(&child_path, child_id, cancel_flag, skipped_count, depth_exceeded_count, shared_arena, depth + 1)
    })
}

pub fn aggregate_node(root_id: u32, arena: &mut [DiskNode]) -> u64 {
    // Collect all nodes reachable from root in DFS pre-order
    // Processing in reverse gives post-order: children before parents
    let mut order: Vec<u32> = Vec::new();
    let mut stack = vec![root_id];

    while let Some(id) = stack.pop() {
        order.push(id);
        let mut child = arena[id as usize].first_child;
        while child != u32::MAX {
            stack.push(child);
            child = arena[child as usize].next_sibling;
        }
    }

    // Post-order: children are always processed before their parent.
    for &id in order.iter().rev() {
        if arena[id as usize].is_dir {
            let mut total = 0u64;
            let mut child = arena[id as usize].first_child;
            while child != u32::MAX {
                total += arena[child as usize].size;
                child = arena[child as usize].next_sibling;
            }
            arena[id as usize].size = total;
        }
    }

    arena[root_id as usize].size
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
    let mut min_heap: BinaryHeap<TopCandidate> = BinaryHeap::with_capacity(30);

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
    let parent_size = node.size as f32;

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
                percentage_of_parent: if parent_size > 0.0 { (child.size as f32 / parent_size) * 100.0 } else { 0.0 },
            });
        }
        child_id = child.next_sibling;
    }

    items.sort_unstable_by(|a, b| b.size.cmp(&a.size));

    let (extension_stats, top_files) = aggregate_subtree_stats(arena, node_id);
    let total_scanned_items = arena.len().saturating_sub(1);

    // Hierarchy of ancestors of the current dir
    let mut ancestors = Vec::new();
    let mut current_id = node_id;

    while current_id != u32::MAX {
      let node = &arena[current_id as usize];
      ancestors.push(BreadcrumbItem{
        id: current_id,
        name: node.name.to_string()
      });
      current_id = node.parent_id;
    }
    // Root first, current folder last
    ancestors.reverse();

    Ok(DirectoryPayload {
        current_id: node_id,
        current_path,
        parent_id: if node.parent_id == u32::MAX { None } else { Some(node.parent_id) },
        ancestors: ancestors,
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

// Initial capacity for the shared arena backing vector. Reserving a generous
// starting size up front avoids the earliest, most frequent reallocation/copy
// events (which happen while holding shared_arena's lock) for typical scan
// sizes; the vector still grows normally via `extend` beyond this if needed.
const INITIAL_ARENA_CAPACITY: usize = 1 << 16; // 65,536 nodes

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
    let root_name = base_path_str.strip_prefix(r"\\?\").unwrap_or(&base_path_str).to_string();

    let mut temp_arena = Vec::with_capacity(INITIAL_ARENA_CAPACITY);
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
    let depth_exceeded_count = Arc::new(AtomicUsize::new(0));
    let depth_exceeded_count_task = Arc::clone(&depth_exceeded_count);

    init_rayon_thread_pool();

    let scan_res = tokio::task::spawn_blocking(move || {
        scan_dir_parallel(&canonical, 0, &scan_cancel_flag, &skipped_count_task, &depth_exceeded_count_task, &shared_arena, 0)?;

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
            let depth_exceeded = depth_exceeded_count.load(AtomicOrdering::Relaxed);
            if depth_exceeded > 0 {
                let _ = app.emit("scan-warning", format!("{} path(s) exceeded maximum scan depth limit (256).", depth_exceeded));
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

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_get_directory_entries() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        let sub_dir_path = dir.path().join("subdir");

        fs::create_dir(&sub_dir_path).unwrap();
        let mut f = File::create(&file_path).unwrap();
        f.write_all(b"test content").unwrap();

        let entries = get_directory_entries(dir.path()).unwrap();
        assert_eq!(entries.len(), 2);

        let file_entry = entries.iter().find(|e| e.name == "test.txt").unwrap();
        assert!(!file_entry.is_dir);
        assert_eq!(file_entry.size, 12);

        let dir_entry = entries.iter().find(|e| e.name == "subdir").unwrap();
        assert!(dir_entry.is_dir);

        // Test non-existent directory error
        assert!(get_directory_entries(Path::new("/non_existent_folder_xyz_123")).is_err());
    }

    #[test]
    fn test_init_rayon_thread_pool() {
        // Safe to call multiple times due to std::sync::Once
        init_rayon_thread_pool();
        init_rayon_thread_pool();
    }

    #[test]
    fn test_aggregate_subtree_stats_large() {
        // Create tree with >30 files to exercise min_heap replacement branch
        let mut arena = vec![
            DiskNode {
                name: "root".into(),
                size: 0,
                is_dir: true,
                modified_secs: 100,
                parent_id: u32::MAX,
                first_child: 1,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            }
        ];

        for i in 1..=40 {
            let next_sib = if i == 40 { u32::MAX } else { (i + 1) as u32 };
            arena.push(DiskNode {
                name: format!("file_{}.dat", i).into_boxed_str(),
                size: i * 10,
                is_dir: false,
                modified_secs: 100,
                parent_id: 0,
                first_child: u32::MAX,
                next_sibling: next_sib,
                is_tombstoned: i % 5 == 0, // tombstone every 5th item
            });
        }

        let (ext_stats, top_files) = aggregate_subtree_stats(&arena, 0);
        assert_eq!(ext_stats.len(), 1);
        assert_eq!(ext_stats[0].extension, ".dat");
        assert_eq!(top_files.len(), 30); // Truncated to top 30
        assert_eq!(top_files[0].size, 390); // file_39 is the largest non-tombstoned (file_40 is tombstoned)
    }

    #[test]
    fn test_extract_extension() {
        assert_eq!(extract_extension("document.pdf"), ".pdf");
        assert_eq!(extract_extension("IMAGE.PNG"), ".png");
        assert_eq!(extract_extension("archive.tar.gz"), ".gz");
        assert_eq!(extract_extension("noextension"), "<no ext>");
        assert_eq!(extract_extension(".gitignore"), "<no ext>");
        assert_eq!(extract_extension("file."), "<no ext>");
    }

    #[test]
    fn test_top_candidate_cmp() {
        let cand1 = TopCandidate { size: 100, id: 1 };
        let cand2 = TopCandidate { size: 200, id: 2 };
        let cand3 = TopCandidate { size: 100, id: 0 };

        // Min-heap behavior: higher size compares as Less so it stays on top/peeked after pop
        assert_eq!(cand1.cmp(&cand2), Ordering::Greater);
        assert_eq!(cand2.cmp(&cand1), Ordering::Less);

        // Tie-break by ID ascending
        assert_eq!(cand1.cmp(&cand3), Ordering::Greater);
    }

    #[test]
    fn test_is_protected_path() {
        #[cfg(windows)]
        {
            assert!(is_protected_path(Path::new(r"C:\Windows\System32")));
            assert!(is_protected_path(Path::new(r"C:\Program Files\App")));
            assert!(!is_protected_path(Path::new(r"C:\Users\Name\Documents\Projects\MyCode")));
        }

        #[cfg(target_os = "macos")]
        {
            assert!(is_protected_path(Path::new("/System/Library")));
            assert!(is_protected_path(Path::new("/usr/bin")));
            assert!(!is_protected_path(Path::new("/Users/Name/Documents/Projects")));
        }

        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            assert!(is_protected_path(Path::new("/usr/bin/python")));
            assert!(is_protected_path(Path::new("/etc/passwd/file")));
            assert!(!is_protected_path(Path::new("/home/user/projects/code")));
        }

        // Depth check: short paths are protected
        assert!(is_protected_path(Path::new("/")));
    }

    #[test]
    fn test_arena_helpers_and_payload() {
        // Construct a manual tree:
        // 0: root (dir)
        //   1: folder1 (dir, child of 0)
        //     3: file1.txt (file, child of 1, 100 bytes)
        //     4: file2.pdf (file, child of 1, 200 bytes)
        //   2: file3.txt (file, child of 0, 50 bytes)
        let mut arena = vec![
            DiskNode {
                name: "root".into(),
                size: 0,
                is_dir: true,
                modified_secs: 100,
                parent_id: u32::MAX,
                first_child: 1,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            },
            DiskNode {
                name: "folder1".into(),
                size: 0,
                is_dir: true,
                modified_secs: 100,
                parent_id: 0,
                first_child: 3,
                next_sibling: 2,
                is_tombstoned: false,
            },
            DiskNode {
                name: "file3.txt".into(),
                size: 50,
                is_dir: false,
                modified_secs: 100,
                parent_id: 0,
                first_child: u32::MAX,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            },
            DiskNode {
                name: "file1.txt".into(),
                size: 100,
                is_dir: false,
                modified_secs: 100,
                parent_id: 1,
                first_child: u32::MAX,
                next_sibling: 4,
                is_tombstoned: false,
            },
            DiskNode {
                name: "file2.pdf".into(),
                size: 200,
                is_dir: false,
                modified_secs: 100,
                parent_id: 1,
                first_child: u32::MAX,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            },
        ];

        // Test aggregate_node
        let total = aggregate_node(0, &mut arena);
        assert_eq!(total, 350);
        assert_eq!(arena[1].size, 300);

        // Test get_node_path
        let path0 = get_node_path(0, &arena);
        assert_eq!(path0, "root");
        let path3 = get_node_path(3, &arena);
        assert_eq!(Path::new(&path3), Path::new("root").join("folder1").join("file1.txt"));

        // Test aggregate_subtree_stats on root
        let (ext_stats, top_files) = aggregate_subtree_stats(&arena, 0);
        assert_eq!(ext_stats.len(), 2); // .txt and .pdf
        let txt_stat = ext_stats.iter().find(|s| s.extension == ".txt").unwrap();
        assert_eq!(txt_stat.total_bytes, 150);
        assert_eq!(txt_stat.file_count, 2);
        assert_eq!(top_files.len(), 3);
        assert_eq!(top_files[0].size, 200); // Largest file first in top_files

        // Test build_directory_payload
        let payload = build_directory_payload(&arena, 0).unwrap();
        assert_eq!(payload.current_id, 0);
        assert_eq!(payload.parent_id, None);
        assert_eq!(payload.items.len(), 2);
        assert_eq!(payload.ancestors.len(), 1);

        let folder_payload = build_directory_payload(&arena, 1).unwrap();
        assert_eq!(folder_payload.parent_id, Some(0));
        assert_eq!(folder_payload.ancestors.len(), 2);

        // Test error cases for build_directory_payload
        assert!(build_directory_payload(&arena, 99).is_err());
    }

    #[test]
    fn test_remove_node_from_tree() {
        let mut arena = vec![
            DiskNode {
                name: "root".into(),
                size: 350,
                is_dir: true,
                modified_secs: 100,
                parent_id: u32::MAX,
                first_child: 1,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            },
            DiskNode {
                name: "folder1".into(),
                size: 300,
                is_dir: true,
                modified_secs: 100,
                parent_id: 0,
                first_child: 3,
                next_sibling: 2,
                is_tombstoned: false,
            },
            DiskNode {
                name: "file3.txt".into(),
                size: 50,
                is_dir: false,
                modified_secs: 100,
                parent_id: 0,
                first_child: u32::MAX,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            },
            DiskNode {
                name: "file1.txt".into(),
                size: 100,
                is_dir: false,
                modified_secs: 100,
                parent_id: 1,
                first_child: u32::MAX,
                next_sibling: 4,
                is_tombstoned: false,
            },
            DiskNode {
                name: "file2.pdf".into(),
                size: 200,
                is_dir: false,
                modified_secs: 100,
                parent_id: 1,
                first_child: u32::MAX,
                next_sibling: u32::MAX,
                is_tombstoned: false,
            },
        ];

        // Remove folder1 (id 1)
        remove_node_from_tree(1, &mut arena);

        // Root first_child should now point to file3.txt (id 2)
        assert_eq!(arena[0].first_child, 2);
        // Root size updated: 350 - 300 = 50
        assert_eq!(arena[0].size, 50);

        // Nodes 1, 3, 4 should be tombstoned
        assert!(arena[1].is_tombstoned);
        assert!(arena[3].is_tombstoned);
        assert!(arena[4].is_tombstoned);

        // Building payload on tombstoned node fails
        assert!(build_directory_payload(&arena, 1).is_err());

        // Payload on root only includes non-tombstoned children
        let root_payload = build_directory_payload(&arena, 0).unwrap();
        assert_eq!(root_payload.items.len(), 1);
        assert_eq!(root_payload.items[0].name, "file3.txt");

        // Removing non-existent node doesn't panic
        remove_node_from_tree(99, &mut arena);
    }

    #[test]
    fn test_scan_dir_parallel() {
        let dir = tempdir().unwrap();
        let root_path = dir.path();

        // Create subdirectories and files
        let sub_dir1 = root_path.join("subdir1");
        fs::create_dir(&sub_dir1).unwrap();

        let file1 = root_path.join("hello.txt");
        let mut f1 = File::create(&file1).unwrap();
        f1.write_all(b"Hello world").unwrap();

        let file2 = sub_dir1.join("data.bin");
        let mut f2 = File::create(&file2).unwrap();
        f2.write_all(b"1234567890").unwrap();

        let cancel_flag = AtomicBool::new(false);
        let skipped_count = AtomicUsize::new(0);
        let depth_exceeded_count = AtomicUsize::new(0);
        let shared_arena = Mutex::new(vec![DiskNode {
            name: root_path.to_string_lossy().into_owned().into_boxed_str(),
            size: 0,
            is_dir: true,
            modified_secs: 0,
            parent_id: u32::MAX,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        }]);

        let res = scan_dir_parallel(
            root_path,
            0,
            &cancel_flag,
            &skipped_count,
            &depth_exceeded_count,
            &shared_arena,
            0,
        );
        assert!(res.is_ok());

        let mut final_arena = shared_arena.into_inner().unwrap();
        aggregate_node(0, &mut final_arena);

        assert!(final_arena.len() >= 4); // root, subdir1, hello.txt, data.bin
        assert_eq!(final_arena[0].size, 21); // 11 + 10 bytes

        // Test cancel flag
        let cancel_flag_true = AtomicBool::new(true);
        let shared_arena2 = Mutex::new(vec![]);
        let res_cancelled = scan_dir_parallel(
            root_path,
            0,
            &cancel_flag_true,
            &skipped_count,
            &depth_exceeded_count,
            &shared_arena2,
            0,
        );
        assert!(res_cancelled.is_err());

        // Test depth limit
        let depth_exceeded_count2 = AtomicUsize::new(0);
        let shared_arena3 = Mutex::new(vec![]);
        let res_depth = scan_dir_parallel(
            root_path,
            0,
            &cancel_flag,
            &skipped_count,
            &depth_exceeded_count2,
            &shared_arena3,
            257,
        );
        assert!(res_depth.is_ok());
        assert_eq!(depth_exceeded_count2.load(AtomicOrdering::Relaxed), 1);
    }

    #[test]
    fn test_scan_dir_parallel_edge_cases() {
        let dir = tempdir().unwrap();
        let root_path = dir.path();

        // 1. Empty directory
        let empty_dir = root_path.join("empty");
        fs::create_dir(&empty_dir).unwrap();

        // 2. Symlink / Reparse point (if OS supports it)
        let file_path = root_path.join("real.txt");
        File::create(&file_path).unwrap().write_all(b"data").unwrap();

        #[cfg(unix)]
        let symlink_path = root_path.join("link.txt");
        #[cfg(unix)]
        let _ = std::os::unix::fs::symlink(&file_path, &symlink_path);

        let cancel_flag = AtomicBool::new(false);
        let skipped_count = AtomicUsize::new(0);
        let depth_exceeded_count = AtomicUsize::new(0);
        let shared_arena = Mutex::new(vec![DiskNode {
            name: root_path.to_string_lossy().into_owned().into_boxed_str(),
            size: 0,
            is_dir: true,
            modified_secs: 0,
            parent_id: u32::MAX,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        }]);

        let res = scan_dir_parallel(
            root_path,
            0,
            &cancel_flag,
            &skipped_count,
            &depth_exceeded_count,
            &shared_arena,
            0,
        );
        assert!(res.is_ok());

        // 3. Non-existent path causes skipped_count increment
        let non_existent = root_path.join("does_not_exist");
        let res_non_exist = scan_dir_parallel(
            &non_existent,
            0,
            &cancel_flag,
            &skipped_count,
            &depth_exceeded_count,
            &shared_arena,
            0,
        );
        assert!(res_non_exist.is_ok());
        assert_eq!(skipped_count.load(AtomicOrdering::Relaxed), 1);
    }

    #[test]
    fn test_cancel_scan_logic() {
        let state = AppState {
            arena: Arc::new(RwLock::new(ArenaTree::default())),
            cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
        };
        let flag = state.cancel_flag.lock().unwrap().clone();
        assert!(!flag.load(AtomicOrdering::Relaxed));

        // Simulate cancel_scan logic
        let flag_to_cancel = state.cancel_flag.lock().unwrap().clone();
        flag_to_cancel.store(true, AtomicOrdering::Relaxed);

        assert!(flag.load(AtomicOrdering::Relaxed));
    }

    #[test]
    fn test_get_disk_info() {
        let temp = tempdir().unwrap();
        let path_str = temp.path().to_string_lossy().to_string();

        let info = get_disk_info(path_str);
        assert!(info.is_ok());
        let disk_info = info.unwrap();
        assert!(disk_info.total_bytes > 0);

        let err_info = get_disk_info("/non/existent/path/123456789".to_string());
        assert!(err_info.is_err());
    }
}
