//! File operation commands such as opening items in the OS explorer or trashing files.

use tauri::State;

use crate::models::AppState;
use crate::tree::{get_node_path, is_protected_path, remove_node_from_tree};

/// Tauri command to reveal a node in the native system file explorer.
#[tauri::command]
pub fn open_in_explorer(node_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let (path, is_dir) = {
        let arena = state.arena.read().map_err(|_| "Failed to lock state")?;
        if node_id as usize >= arena.nodes.len() {
            return Err("Invalid ID".into());
        }
        let node = &arena.nodes[node_id as usize];
        if node.is_tombstoned {
            return Err("Node has been removed".into());
        }
        (get_node_path(node_id, &arena.nodes), node.is_dir)
    };

    if is_dir {
        tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    } else {
        tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command to move a file or directory node to the OS trash bin and remove it from state.
#[tauri::command]
pub async fn move_to_trash(node_id: u32, state: State<'_, AppState>) -> Result<bool, String> {
    let (arena_generation, node_path) = {
        let arena = state.arena.read().map_err(|_| "Failed to lock state")?;
        if node_id as usize >= arena.nodes.len() {
            return Err("Invalid ID".into());
        }
        let node = &arena.nodes[node_id as usize];
        if node.is_tombstoned {
            return Err("Node has been removed".into());
        }
        (arena.generation, get_node_path(node_id, &arena.nodes))
    };

    if is_protected_path(&node_path) {
        return Err(format!(
            "Refusing to delete protected path: {}",
            node_path.display()
        ));
    }

    let delete_path = node_path.clone();
    tokio::task::spawn_blocking(move || trash::delete(&delete_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
        .map_err(|e| e.to_string())?;

    let mut arena = state.arena.write().map_err(|_| "Failed to lock state")?;
    if remove_node_from_tree(node_id, arena_generation, &node_path, &mut arena).is_err() {
        // The filesystem operation succeeded, but a newer scan now owns the
        // arena. Tell the UI to reconcile rather than unlinking a reused ID.
        return Ok(true);
    }

    Ok(false)
}
