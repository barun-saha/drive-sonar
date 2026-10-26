export type FileCategory = 'folder' | 'media' | 'documents' | 'archives' | 'code' | 'installers' | 'other';

/** Display order, also used for legends */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  folder: 'Folders',
  media: 'Media',
  documents: 'Documents',
  archives: 'Archives',
  code: 'Code',
  installers: 'Installers',
  other: 'Other',
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as FileCategory[];

const EXTENSIONS: Record<Exclude<FileCategory, 'folder' | 'other'>, string[]> = {
  media: [
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic', 'tif', 'tiff', 'raw',
    'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma',
    'mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'flv', 'm4v',
  ],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'md', 'rtf', 'csv', 'epub'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst'],
  code: [
    'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'swift',
    'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'toml', 'sh', 'ps1', 'bat', 'sql',
  ],
  installers: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'iso'],
};

const CATEGORY_BY_EXTENSION = new Map<string, FileCategory>(
  Object.entries(EXTENSIONS).flatMap(([category, exts]) => exts.map((ext) => [ext, category as FileCategory]))
);

/** Accepts an extension with or without the leading dot, in any case (e.g. ".MP4"). */
export function categoryOfExtension(extension: string): FileCategory {
  return CATEGORY_BY_EXTENSION.get(extension.replace(/^\./, '').toLowerCase()) ?? 'other';
}

/** Mirrors the backend rule: no extension for names like "readme", ".gitignore" or "file." */
export function categoryOfItem(name: string, isDir: boolean): FileCategory {
  if (isDir) return 'folder';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? categoryOfExtension(name.slice(dot)) : 'other';
}

/** CSS variable defined by the theme, so it follows the light/dark scheme */
export function categoryColor(category: FileCategory): string {
  return `var(--cat-${category})`;
}
