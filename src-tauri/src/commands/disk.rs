//! Disk capacity and storage volume querying commands.

use std::path::Path;
use crate::models::DiskInfo;

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

/// Tauri command to query total and free byte capacity for the drive containing a path.
#[tauri::command]
pub fn get_disk_info(path: String) -> Result<DiskInfo, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = p
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0u16))
            .collect();
        let mut free_caller: u64 = 0;
        let mut total: u64 = 0;
        let mut free_total: u64 = 0;

        let ok = unsafe {
            GetDiskFreeSpaceExW(
                PCWSTR(wide.as_ptr()),
                Some(&mut free_caller),
                Some(&mut total),
                Some(&mut free_total),
            )
        };

        if ok.is_err() {
            return Err(format!("GetDiskFreeSpaceExW failed for '{}'", path));
        }
        Ok(DiskInfo {
            total_bytes: total,
            free_bytes: free_caller,
        })
    }

    #[cfg(not(windows))]
    {
        use sysinfo::Disks;
        let disks = Disks::new_with_refreshed_list();
        let canonical = p.canonicalize().map_err(|e| e.to_string())?;
        let best = disks
            .iter()
            .filter(|d| canonical.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len());

        match best {
            Some(disk) => Ok(DiskInfo {
                total_bytes: disk.total_space(),
                free_bytes: disk.available_space(),
            }),
            None => Err(format!("No mounted disk found for path '{}'", path)),
        }
    }
}
