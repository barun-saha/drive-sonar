export interface UiDiskNode {
  id: number;
  name: string;
  is_dir: boolean;
  size: number;
  modified_secs: number;
  percentage_of_parent: number;
}

export interface ExtensionStat {
  extension: string;
  total_bytes: number;
  file_count: number;
}

export interface TopFileNode {
  id: number;
  name: string;
  size: number;
  modified_secs: number;
  path: string;
}

export interface BreadcrumbItem {
  id: number;
  name: string;
}

export interface DirectoryPayload {
  current_id: number;
  current_path: string;
  parent_id: number | null;
  ancestors: BreadcrumbItem[];
  items: UiDiskNode[];
  extension_stats: ExtensionStat[];
  top_files: TopFileNode[];
  total_scanned_items: number;
}

export interface DiskInfo {
  total_bytes: number;
  free_bytes: number;
}

export interface ScanProgress {
  file_count: number;
  dir_count: number;
  root_file_count: number;
  root_dir_count: number;
  total_file_bytes: number;
  elapsed_secs: number;
}

export interface KeyStats {
  scanPath: string;
  totalDriveBytes?: number;
  totalDriveUsed?: number;
  totalDriveFree?: number;
  totalBytes: number;
  totalFiles: number;
  totalDirectories: number;
  scanDurationMs?: number;
}

export interface DirNode {
  name: string;
  path: string;
  size: number;
}
