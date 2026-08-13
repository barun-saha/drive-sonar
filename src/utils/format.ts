/**
 * Formats a byte number into a human-readable string (e.g., 1024 -> "1 KB").
 */
export function formatBytes(bytes: number, useShortUnits: boolean = false): string {
  if (bytes === 0) return useShortUnits ? '0 B' : '0 Bytes';
  const k = 1024;
  const sizes = useShortUnits
    ? ['B', 'KB', 'MB', 'GB', 'TB']
    : ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
