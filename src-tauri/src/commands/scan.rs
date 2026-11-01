//! Commands for initiating, canceling, and navigating directory scans.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{Emitter, State};

use crate::models::{AppState, DirectoryPayload, DiskNode, HardlinkIds, ScanProgress, TIMERS};
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
    let filesystem_skipped_count = Arc::new(AtomicUsize::new(0));
    let filesystem_skipped_count_task = Arc::clone(&filesystem_skipped_count);
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
    TIMERS.reset();

    // Each scan owns its identity list: a canceled blocking task may still be running
    // when a new scan starts, and the two must not share hardlink state.
    let hardlink_ids = HardlinkIds::default();

    let scan_res = tokio::task::spawn_blocking(move || {
        // Resolve the device ID of the scan root once
        // On Unix this is used to skip subdirectories on different filesystems (e.g. /proc, /sys)
        let root_dev = get_dev(&canonical);

        let t_walk = std::time::Instant::now();
        scan_dir_parallel(
            &canonical,
            0,
            &scan_cancel_flag_task,
            &skipped_count_task,
            &filesystem_skipped_count_task,
            &depth_exceeded_count_task,
            &file_count_task,
            &dir_count_task,
            &root_file_count_task,
            &root_dir_count_task,
            &total_file_bytes_task,
            &shared_arena,
            0,
            root_dev,
            &hardlink_ids,
        )?;

        let walk_secs = t_walk.elapsed().as_secs_f64();
        let mut final_arena = shared_arena.into_inner().unwrap();
        let t_resolve = std::time::Instant::now();
        // Count each hardlinked file's bytes once: zero all but one link, then drop the
        // identity list before the tree is aggregated and stored. The live progress counter
        // included every link, so bring it in line with the final totals.
        let duplicate_bytes = hardlink_ids.resolve(&mut final_arena);
        total_file_bytes_task.fetch_sub(duplicate_bytes, AtomicOrdering::Relaxed);
        let resolve_secs = t_resolve.elapsed().as_secs_f64();
        let t_aggregate = std::time::Instant::now();
        aggregate_node(0, &mut final_arena);
        let aggregate_secs = t_aggregate.elapsed().as_secs_f64();
        // Deliberately no shrink_to_fit(): it reallocates and copies the entire arena.
        Ok::<(Vec<DiskNode>, [f64; 3]), String>((
            final_arena,
            [walk_secs, resolve_secs, aggregate_secs],
        ))
    })
    .await;

    done_flag.store(true, AtomicOrdering::Relaxed);
    let _ = progress_done_sender.send(());
    let _ = progress_emitter_handle.join();

    match scan_res {
        Ok(Ok((completed_arena, phase_secs))) => {
            // Scan startup and commit share this lock, making the generation
            // check and arena replacement atomic with respect to newer scans.
            let (payload, payload_secs) = {
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

                let t_payload = std::time::Instant::now();
                let payload = build_directory_payload(&state_arena.nodes, 0)?;
                (payload, t_payload.elapsed().as_secs_f64())
            };

            // DIAGNOSTIC BUILD: report where the scan's time went.
            report_scan_timing(&app, &phase_secs, payload_secs);

            let skipped = skipped_count.load(AtomicOrdering::Relaxed);
            if skipped > 0 {
                let _ = app.emit(
                    "scan-warning",
                    format!("{} location(s) were inaccessible and skipped.", skipped),
                );
            }
            let filesystem_skipped = filesystem_skipped_count.load(AtomicOrdering::Relaxed);
            if filesystem_skipped > 0 {
                let _ = app.emit(
                    "scan-warning",
                    format!(
                        "{} location(s) on other filesystems were intentionally skipped.",
                        filesystem_skipped
                    ),
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

/// DIAGNOSTIC BUILD: shows where the scan's time went, as toasts and in
/// `%TEMP%\drivesonar-diag.txt` (appended to, one block per scan).
///
/// "wall" figures are real elapsed seconds. "summed" figures add up the time all worker
/// threads spent in that call, so divide by the thread count to compare them with wall time.
fn report_scan_timing(app: &tauri::AppHandle, phase_secs: &[f64; 3], payload_secs: f64) {
    use std::sync::atomic::Ordering::Relaxed;
    let secs = |ns: u64| ns as f64 / 1e9;
    let threads = rayon::current_num_threads();
    let dirs = TIMERS.dirs.load(Relaxed);
    let lines = [
        format!(
            "wall: walk {:.2}s, resolve {:.2}s, aggregate {:.2}s, payload {:.2}s (threads {}, dirs {})",
            phase_secs[0], phase_secs[1], phase_secs[2], payload_secs, threads, dirs
        ),
        format!(
            "summed: list {:.1}s = open {:.1}s + query {:.1}s ({} calls) + parse {:.1}s + close {:.1}s",
            secs(TIMERS.list_ns.load(Relaxed)),
            secs(TIMERS.open_ns.load(Relaxed)),
            secs(TIMERS.query_ns.load(Relaxed)),
            TIMERS.query_calls.load(Relaxed),
            secs(TIMERS.parse_ns.load(Relaxed)),
            secs(TIMERS.close_ns.load(Relaxed)),
        ),
        format!(
            "summed: arena lock wait {:.2}s; list per thread {:.1}s",
            secs(TIMERS.lock_wait_ns.load(Relaxed)),
            secs(TIMERS.list_ns.load(Relaxed)) / threads.max(1) as f64
        ),
    ];

    for line in &lines {
        let _ = app.emit("scan-warning", format!("Diag {}", line));
    }
    let _ = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::env::temp_dir().join("drivesonar-diag.txt"))?;
        writeln!(file, "--- scan finished ---")?;
        for line in &lines {
            writeln!(file, "{}", line)?;
        }
        Ok(())
    })();
}
