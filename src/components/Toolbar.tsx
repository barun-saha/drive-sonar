import { useMemo } from 'react';
import { Group, TextInput, Button, Text, ActionIcon, Stack, Divider } from '@mantine/core';
import { Search, FolderOpen, Loader2, CircleX, Folder, File, HardDrive, SearchCheck, Pin } from 'lucide-react';

import { DiskInfo, ScanProgress } from '../types';
import { formatBytes } from '../utils/format';

interface ToolbarProps {
  targetPath: string;
  setTargetPath: (path: string) => void;
  onBrowse: () => void;
  onScan: () => void;
  onCancel: () => void;
  isScanning: boolean;
  scanTime: number | null;
  totalItems: number;
  diskInfo: DiskInfo | null;
  scanPath: string;
  dirCount: number;
  fileCount: number;
  currentViewSize: number;
  scanProgress?: ScanProgress | null;
}

export function Toolbar({
  targetPath, setTargetPath, onBrowse, onScan, onCancel, isScanning,
  scanTime, totalItems, diskInfo, scanPath, dirCount, fileCount, currentViewSize,
  scanProgress
}: ToolbarProps) {

  const driveLabel = useMemo(() => {
    if (!scanPath) return 'Disk';
    const match = scanPath.match(/^([a-zA-Z]:)/);
    return match ? `Drive (${match[1].toUpperCase()})` : 'Disk';
  }, [scanPath]);

  // Disk info is available as soon as the parallel call resolves
  const showDiskInfo = diskInfo !== null && scanPath !== '';
  // Scan-specific stats only available after scan completes
  const showScanStats = scanTime !== null;
  // Dynamic dir counts shown once scan is done
  const showDirCounts = showScanStats;

  return (
    <div style={{ background: 'var(--bg-panel)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      {/* Self-contained animation styles */}
      <style>{`
        @keyframes ui-bridge-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .force-spin {
          animation: ui-bridge-spin 1s linear infinite !important;
          transform-origin: center !important;
          display: inline-block !important;
        }
      `}</style>

      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Group style={{ flex: 1 }}>
            <TextInput
              placeholder="Select a target directory to scan..."
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              style={{ flex: 1 }}
              styles={{
                input: { backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }
              }}
              rightSection={
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={onBrowse}
                  disabled={isScanning}
                  title="Browse folder"
                >
                  <FolderOpen size={16} />
                </ActionIcon>
              }
            />
            <Button
              onClick={() => onScan()}
              disabled={isScanning || !targetPath.trim()}
              leftSection={isScanning ? <Loader2 size={16} className="force-spin" /> : <Search size={16} />}
            >
              {isScanning ? 'Scanning...' : 'Run Scan'}
            </Button>
            <Button
              color="red"
              variant="light"
              onClick={onCancel}
              disabled={!isScanning}
              leftSection={<CircleX size={16} />}
            >
              Cancel Scan
            </Button>
          </Group>
        </Group>

        {/* ── Line 1: Disk Capacity + Scan Performance ── */}
        {showDiskInfo && (
          <Group gap="xs" align="center" wrap="wrap" pt={2}>
            {/* Drive Label */}
            <HardDrive size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {driveLabel}:
            </Text>

            {/* Total Capacity */}
            <Text size="sm" c="dimmed">
              <Text span fw={600}>
                {formatBytes(diskInfo!.total_bytes)}
              </Text>{' '}
              total
            </Text>

            <Text size="sm" c="dimmed">•</Text>

            {/* Used Capacity */}
            <Text size="sm" c="dimmed">
              <Text span fw={600}>
                {formatBytes(diskInfo!.total_bytes - diskInfo!.free_bytes)}
              </Text>{' '}
              used
            </Text>

            <Text size="sm" c="dimmed">•</Text>

            {/* Free Capacity */}
            <Text size="sm" c="dimmed">
              <Text span fw={600}>
                {formatBytes(diskInfo!.free_bytes)}
              </Text>{' '}
              free
            </Text>

            {/* Vertical divider + Scan Summary (live during scan, final when done) */}
            {(showScanStats || (isScanning && scanProgress)) && (
              <>
                <Divider orientation="vertical" h={14} my="auto" mx={4} style={{ borderColor: 'var(--border-color)' }} />

                <SearchCheck size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
                <Text size="sm" c="dimmed">
                  Found{' '}
                  <Text span fw={600}>
                    {(showScanStats
                      ? totalItems
                      : (scanProgress ? scanProgress.file_count + scanProgress.dir_count : 0)
                    ).toLocaleString()}
                  </Text>{' '}
                  items in{' '}
                  <Text span fw={600}>
                    {showScanStats
                      ? `${(scanTime! / 1000).toFixed(2)}s`
                      : `${scanProgress?.elapsed_secs.toFixed(2)}s`}
                  </Text>
                </Text>
              </>
            )}
          </Group>
        )}

        {/* ── Line 2: Folder / File counts for current path (uses root counts during scan) ── */}
        {(showDirCounts || (isScanning && scanProgress)) && (
          <Group gap="xs" align="center" wrap="wrap">
            <Pin size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              Current view:
            </Text>

            {/* Folder Stat */}
            <Group gap={4} align="center">
              <Folder size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm" fw={600} c="dimmed">
                {(showDirCounts ? dirCount : scanProgress?.root_dir_count ?? 0).toLocaleString()}
              </Text>
              <Text c="dimmed" size="sm">
                {(showDirCounts ? dirCount : scanProgress?.root_dir_count ?? 0) === 1 ? 'folder' : 'folders'}
              </Text>
            </Group>

            <Text size="sm" c="dimmed">•</Text>

            {/* File Stat */}
            <Group gap={4} align="center">
              <File size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm" fw={600} c="dimmed">
                {(showDirCounts ? fileCount : scanProgress?.root_file_count ?? 0).toLocaleString()}
              </Text>
              <Text c="dimmed" size="sm">
                {(showDirCounts ? fileCount : scanProgress?.root_file_count ?? 0) === 1 ? 'file' : 'files'}
              </Text>
            </Group>

            {/* Current View Total Size */}
            <Text size="sm" c="dimmed">
              (
              <Text span fw={600}>
                {formatBytes(showDirCounts ? currentViewSize : scanProgress?.total_file_bytes ?? 0)}
              </Text>{' '}
              total)
            </Text>
          </Group>
        )}
      </Stack>
    </div>
  );
}
