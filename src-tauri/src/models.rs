//! Data models, shared state, and payload types for Drive Sonar.

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
    pub free_bytes: u64,
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

pub struct AppState {
    pub arena: Arc<RwLock<ArenaTree>>,
    pub cancel_flag: Mutex<Arc<AtomicBool>>,
    pub scan_generation: AtomicU64,
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
