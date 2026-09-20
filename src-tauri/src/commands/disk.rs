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
        // Fix for #61 (Drive statistics unavailable on Linux) and #62 (Wrong drive stats on WSL)
        //
        // Instead of querying sysinfo, which only discovers physical block devices and fails
        // on virtual/overlay filesystems, btrfs subvolumes, tmpfs, LVM, or WSL mounts,
        // use POSIX statvfs directly to query filesystem stats for the target path
        use std::ffi::CString;
        use std::mem::MaybeUninit;
        use std::os::unix::ffi::OsStrExt;

        let c_path = CString::new(p.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let mut stat = MaybeUninit::<libc::statvfs>::uninit();
        let res = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
        if res != 0 {
            return Err(format!(
                "statvfs failed for '{}': {}",
                path,
                std::io::Error::last_os_error()
            ));
        }
        let stat = unsafe { stat.assume_init() };

        // f_frsize is the fundamental filesystem block size used for
        // block counts (f_blocks, f_bavail)
        // Fall back to f_bsize if f_frsize is 0 or unpopulated
        let block_size = if stat.f_frsize > 0 {
            stat.f_frsize as u64
        } else {
            stat.f_bsize as u64
        };

        // f_blocks: total data blocks in filesystem
        // f_bavail: free blocks available to unprivileged users
        let total_bytes = (stat.f_blocks as u64).saturating_mul(block_size);
        let free_bytes = (stat.f_bavail as u64).saturating_mul(block_size);

        Ok(DiskInfo {
            total_bytes,
            free_bytes,
        })
    }
}
