#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Drive Sonar backend crate.
//!
//! Exposes Tauri commands, file system scanners, and arena tree data structures
//! for fast, parallel disk usage analysis.

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, RwLock};

pub mod commands;
pub mod models;
pub mod scanner;
pub mod tree;

use commands::disk::get_disk_info;
use commands::file_ops::{move_to_trash, open_in_explorer};
use commands::scan::{cancel_scan, open_directory, scan_directory};
use models::{AppState, ArenaTree};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Builds and executes the main Tauri application instance.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            arena: Arc::new(RwLock::new(ArenaTree::default())),
            cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
            scan_generation: AtomicU64::new(0),
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

#[cfg(test)]
mod tests;
