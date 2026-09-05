use super::*;
use std::fs::{self, File};
use std::io::Write;
use tempfile::tempdir;

#[test]
fn test_get_directory_entries() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("test.txt");
    let sub_dir_path = dir.path().join("subdir");

    fs::create_dir(&sub_dir_path).unwrap();

    // Scoped block to ensure the file handle is closed and metadata is updated
    {
        let mut f = File::create(&file_path).unwrap();
        f.write_all(b"test content").unwrap();
    }

    let entries = get_directory_entries(dir.path()).unwrap();
    assert_eq!(entries.len(), 2);

    let file_entry = entries.iter().find(|e| e.name == "test.txt").unwrap();
    assert!(!file_entry.is_dir);
    assert_eq!(file_entry.size, 12);

    let dir_entry = entries.iter().find(|e| e.name == "subdir").unwrap();
    assert!(dir_entry.is_dir);

    // Test non-existent directory error
    assert!(get_directory_entries(Path::new("/non_existent_folder_xyz_123")).is_err());
}

#[test]
fn test_init_rayon_thread_pool() {
    // Safe to call multiple times due to std::sync::Once
    init_rayon_thread_pool();
    init_rayon_thread_pool();
}

#[test]
fn test_aggregate_subtree_stats_large() {
    // Create tree with >30 files to exercise min_heap replacement branch
    let mut arena = vec![DiskNode {
        name: "root".into(),
        size: 0,
        is_dir: true,
        modified_secs: 100,
        parent_id: u32::MAX,
        first_child: 1,
        next_sibling: u32::MAX,
        is_tombstoned: false,
    }];

    for i in 1..=40 {
        let next_sib = if i == 40 { u32::MAX } else { (i + 1) as u32 };
        arena.push(DiskNode {
            name: format!("file_{}.dat", i).into_boxed_str(),
            size: i * 10,
            is_dir: false,
            modified_secs: 100,
            parent_id: 0,
            first_child: u32::MAX,
            next_sibling: next_sib,
            is_tombstoned: i % 5 == 0, // tombstone every 5th item
        });
    }

    let (ext_stats, top_files) = aggregate_subtree_stats(&arena, 0);
    assert_eq!(ext_stats.len(), 1);
    assert_eq!(ext_stats[0].extension, ".dat");
    assert_eq!(top_files.len(), 30); // Truncated to top 30
    assert_eq!(top_files[0].size, 390); // file_39 is the largest non-tombstoned (file_40 is tombstoned)
}

#[test]
fn test_extract_extension() {
    assert_eq!(extract_extension("document.pdf"), ".pdf");
    assert_eq!(extract_extension("IMAGE.PNG"), ".png");
    assert_eq!(extract_extension("archive.tar.gz"), ".gz");
    assert_eq!(extract_extension("noextension"), "<no ext>");
    assert_eq!(extract_extension(".gitignore"), "<no ext>");
    assert_eq!(extract_extension("file."), "<no ext>");
}

#[test]
fn test_top_candidate_cmp() {
    let cand1 = TopCandidate { size: 100, id: 1 };
    let cand2 = TopCandidate { size: 200, id: 2 };
    let cand3 = TopCandidate { size: 100, id: 0 };

    // Min-heap behavior: higher size compares as Less so it stays on top/peeked after pop
    assert_eq!(cand1.cmp(&cand2), Ordering::Greater);
    assert_eq!(cand2.cmp(&cand1), Ordering::Less);

    // Tie-break by ID ascending
    assert_eq!(cand1.cmp(&cand3), Ordering::Greater);
}

#[test]
fn test_is_protected_path() {
    #[cfg(windows)]
    {
        assert!(is_protected_path(Path::new(r"C:\Windows\System32")));
        assert!(is_protected_path(Path::new(r"C:\Program Files\App")));
        assert!(!is_protected_path(Path::new(
            r"C:\Users\Name\Documents\Projects\MyCode"
        )));
    }

    #[cfg(target_os = "macos")]
    {
        assert!(is_protected_path(Path::new("/System/Library")));
        assert!(is_protected_path(Path::new("/usr/bin")));
        assert!(!is_protected_path(Path::new(
            "/Users/Name/Documents/Projects"
        )));
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        assert!(is_protected_path(Path::new("/usr/bin/python")));
        assert!(is_protected_path(Path::new("/etc/passwd/file")));
        assert!(!is_protected_path(Path::new("/home/user/projects/code")));
    }

    // Depth check: short paths are protected
    assert!(is_protected_path(Path::new("/")));
}

