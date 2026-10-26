import { ReactNode, useMemo } from 'react';
import { Group, TextInput, Button, Text, ActionIcon, Stack, SimpleGrid, Paper, Progress, Tooltip } from '@mantine/core';
import { Search, FolderOpen, Loader2, CircleX } from 'lucide-react';

import { DiskInfo, ScanProgress, TrashedTotals } from '../types';
import { formatBytes } from '../utils/format';

interface ToolbarProps {
  targetPath: string;
  setTargetPath: (path: string) => void;
  onBrowse: () => void;
  onScan: () => void;
  onCancel: () => void;
  isScanning: boolean;
  scanTime: number | null;
  diskInfo: DiskInfo | null;
  scanPath: string;
  dirCount: number;
  fileCount: number;
  currentViewSize: number;
  scanProgress?: ScanProgress | null;
  trashedCount?: number;
  trashedBytes?: number;
  lifetimeTrashed?: TrashedTotals;
  /** Extra controls shown at the end of the path row (e.g. the application menu) */
  children?: ReactNode;
}

const cardStyle = { background: 'var(--bg-main)', borderColor: 'var(--border-color)' };

export function Toolbar({
  targetPath, setTargetPath, onBrowse, onScan, onCancel, isScanning,
  scanTime, diskInfo, scanPath, dirCount, fileCount, currentViewSize,
  scanProgress, trashedCount = 0, trashedBytes = 0, lifetimeTrashed, children
}: ToolbarProps) {

  const driveLabel = useMemo(() => {
    if (!scanPath) return 'Disk';
    const match = scanPath.match(/^([a-zA-Z]:)/);
    return match ? `Drive (${match[1].toUpperCase()})` : 'Disk';
  }, [scanPath]);

  // Disk info is available as soon as the parallel call resolves
  const showDiskInfo = diskInfo !== null && scanPath !== '';
  // Final folder stats are available once the scan completes; live root stats during a scan
  const scanDone = scanTime !== null;
  const showCurrentFolder = scanDone || (isScanning && !!scanProgress);
  const folderCount = scanDone ? dirCount : scanProgress?.root_dir_count ?? 0;
  const filesInFolder = scanDone ? fileCount : scanProgress?.root_file_count ?? 0;
  const folderBytes = scanDone ? currentViewSize : scanProgress?.total_file_bytes ?? 0;

  // Amber below 20% free, red below 10% free
  const freePercent = diskInfo && diskInfo.total_bytes > 0
    ? (diskInfo.free_bytes / diskInfo.total_bytes) * 100
    : 100;
  const diskBarColor = freePercent < 10
    ? 'var(--status-danger)'
    : freePercent < 20 ? 'var(--status-warning)' : 'var(--status-ok)';

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
                input: {
                  backgroundColor: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  borderColor: 'var(--border-color)',
                  fontFamily: 'var(--mantine-font-family-monospace)',
                }
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
          {children}
        </Group>

        {(showDiskInfo || showCurrentFolder || trashedCount > 0) && (
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" pt={2}>
            {showDiskInfo && diskInfo && (
              <Paper withBorder p="xs" radius="md" style={cardStyle}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">{driveLabel}</Text>
                <Text fz="lg" fw={700}>{formatBytes(diskInfo.free_bytes)} free</Text>
                <Tooltip label="Many SSDs perform best with roughly 10–20% free space.">
                  <Progress value={100 - freePercent} color={diskBarColor} size="sm" my={4} />
                </Tooltip>
                <Text size="xs" c="dimmed">{formatBytes(diskInfo.total_bytes)} total · {freePercent.toFixed(1)}% free</Text>
              </Paper>
            )}

            {showCurrentFolder && (
              <Paper withBorder p="xs" radius="md" style={cardStyle}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">Current folder</Text>
                <Text fz="lg" fw={700}>{formatBytes(folderBytes)}</Text>
                <Text size="xs" c="dimmed">
                  {folderCount.toLocaleString()} {folderCount === 1 ? 'folder' : 'folders'}
                  {' · '}
                  {filesInFolder.toLocaleString()} {filesInFolder === 1 ? 'file' : 'files'}
                </Text>
              </Paper>
            )}

            {trashedCount > 0 && (
              <Paper withBorder p="xs" radius="md" style={cardStyle}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">This session</Text>
                <Text fz="lg" fw={700}>
                  {trashedCount.toLocaleString()} {trashedCount === 1 ? 'item' : 'items'} moved to Trash
                </Text>
                <Text size="xs" c="dimmed">
                  {formatBytes(trashedBytes)} · Space is released once the Trash is emptied
                </Text>
                {lifetimeTrashed && lifetimeTrashed.count > 0 && (
                  <Text size="xs" c="dimmed">
                    Lifetime: {lifetimeTrashed.count.toLocaleString()} {lifetimeTrashed.count === 1 ? 'item' : 'items'} · {formatBytes(lifetimeTrashed.bytes)} moved to Trash
                  </Text>
                )}
              </Paper>
            )}
          </SimpleGrid>
        )}
      </Stack>
    </div>
  );
}
