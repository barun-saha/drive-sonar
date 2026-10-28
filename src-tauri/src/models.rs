//! Data models, shared state, and payload types for Drive Sonar.

use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Ordering;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, RwLock};

// -----------------------------------------------------------------------------
// Data Structures: Arena Tree & Payloads
// -----------------------------------------------------------------------------

#[derive(Clone)]
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
    pub generation: u64,
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
    pub path: String,
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
    /// Free bytes available to the calling user (may be less than `free_total_bytes` under quotas).
    /// Used for the UI "X GB free" display.
    pub free_bytes: u64,
    /// Total free bytes on the volume regardless of per-user quotas.
    /// Used for the unaccounted-space gap calculation to avoid false positives.
    pub free_total_bytes: u64,
}

#[derive(Clone, Serialize)]
pub struct ScanProgress {
    pub file_count: usize,
    pub dir_count: usize,
    pub root_file_count: usize,
    pub root_dir_count: usize,
    pub total_file_bytes: u64,
    pub elapsed_secs: f64,
}

/// Identity of one non-directory entry (`FileId` on Windows, inode on Unix) paired with the
/// arena index of its node.
///
/// Packed to 12 bytes: a plain `(u64, u32)` would be padded to 16. Fields are only ever
/// copied out, never borrowed, which is what makes `packed` sound here.
#[derive(Clone, Copy)]
#[repr(C, packed)]
pub struct FileIdentity {
    pub id: u64,
    pub node_idx: u32,
}

/// Collects file identities during a scan so hardlinked files can be resolved exactly, once
/// the scan has finished.
///
/// Workers append one directory's batch at a time, so there is no per-file locking. The cost
/// is 12 bytes per file that has a non-zero identity, held only until `resolve` consumes it.
/// Each scan owns its own instance, so overlapping scans cannot affect each other.
#[derive(Default)]
pub struct HardlinkIds {
    entries: Mutex<Vec<FileIdentity>>,
}

impl HardlinkIds {
    /// Appends the identities of one directory's files (node indices already absolute).
    pub fn extend(&self, batch: &[FileIdentity]) {
        if !batch.is_empty() {
            self.entries.lock().unwrap().extend_from_slice(batch);
        }
    }

    /// Zeroes the size of every node that shares an identity with a lower-indexed node, so each
    /// hardlinked file's bytes are counted exactly once. Must run before `aggregate_node`.
    ///
    /// Returns the number of bytes removed. Which link of a group keeps its size is the one
    /// with the lowest arena index, which depends on worker scheduling; totals are exact.
    pub fn resolve(self, arena: &mut [DiskNode]) -> u64 {
        let mut entries = self.entries.into_inner().unwrap();
        entries.par_sort_unstable_by_key(|e| (e.id, e.node_idx));

        let mut removed = 0u64;
        let mut previous_id: Option<u64> = None;
        for entry in &entries {
            let (id, node_idx) = (entry.id, entry.node_idx);
            if previous_id == Some(id) {
                let node = &mut arena[node_idx as usize];
                removed += node.size;
                node.size = 0;
            }
            previous_id = Some(id);
        }
        removed
    }
}

pub struct AppState {
    pub arena: Arc<RwLock<ArenaTree>>,
    pub cancel_flag: Mutex<Arc<AtomicBool>>,
    pub scan_generation: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            arena: Arc::new(RwLock::new(ArenaTree::default())),
            cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
            scan_generation: AtomicU64::new(0),
        }
    }
}

#[derive(Clone)]
pub struct DirEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_reparse_point: bool,
    pub modified_secs: u64,
    pub file_id: u64,
}

#[derive(Eq, PartialEq)]
pub struct TopCandidate {
    pub size: u64,
    pub id: u32,
}

impl Ord for TopCandidate {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse size ordering for min-heap behavior, then deterministic id tiebreak
        other
            .size
            .cmp(&self.size)
            .then_with(|| self.id.cmp(&other.id))
    }
}

impl PartialOrd for TopCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
