//! Commands for initiating, canceling, and navigating directory scans.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, State};

use crate::models::{AppState, DirectoryPayload, DiskNode, ScanProgress};
use crate::scanner::{get_dev, init_rayon_thread_pool, scan_dir_parallel};
use crate::tree::{aggregate_node, build_directory_payload};

// Initial capacity for the shared arena backing vector. Reserving a generous
// starting size up front avoids the earliest, most frequent reallocation/copy
// events (which happen while holding shared_arena's lock) for typical scan
// sizes; the vector still grows normally via `extend` beyond this if needed.
const INITIAL_ARENA_CAPACITY: usize = 1 << 16; // 65,536 nodes

/// Tauri command to initiate a parallel directory scan and construct the root payload.
#[tauri::command]
pub async fn scan_directory(
    app: tauri::AppHandle,
    target_path: String,
    state: State<'_, AppState>,
) -> Result<DirectoryPayload, String> {
    let (scan_generation, scan_cancel_flag) = {
        let mut guard = state.cancel_flag.lock().unwrap();
        guard.store(true, AtomicOrdering::Relaxed);
        let new_flag = Arc::new(AtomicBool::new(false));
        *guard = new_flag.clone();
        let previous_generation = state
            .scan_generation
            .fetch_update(
                AtomicOrdering::SeqCst,
                AtomicOrdering::SeqCst,
                |generation| generation.checked_add(1),
            )
            .map_err(|_| "Scan generation exhausted")?;
        let generation = previous_generation + 1;
        (generation, new_flag)
    };

    let canonical = Path::new(&target_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let base_path_str = canonical.to_string_lossy();
    let root_name = base_path_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&base_path_str)
        .to_string();

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

    let file_count = Arc::new(AtomicUsize::new(0));
    let file_count_task = Arc::clone(&file_count);
    let dir_count = Arc::new(AtomicUsize::new(0));
    let dir_count_task = Arc::clone(&dir_count);
    let root_file_count = Arc::new(AtomicUsize::new(0));
    let root_file_count_task = Arc::clone(&root_file_count);
    let root_dir_count = Arc::new(AtomicUsize::new(0));
    let root_dir_count_task = Arc::clone(&root_dir_count);
    let total_file_bytes = Arc::new(AtomicU64::new(0));
    let total_file_bytes_task = Arc::clone(&total_file_bytes);
    let scan_cancel_flag_task = Arc::clone(&scan_cancel_flag);

    let done_flag = Arc::new(AtomicBool::new(false));
    let done_flag_emitter = Arc::clone(&done_flag);
    let cancel_flag_emitter = Arc::clone(&scan_cancel_flag);
    let app_emitter = app.clone();
    let file_count_emitter = Arc::clone(&file_count);
    let dir_count_emitter = Arc::clone(&dir_count);
    let root_file_count_emitter = Arc::clone(&root_file_count);
    let root_dir_count_emitter = Arc::clone(&root_dir_count);
    let total_bytes_emitter = Arc::clone(&total_file_bytes);
    let (progress_done_sender, progress_done_receiver) = mpsc::channel();

    // Periodically streams live scan progress to frontend via Tauri IPC
    let progress_emitter_handle = std::thread::spawn(move || {
        let start = std::time::Instant::now();
        loop {
            match progress_done_receiver.recv_timeout(std::time::Duration::from_millis(500)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if done_flag_emitter.load(AtomicOrdering::Relaxed)
                || cancel_flag_emitter.load(AtomicOrdering::Relaxed)
            {
                break;
            }
            let _ = app_emitter.emit(
                "scan-progress",
                ScanProgress {
                    file_count: file_count_emitter.load(AtomicOrdering::Relaxed),
                    dir_count: dir_count_emitter.load(AtomicOrdering::Relaxed),
                    root_file_count: root_file_count_emitter.load(AtomicOrdering::Relaxed),
                    root_dir_count: root_dir_count_emitter.load(AtomicOrdering::Relaxed),
                    total_file_bytes: total_bytes_emitter.load(AtomicOrdering::Relaxed),
                    elapsed_secs: start.elapsed().as_secs_f64(),
                },
            );
        }
    });

    init_rayon_thread_pool();

    let scan_res = tokio::task::spawn_blocking(move || {
        // Resolve the device ID of the scan root once
        // On Unix this is used to skip subdirectories on different filesystems (e.g. /proc, /sys)
        let root_dev = get_dev(&canonical);

        scan_dir_parallel(
            &canonical,
            0,
            &scan_cancel_flag_task,
            &skipped_count_task,
            &depth_exceeded_count_task,
            &file_count_task,
            &dir_count_task,
            &root_file_count_task,
            &root_dir_count_task,
            &total_file_bytes_task,
            &shared_arena,
            0,
            root_dev,
        )?;

        let mut final_arena = shared_arena.into_inner().unwrap();
        aggregate_node(0, &mut final_arena);
        final_arena.shrink_to_fit();
        Ok::<Vec<DiskNode>, String>(final_arena)
    })
    .await;

    done_flag.store(true, AtomicOrdering::Relaxed);
    let _ = progress_done_sender.send(());
    let _ = progress_emitter_handle.join();

    match scan_res {
        Ok(Ok(completed_arena)) => {
            // Scan startup and commit share this lock, making the generation
            // check and arena replacement atomic with respect to newer scans.
            let payload = {
                let _scan_guard = state
                    .cancel_flag
                    .lock()
                    .map_err(|_| "Failed to lock scan state")?;
                if state.scan_generation.load(AtomicOrdering::SeqCst) != scan_generation
                    || scan_cancel_flag.load(AtomicOrdering::Relaxed)
                {
                    return Err("Scan was superseded by a newer request".into());
                }

                let mut state_arena = state.arena.write().map_err(|_| "Failed to lock state")?;
                state_arena.nodes = completed_arena;
                state_arena.generation = scan_generation;

                build_directory_payload(&state_arena.nodes, 0)?
            };

            let skipped = skipped_count.load(AtomicOrdering::Relaxed);
            if skipped > 0 {
                let _ = app.emit(
                    "scan-warning",
                    format!("{} location(s) were inaccessible and skipped.", skipped),
                );
            }
            let depth_exceeded = depth_exceeded_count.load(AtomicOrdering::Relaxed);
            if depth_exceeded > 0 {
                let _ = app.emit(
                    "scan-warning",
                    format!(
                        "{} path(s) exceeded maximum scan depth limit (256).",
                        depth_exceeded
                    ),
                );
            }

            Ok(payload)
        }
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

/// Tauri command to retrieve the directory payload for a given node ID in the arena tree.
#[tauri::command]
pub async fn open_directory(
    node_id: u32,
    state: State<'_, AppState>,
) -> Result<DirectoryPayload, String> {
    let arena_arc = state.arena.clone();
    tokio::task::spawn_blocking(move || {
        let arena = arena_arc.read().map_err(|_| "Failed to lock state")?;
        build_directory_payload(&arena.nodes, node_id)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Tauri command to trigger the cancellation flag for an active directory scan.
#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) {
    let flag = state.cancel_flag.lock().unwrap().clone();
    flag.store(true, AtomicOrdering::Relaxed);
}
