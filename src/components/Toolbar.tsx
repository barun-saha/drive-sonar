import { useMemo } from 'react';
import { Group, TextInput, Button, Text, ActionIcon, Stack, Divider } from '@mantine/core';
import { Search, FolderOpen, Loader2, CircleX, Folder, File } from 'lucide-react';

import { DiskInfo } from '../types';
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
  currentViewPath: string;
  dirCountMap: Map<string, { dirs: number; files: number }>;
}

export function Toolbar({
  targetPath, setTargetPath, onBrowse, onScan, onCancel, isScanning,
  scanTime, totalItems, diskInfo, scanPath, currentViewPath, dirCountMap
}: ToolbarProps) {

  const driveLabel = useMemo(() => {
    if (!scanPath) return 'Disk';
    const match = scanPath.match(/^([a-zA-Z]:)/);
    return match ? `Drive (${match[1].toUpperCase()})` : 'Disk';
  }, [scanPath]);

  // O(1) lookup for current-dir counts
  const normCurrent = currentViewPath.replace(/\\/g, '/').toLowerCase();
  const currentCounts = dirCountMap.get(normCurrent);

  // Disk info is available as soon as the parallel call resolves
  const showDiskInfo = diskInfo !== null && scanPath !== '';
  // Scan-specific stats only available after scan completes
  const showScanStats = scanTime !== null;
  // Dynamic dir counts shown once scan is done
  const showDirCounts = showScanStats && currentCounts !== undefined;

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
              onClick={onScan}
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

        {/* ── Line 1: Disk Capacity + Scan Performance (grouped on left) ── */}
        {showDiskInfo && (
          <Group gap="xs" align="center" wrap="wrap" pt={2}>
            {/* Drive Label */}
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {driveLabel}:
            </Text>

            {/* Used Capacity */}
            <Text size="sm" c="dimmed">
              <Text span fw={600} c="var(--mantine-color-text)">
                {formatBytes(diskInfo!.total_bytes - diskInfo!.free_bytes)}
              </Text>{' '}
              used
            </Text>

            <Text size="sm" c="dimmed">•</Text>

            {/* Free Capacity */}
            <Text size="sm" c="dimmed">
              <Text span fw={600} c="var(--mantine-color-text)">
                {formatBytes(diskInfo!.free_bytes)}
              </Text>{' '}
              free
            </Text>

            <Text size="sm" c="dimmed">•</Text>

            {/* Total Capacity */}
            <Text size="sm" c="dimmed">
              <Text span fw={600} c="var(--mantine-color-text)">
                {formatBytes(diskInfo!.total_bytes)}
              </Text>{' '}
              total
            </Text>

            {/* Vertical divider + Scan Summary */}
            {showScanStats && (
              <>
                <Divider orientation="vertical" h={14} my="auto" mx={4} style={{ borderColor: 'var(--border-color)' }} />

                <Text size="sm" c="dimmed">
                  Found{' '}
                  <Text span fw={600} c="var(--accent-primary, #3b82f6)">
                    {totalItems.toLocaleString()}
                  </Text>{' '}
                  items in{' '}
                  <Text span fw={600} c="var(--color-success, #22c55e)">
                    {(scanTime / 1000).toFixed(3)}s
                  </Text>
                </Text>
              </>
            )}
          </Group>
        )}

        {/* ── Line 2: Folder / File counts for current path ── */}
        {showDirCounts && (
          <Group gap="xs" align="center" wrap="wrap">
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              Here:
            </Text>

            {/* Folder Stat */}
            <Group gap={4} align="center">
              <Folder size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm">
                {currentCounts!.dirs.toLocaleString()} {currentCounts!.dirs === 1 ? 'folder' : 'folders'}
              </Text>
            </Group>

            <Text size="sm" c="dimmed">•</Text>

            {/* File Stat */}
            <Group gap={4} align="center">
              <File size={15} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm">
                {currentCounts!.files.toLocaleString()} {currentCounts!.files === 1 ? 'file' : 'files'}
              </Text>
            </Group>
          </Group>
        )}
      </Stack>
    </div>
  );
}
