export interface FlatFileEntry {
  path: string;
  parent_path: string;
  name: string;
  size: number;
  is_dir: boolean;
  modified_secs: number;
  normPath?: string; // Pre-normalized path for rapid matching
}