#[test]
fn test_arena_helpers_and_payload() {
    // Construct a manual tree:
    // 0: root (dir)
    //   1: folder1 (dir, child of 0)
    //     3: file1.txt (file, child of 1, 100 bytes)
    //     4: file2.pdf (file, child of 1, 200 bytes)
    //   2: file3.txt (file, child of 0, 50 bytes)
    let mut arena = vec![
        DiskNode {
            name: "root".into(),
            size: 0,
            is_dir: true,
            modified_secs: 100,
            parent_id: u32::MAX,
            first_child: 1,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        },
        DiskNode {
            name: "folder1".into(),
            size: 0,
            is_dir: true,
            modified_secs: 100,
            parent_id: 0,
            first_child: 3,
            next_sibling: 2,
            is_tombstoned: false,
        },
        DiskNode {
            name: "file3.txt".into(),
            size: 50,
            is_dir: false,
            modified_secs: 100,
            parent_id: 0,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        },
        DiskNode {
            name: "file1.txt".into(),
            size: 100,
            is_dir: false,
            modified_secs: 100,
            parent_id: 1,
            first_child: u32::MAX,
            next_sibling: 4,
            is_tombstoned: false,
        },
        DiskNode {
            name: "file2.pdf".into(),
            size: 200,
            is_dir: false,
            modified_secs: 100,
            parent_id: 1,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        },
    ];

    // Test aggregate_node
    let total = aggregate_node(0, &mut arena);
    assert_eq!(total, 350);
    assert_eq!(arena[1].size, 300);

    // Test get_node_path
    let path0 = get_node_path(0, &arena);
    assert_eq!(path0, "root");
    let path3 = get_node_path(3, &arena);
    assert_eq!(
        Path::new(&path3),
        Path::new("root").join("folder1").join("file1.txt")
    );

    // Test aggregate_subtree_stats on root
    let (ext_stats, top_files) = aggregate_subtree_stats(&arena, 0);
    assert_eq!(ext_stats.len(), 2); // .txt and .pdf
    let txt_stat = ext_stats.iter().find(|s| s.extension == ".txt").unwrap();
    assert_eq!(txt_stat.total_bytes, 150);
    assert_eq!(txt_stat.file_count, 2);
    assert_eq!(top_files.len(), 3);
    assert_eq!(top_files[0].size, 200); // Largest file first in top_files

    // Test build_directory_payload
    let payload = build_directory_payload(&arena, 0).unwrap();
    assert_eq!(payload.current_id, 0);
    assert_eq!(payload.parent_id, None);
    assert_eq!(payload.items.len(), 2);
    assert_eq!(payload.ancestors.len(), 1);

    let folder_payload = build_directory_payload(&arena, 1).unwrap();
    assert_eq!(folder_payload.parent_id, Some(0));
    assert_eq!(folder_payload.ancestors.len(), 2);

    // Test error cases for build_directory_payload
    assert!(build_directory_payload(&arena, 99).is_err());
}

