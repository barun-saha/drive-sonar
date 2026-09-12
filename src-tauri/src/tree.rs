//! Left-Child Right-Sibling (LCRS) tree manipulation, size aggregation, and payload construction.

use std::collections::{BinaryHeap, HashMap};
use std::path::{Path, PathBuf};

use crate::models::{
    BreadcrumbItem, DirectoryPayload, DiskNode, ExtensionStat, TopCandidate, TopFileNode,
    UiDiskNode,
};

/// Checks whether a given path is a protected OS system directory to prevent accidental deletion.
pub fn is_protected_path(path: &Path) -> bool {
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
            "bin", "sbin", "usr", "etc", "lib", "dev", "private", "system", "library", "cores",
            "volumes",
        ];

        #[cfg(all(not(windows), not(target_os = "macos")))]
        let blocked: &[&str] = &[
            "bin",
            "sbin",
            "usr",
            "etc",
            "lib",
            "lib64",
            "lib32",
            "boot",
            "dev",
            "proc",
            "sys",
            "run",
            "tmp",
            "var",
            "root",
            "snap",
            "lost+found",
        ];

        if blocked.contains(&name.as_str()) {
            return true;
        }
    }

    false
}

/// Aggregates folder sizes throughout the arena using post-order DFS traversal and returns root size.
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

/// Reconstructs the absolute file system path for a given node by traversing upward through parent links.
pub fn get_node_path(node_id: u32, arena: &[DiskNode]) -> String {
    let mut parts = Vec::new();
    let mut current_id = node_id;

    while current_id != u32::MAX {
        let node = &arena[current_id as usize];
        parts.push(node.name.as_ref());
        current_id = node.parent_id;
    }

    parts.reverse();
    let mut path_buf = PathBuf::new();
    for part in parts {
        path_buf.push(part);
    }
    path_buf.to_string_lossy().into_owned()
}

/// Helper function to parse and isolate a lowercased extension string from a file name.
pub fn extract_extension(name: &str) -> String {
    if let Some(idx) = name.rfind('.') {
        if idx > 0 && idx < name.len() - 1 {
            return name[idx..].to_lowercase();
        }
    }
    "<no ext>".to_string()
}

/// Collects file extension totals and tracks the top 30 largest files inside a target subtree using a min-heap.
pub fn aggregate_subtree_stats(
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
                        min_heap.push(TopCandidate {
                            size: node.size,
                            id: curr_child,
                        });
                    } else if let Some(smallest) = min_heap.peek() {
                        if node.size > smallest.size {
                            min_heap.pop();
                            min_heap.push(TopCandidate {
                                size: node.size,
                                id: curr_child,
                            });
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
    extension_stats.sort_unstable_by_key(|b| std::cmp::Reverse(b.total_bytes));
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
                path: get_node_path(cand.id, arena),
            }
        })
        .collect();

    (extension_stats, top_files)
}

/// Builds a complete `DirectoryPayload` containing UI node lists, ancestors, and aggregated stats for a node.
pub fn build_directory_payload(arena: &[DiskNode], node_id: u32) -> Result<DirectoryPayload, String> {
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
                percentage_of_parent: if parent_size > 0.0 {
                    (child.size as f32 / parent_size) * 100.0
                } else {
                    0.0
                },
            });
        }
        child_id = child.next_sibling;
    }

    items.sort_unstable_by_key(|b| std::cmp::Reverse(b.size));

    let (extension_stats, top_files) = aggregate_subtree_stats(arena, node_id);
    let total_scanned_items = arena.len().saturating_sub(1);

    // Hierarchy of ancestors of the current dir
    let mut ancestors = Vec::new();
    let mut current_id = node_id;

    while current_id != u32::MAX {
        let node = &arena[current_id as usize];
        ancestors.push(BreadcrumbItem {
            id: current_id,
            name: node.name.to_string(),
        });
        current_id = node.parent_id;
    }
    // Root first, current folder last
    ancestors.reverse();

    Ok(DirectoryPayload {
        current_id: node_id,
        current_path,
        parent_id: if node.parent_id == u32::MAX {
            None
        } else {
            Some(node.parent_id)
        },
        ancestors,
        items,
        extension_stats,
        top_files,
        total_scanned_items,
    })
}

/// Unlinks a node from its parent's sibling chain, adjusts ancestor sizes, and marks descendants as tombstoned.
pub fn remove_node_from_tree(node_id: u32, arena: &mut [DiskNode]) {
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
