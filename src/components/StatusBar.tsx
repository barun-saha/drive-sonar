import { useMemo } from 'react';
import { Group, Text } from '@mantine/core';

import { DiskInfo, ScanProgress } from '../types';
import { formatBytes } from '../utils/format';

interface StatusBarProps {
  isScanning: boolean;
  scanTime: number | null;
  totalItems: number;
  scanProgress?: ScanProgress | null;
  diskInfo: DiskInfo | null;
  scanPath: string;
  rootScanBytes: number;
  warningCount: number;
}

export function StatusBar({
  isScanning, scanTime, totalItems, scanProgress, diskInfo, scanPath, rootScanBytes, warningCount
}: StatusBarProps) {

  /** True when the scanned path is the root of a volume (C:\, C:/, /, etc.) */
  const isVolumeRoot = useMemo(() => {
    if (!scanPath) return false;
    if (/^[A-Za-z]:[/\\]?$/.test(scanPath)) return true; // Windows: C:\, C:/, or C:
    if (scanPath === '/') return true;                    // Unix root
    return false;
  }, [scanPath]);

  const SYSTEM_ALLOC_THRESHOLD = 1_073_741_824; // 1 GiB

  /** Unaccounted bytes = OS used − scanned root bytes. Only non-zero after a
   *  completed root-volume scan with a gap ≥ 1 GiB. */
  const systemAllocationBytes = useMemo(() => {
    if (!isVolumeRoot || !diskInfo || scanTime === null) return 0;
    // Use free_total_bytes (volume-wide free) not free_bytes (per-user quota free)
    // to avoid reporting still-free space as "unaccounted" under quota restrictions.
    const usedByOS = diskInfo.total_bytes - diskInfo.free_total_bytes;
    const delta = usedByOS - rootScanBytes;
    return delta >= SYSTEM_ALLOC_THRESHOLD ? delta : 0;
  }, [isVolumeRoot, diskInfo, scanTime, rootScanBytes]);

  const scanDone = scanTime !== null;
  const showScanTotals = scanDone || (isScanning && !!scanProgress);
  const scannedItems = scanDone
    ? totalItems
    : (scanProgress ? scanProgress.file_count + scanProgress.dir_count : 0);
  const elapsedSecs = scanDone ? scanTime / 1000 : (scanProgress?.elapsed_secs ?? 0);

  return (
    <div
      style={{
        flexShrink: 0,
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border-color)',
        padding: '4px 16px',
      }}
    >
      <Group gap="md" wrap="nowrap" justify="space-between" h={20}>
        <Text size="xs" c="dimmed" truncate="end" style={{ minWidth: 0 }}>
          {showScanTotals && (
            <>
              <Text span fw={600} inherit>{scannedItems.toLocaleString()}</Text>{' '}
              {scannedItems === 1 ? 'item' : 'items'} scanned in{' '}
              <Text span fw={600} inherit>{elapsedSecs.toFixed(2)} s</Text>
            </>
          )}
        </Text>

        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          {systemAllocationBytes > 0 && (
            <Text size="xs" c="dimmed" truncate="end">
              ~<Text span fw={600} inherit>{formatBytes(systemAllocationBytes)}</Text>{' '}
              unaccounted (filesystem metadata / inaccessible regions)
            </Text>
          )}
          {warningCount > 0 && (
            <Text size="xs" c="var(--status-warning)" style={{ whiteSpace: 'nowrap' }}>
              {warningCount.toLocaleString()} {warningCount === 1 ? 'warning' : 'warnings'}
            </Text>
          )}
        </Group>
      </Group>
    </div>
  );
}