#[test]
fn test_remove_node_from_tree() {
    let mut arena = vec![
        DiskNode {
            name: "root".into(),
            size: 350,
            is_dir: true,
            modified_secs: 100,
            parent_id: u32::MAX,
            first_child: 1,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        },
        DiskNode {
            name: "folder1".into(),
            size: 300,
            is_dir: true,
            modified_secs: 100,
            parent_id: 0,
            first_child: 3,
            next_sibling: 2,
            is_tombstoned: false,
        },
        DiskNode {
            name: "file3.txt".into(),
            size: 50,
            is_dir: false,
            modified_secs: 100,
            parent_id: 0,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        },
        DiskNode {
            name: "file1.txt".into(),
            size: 100,
            is_dir: false,
            modified_secs: 100,
            parent_id: 1,
            first_child: u32::MAX,
            next_sibling: 4,
            is_tombstoned: false,
        },
        DiskNode {
            name: "file2.pdf".into(),
            size: 200,
            is_dir: false,
            modified_secs: 100,
            parent_id: 1,
            first_child: u32::MAX,
            next_sibling: u32::MAX,
            is_tombstoned: false,
        },
    ];

    // Remove folder1 (id 1)
    remove_node_from_tree(1, &mut arena);

    // Root first_child should now point to file3.txt (id 2)
    assert_eq!(arena[0].first_child, 2);
    // Root size updated: 350 - 300 = 50
    assert_eq!(arena[0].size, 50);

    // Nodes 1, 3, 4 should be tombstoned
    assert!(arena[1].is_tombstoned);
    assert!(arena[3].is_tombstoned);
    assert!(arena[4].is_tombstoned);

    // Building payload on tombstoned node fails
    assert!(build_directory_payload(&arena, 1).is_err());

    // Payload on root only includes non-tombstoned children
    let root_payload = build_directory_payload(&arena, 0).unwrap();
    assert_eq!(root_payload.items.len(), 1);
    assert_eq!(root_payload.items[0].name, "file3.txt");

    // Removing non-existent node doesn't panic
    remove_node_from_tree(99, &mut arena);
}

#[test]
fn test_scan_dir_parallel() {
    let dir = tempdir().unwrap();
    let root_path = dir.path();

    // Create subdirectories and files
    let sub_dir1 = root_path.join("subdir1");
    fs::create_dir(&sub_dir1).unwrap();

    let file1 = root_path.join("hello.txt");
    {
        let mut f1 = File::create(&file1).unwrap();
        f1.write_all(b"Hello world").unwrap();
    }

    let file2 = sub_dir1.join("data.bin");
    {
        let mut f2 = File::create(&file2).unwrap();
        f2.write_all(b"1234567890").unwrap();
    }

    let cancel_flag = AtomicBool::new(false);
    let skipped_count = AtomicUsize::new(0);
    let depth_exceeded_count = AtomicUsize::new(0);
    let file_count = AtomicUsize::new(0);
    let dir_count = AtomicUsize::new(0);
    let root_file_count = AtomicUsize::new(0);
    let root_dir_count = AtomicUsize::new(0);
    let total_file_bytes = AtomicU64::new(0);
    let shared_arena = Mutex::new(vec![DiskNode {
        name: root_path.to_string_lossy().into_owned().into_boxed_str(),
        size: 0,
        is_dir: true,
        modified_secs: 0,
        parent_id: u32::MAX,
        first_child: u32::MAX,
        next_sibling: u32::MAX,
        is_tombstoned: false,
    }]);

    let res = scan_dir_parallel(
        root_path,
        0,
        &cancel_flag,
        &skipped_count,
        &depth_exceeded_count,
        &file_count,
        &dir_count,
        &root_file_count,
        &root_dir_count,
        &total_file_bytes,
        &shared_arena,
        0,
    );
    assert!(res.is_ok());
    assert_eq!(file_count.load(AtomicOrdering::Relaxed), 2); // hello.txt, data.bin
    assert_eq!(dir_count.load(AtomicOrdering::Relaxed), 1); // subdir1
    assert_eq!(root_file_count.load(AtomicOrdering::Relaxed), 1); // hello.txt only at root
    assert_eq!(root_dir_count.load(AtomicOrdering::Relaxed), 1); // subdir1 at root
    assert_eq!(total_file_bytes.load(AtomicOrdering::Relaxed), 21); // 11 + 10 bytes

    let mut final_arena = shared_arena.into_inner().unwrap();
    aggregate_node(0, &mut final_arena);

    assert!(final_arena.len() >= 4); // root, subdir1, hello.txt, data.bin
    assert_eq!(final_arena[0].size, 21); // 11 + 10 bytes

    // Test cancel flag
    let cancel_flag_true = AtomicBool::new(true);
    let shared_arena2 = Mutex::new(vec![]);
    let res_cancelled = scan_dir_parallel(
        root_path,
        0,
        &cancel_flag_true,
        &skipped_count,
        &depth_exceeded_count,
        &file_count,
        &dir_count,
        &root_file_count,
        &root_dir_count,
        &total_file_bytes,
        &shared_arena2,
        0,
    );
    assert!(res_cancelled.is_err());

    // Test depth limit
    let depth_exceeded_count2 = AtomicUsize::new(0);
    let shared_arena3 = Mutex::new(vec![]);
    let res_depth = scan_dir_parallel(
        root_path,
        0,
        &cancel_flag,
        &skipped_count,
        &depth_exceeded_count2,
        &file_count,
        &dir_count,
        &root_file_count,
        &root_dir_count,
        &total_file_bytes,
        &shared_arena3,
        257,
    );
    assert!(res_depth.is_ok());
    assert_eq!(depth_exceeded_count2.load(AtomicOrdering::Relaxed), 1);
}

