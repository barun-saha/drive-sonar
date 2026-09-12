//! File operation commands such as opening items in the OS explorer or trashing files.

use std::path::Path;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::models::AppState;
use crate::tree::{get_node_path, is_protected_path, remove_node_from_tree};

/// Tauri command to reveal a node in the native system file explorer.
#[tauri::command]
pub fn open_in_explorer(
    app: tauri::AppHandle,
    node_id: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (path_str, is_dir) = {
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
        app.opener()
            .open_path(&path_str, None::<&str>)
            .map_err(|e| e.to_string())?;
    } else {
        app.opener()
            .reveal_item_in_dir(&path_str)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command to move a file or directory node to the OS trash bin and remove it from state.
#[tauri::command]
pub async fn move_to_trash(node_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let path_str = {
        let arena = state.arena.read().map_err(|_| "Failed to lock state")?;
        if node_id as usize >= arena.nodes.len() {
            return Err("Invalid ID".into());
        }
        let node = &arena.nodes[node_id as usize];
        if node.is_tombstoned {
            return Err("Node has been removed".into());
        }
        get_node_path(node_id, &arena.nodes)
    };

    let path = Path::new(&path_str);
    if is_protected_path(path) {
        return Err(format!(
            "Refusing to delete protected path: {}",
            path.display()
        ));
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
