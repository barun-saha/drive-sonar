/**
 * Formats a byte number into a human-readable string (e.g., 1024 -> "1.00 KB").
 */
export function formatBytes(bytes: number, useShortUnits: boolean = false): string {
  if (bytes <= 0 || Number.isNaN(bytes)) {
    return useShortUnits ? '0 B' : '0 Bytes';
  }

  const sizes = useShortUnits
    ? ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']
    : ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];

  // Base-2 log divided by 10 determines exponent index (1024 = 2^10)
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), sizes.length - 1);

  const formattedValue = i === 0
    ? bytes.toString()
    : (bytes / Math.pow(1024, i)).toFixed(2);

  return `${formattedValue} ${sizes[i]}`;
}