#[test]
fn test_scan_dir_parallel_edge_cases() {
    let dir = tempdir().unwrap();
    let root_path = dir.path();

    // 1. Empty directory
    let empty_dir = root_path.join("empty");
    fs::create_dir(&empty_dir).unwrap();

    // 2. Symlink / Reparse point (if OS supports it)
    let file_path = root_path.join("real.txt");
    File::create(&file_path)
        .unwrap()
        .write_all(b"data")
        .unwrap();

    #[cfg(unix)]
    let symlink_path = root_path.join("link.txt");
    #[cfg(unix)]
    let _ = std::os::unix::fs::symlink(&file_path, &symlink_path);

    let cancel_flag = AtomicBool::new(false);
    let skipped_count = AtomicUsize::new(0);
    let depth_exceeded_count = AtomicUsize::new(0);
    let file_count = AtomicUsize::new(0);
    let dir_count = AtomicUsize::new(0);
    let root_file_count = AtomicUsize::new(0);
    let root_dir_count = AtomicUsize::new(0);
    let total_file_bytes = AtomicU64::new(0);
    let shared_arena = Mutex::new(vec![DiskNode {
        name: root_path.to_string_lossy().into_owned().into_boxed_str(),
        size: 0,
        is_dir: true,
        modified_secs: 0,
        parent_id: u32::MAX,
        first_child: u32::MAX,
        next_sibling: u32::MAX,
        is_tombstoned: false,
    }]);

    let res = scan_dir_parallel(
        root_path,
        0,
        &cancel_flag,
        &skipped_count,
        &depth_exceeded_count,
        &file_count,
        &dir_count,
        &root_file_count,
        &root_dir_count,
        &total_file_bytes,
        &shared_arena,
        0,
    );
    assert!(res.is_ok());

    // 3. Non-existent path causes skipped_count increment
    let non_existent = root_path.join("does_not_exist");
    let res_non_exist = scan_dir_parallel(
        &non_existent,
        0,
        &cancel_flag,
        &skipped_count,
        &depth_exceeded_count,
        &file_count,
        &dir_count,
        &root_file_count,
        &root_dir_count,
        &total_file_bytes,
        &shared_arena,
        0,
    );
    assert!(res_non_exist.is_ok());
    assert_eq!(skipped_count.load(AtomicOrdering::Relaxed), 1);
}

#[test]
fn test_cancel_scan_logic() {
    let state = AppState {
        arena: Arc::new(RwLock::new(ArenaTree::default())),
        cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))),
    };
    let flag = state.cancel_flag.lock().unwrap().clone();
    assert!(!flag.load(AtomicOrdering::Relaxed));

    // Simulate cancel_scan logic
    let flag_to_cancel = state.cancel_flag.lock().unwrap().clone();
    flag_to_cancel.store(true, AtomicOrdering::Relaxed);

    assert!(flag.load(AtomicOrdering::Relaxed));
}

#[test]
fn test_get_disk_info() {
    let temp = tempdir().unwrap();
    let path_str = temp.path().to_string_lossy().to_string();

    let info = get_disk_info(path_str);
    assert!(info.is_ok());
    let disk_info = info.unwrap();
    assert!(disk_info.total_bytes > 0);

    let err_info = get_disk_info("/non/existent/path/123456789".to_string());
    assert!(err_info.is_err());
}
