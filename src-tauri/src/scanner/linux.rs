//! Linux-specific directory scanner implementation and extension points.

use std::io;
use std::path::Path;
use crate::models::DirEntry;

/// Specialized Linux directory scanner.
///
/// Can be extended with filesystem-specific optimizations (e.g., direct `sys_getdents64`
/// or ext4/btrfs/xfs metadata optimizations). Currently falls back to standard listing.
pub fn list_directory(path: &Path) -> io::Result<Vec<DirEntry>> {
    super::default::list_directory(path)
}
