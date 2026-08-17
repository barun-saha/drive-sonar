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
}

export interface DirectoryPayload {
  current_id: number;
  current_path: string;
  parent_id: number | null;
  items: UiDiskNode[];
  extension_stats: ExtensionStat[];
  top_files: TopFileNode[];
}

export interface DiskInfo {
  total_bytes: number;
  free_bytes: number;
}
