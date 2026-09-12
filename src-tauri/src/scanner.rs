//! Parallel directory scanner coordinator and thread pool management.

use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Mutex;

use crate::models::{DirEntry, DiskNode};

pub mod default;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(windows)]
pub mod windows;

/// Platform-dispatched entry point for reading directory entries.
pub fn get_directory_entries(path: &Path) -> std::io::Result<Vec<DirEntry>> {
    #[cfg(windows)]
    {
        windows::list_directory(path)
    }
    #[cfg(target_os = "linux")]
    {
        linux::list_directory(path)
    }
    #[cfg(all(not(windows), not(target_os = "linux")))]
    {
        default::list_directory(path)
    }
}

/// Initializes the global Rayon thread pool for parallel directory scanning tasks.
pub fn init_rayon_thread_pool() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let cpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(cpus.saturating_sub(1).max(1))
            .build_global();
    });
}

/// Recursively scans directory contents in parallel using Rayon and constructs the shared arena graph.
#[allow(clippy::too_many_arguments)]
pub fn scan_dir_parallel(
    dir_path: &Path,
    parent_id: u32,
    cancel_flag: &AtomicBool,
    skipped_count: &AtomicUsize,
    depth_exceeded_count: &AtomicUsize,
    file_count: &AtomicUsize,
    dir_count: &AtomicUsize,
    root_file_count: &AtomicUsize,
    root_dir_count: &AtomicUsize,
    total_file_bytes: &AtomicU64,
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

    if dir_entries.is_empty() {
        return Ok(());
    }

    // Single pass over dir_entries: build local_nodes and record which entries
    // are subdirectories (as (path, relative-index) pairs) at the same time.
    // Native path components are retained so filesystem operations never need
    // to reconstruct identity from the lossy display name.
    let mut local_nodes: Vec<DiskNode> = Vec::with_capacity(dir_entries.len());
    let mut subdir_relative: Vec<(PathBuf, u32)> = Vec::new();
    let mut local_files: usize = 0;
    let mut local_dirs: usize = 0;
    let mut local_bytes: u64 = 0;

    for (i, entry) in dir_entries.into_iter().enumerate() {
        let is_subdir = entry.is_dir && !entry.is_reparse_point;
        if is_subdir {
            subdir_relative.push((dir_path.join(&entry.native_name), i as u32));
        }

        if entry.is_dir {
            local_dirs += 1;
        } else {
            local_files += 1;
            local_bytes += entry.size;
        }

        local_nodes.push(DiskNode {
            name: entry.name.into_boxed_str(),
            native_name: entry.native_name,
            size: entry.size,
            is_dir: entry.is_dir,
            modified_secs: entry.modified_secs,
            parent_id,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        });
    }

    // Direct entry counts for the root directory of the scan view
    if depth == 0 {
        root_file_count.store(local_files, AtomicOrdering::Relaxed);
        root_dir_count.store(local_dirs, AtomicOrdering::Relaxed);
    }

    if local_files > 0 {
        file_count.fetch_add(local_files, AtomicOrdering::Relaxed);
    }
    if local_dirs > 0 {
        dir_count.fetch_add(local_dirs, AtomicOrdering::Relaxed);
    }
    if local_bytes > 0 {
        total_file_bytes.fetch_add(local_bytes, AtomicOrdering::Relaxed);
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

    subdir_tasks
        .into_par_iter()
        .try_for_each(|(child_path, child_id)| {
            scan_dir_parallel(
                &child_path,
                child_id,
                cancel_flag,
                skipped_count,
                depth_exceeded_count,
                file_count,
                dir_count,
                root_file_count,
                root_dir_count,
                total_file_bytes,
                shared_arena,
                depth + 1,
            )
        })
}
