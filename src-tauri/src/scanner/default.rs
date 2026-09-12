//! Cross-platform standard library directory scanner fallback (`std::fs::read_dir`).

use crate::models::DirEntry;
use std::path::Path;

/// Lists directory contents using standard library `std::fs::read_dir`.
/// This serves as the default, cross-platform fallback directory scanner.
pub fn list_directory(path: &Path) -> std::io::Result<Vec<DirEntry>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let is_dir = file_type.is_dir();
        let is_symlink = file_type.is_symlink();
        let meta = entry.metadata().ok();
        let native_name = entry.file_name();

        entries.push(DirEntry {
            name: native_name.to_string_lossy().into_owned(),
            native_name,
            size: if is_dir {
                0
            } else {
                meta.as_ref().map(|m| m.len()).unwrap_or(0)
            },
            is_dir,
            is_reparse_point: is_symlink,
            modified_secs: meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
    }
    Ok(entries)
}
