import { ReactNode, useMemo } from 'react';
import { Group, TextInput, Button, Text, ActionIcon, Stack, SimpleGrid, Paper, Progress, Tooltip } from '@mantine/core';
import { Search, FolderOpen, Loader2, CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DiskInfo, ScanProgress, TrashedTotals } from '../types';
import { formatBytes } from '../utils/format';
import { formatDecimal, formatNumber } from '../i18n';

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
  targetPath,
  setTargetPath,
  onBrowse,
  onScan,
  onCancel,
  isScanning,
  scanTime,
  diskInfo,
  scanPath,
  dirCount,
  fileCount,
  currentViewSize,
  scanProgress,
  trashedCount = 0,
  trashedBytes = 0,
  lifetimeTrashed,
  children,
}: ToolbarProps) {
  const { t } = useTranslation();

  const driveLabel = useMemo(() => {
    if (!scanPath) return t('toolbar.disk');
    const match = scanPath.match(/^([a-zA-Z]:)/);
    return match ? t('toolbar.drive', { letter: match[1].toUpperCase() }) : t('toolbar.disk');
  }, [scanPath, t]);

  // Disk info is available as soon as the parallel call resolves
  const showDiskInfo = diskInfo !== null && scanPath !== '';
  // Final folder stats are available once the scan completes; live root stats during a scan
  const scanDone = scanTime !== null;
  const showCurrentFolder = scanDone || (isScanning && !!scanProgress);
  const folderCount = scanDone ? dirCount : (scanProgress?.root_dir_count ?? 0);
  const filesInFolder = scanDone ? fileCount : (scanProgress?.root_file_count ?? 0);
  const folderBytes = scanDone ? currentViewSize : (scanProgress?.total_file_bytes ?? 0);

  // Amber below 20% free, red below 10% free
  const freePercent = diskInfo && diskInfo.total_bytes > 0 ? (diskInfo.free_bytes / diskInfo.total_bytes) * 100 : 100;
  const diskBarColor =
    freePercent < 10 ? 'var(--status-danger)' : freePercent < 20 ? 'var(--status-warning)' : 'var(--status-ok)';

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Group style={{ flex: 1 }}>
            <TextInput
              placeholder={t('toolbar.pathPlaceholder')}
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              style={{ flex: 1 }}
              styles={{
                input: {
                  backgroundColor: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  borderColor: 'var(--border-color)',
                  fontFamily: 'var(--mantine-font-family-monospace)',
                },
              }}
              rightSection={
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={onBrowse}
                  disabled={isScanning}
                  title={t('toolbar.browse')}
                >
                  <FolderOpen />
                </ActionIcon>
              }
            />
            <Button
              onClick={() => onScan()}
              disabled={isScanning || !targetPath.trim()}
              leftSection={isScanning ? <Loader2 className="spin" /> : <Search />}
            >
              {isScanning ? t('toolbar.scanning') : t('toolbar.runScan')}
            </Button>
            <Button color="red" variant="light" onClick={onCancel} disabled={!isScanning} leftSection={<CircleX />}>
              {t('toolbar.cancelScan')}
            </Button>
          </Group>
          {children}
        </Group>

        {(showDiskInfo || showCurrentFolder || trashedCount > 0) && (
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" pt={2}>
            {showDiskInfo && diskInfo && (
              <Paper withBorder p="xs" radius="md" style={cardStyle}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">
                  {driveLabel}
                </Text>
                <Text fz="lg" fw={700}>
                  {t('toolbar.free', { size: formatBytes(diskInfo.free_bytes) })}
                </Text>
                <Tooltip label={t('toolbar.ssdTip')}>
                  <Progress value={100 - freePercent} color={diskBarColor} size="sm" my={4} />
                </Tooltip>
                <Text size="xs" c="dimmed">
                  {t('toolbar.diskSummary', {
                    total: formatBytes(diskInfo.total_bytes),
                    percent: formatDecimal(freePercent, 1),
                  })}
                </Text>
              </Paper>
            )}

            {showCurrentFolder && (
              <Paper withBorder p="xs" radius="md" style={cardStyle}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">
                  {t('toolbar.currentFolder')}
                </Text>
                <Text fz="lg" fw={700}>
                  {formatBytes(folderBytes)}
                </Text>
                <Text size="xs" c="dimmed">
                  {t('toolbar.folderCount', { count: folderCount, n: formatNumber(folderCount) })}
                  {' · '}
                  {t('toolbar.fileCount', { count: filesInFolder, n: formatNumber(filesInFolder) })}
                </Text>
              </Paper>
            )}

            {trashedCount > 0 && (
              <Paper withBorder p="xs" radius="md" style={cardStyle}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed">
                  {t('toolbar.thisSession')}
                </Text>
                <Text fz="lg" fw={700}>
                  {t('toolbar.movedToTrash', { count: trashedCount, n: formatNumber(trashedCount) })}
                </Text>
                <Text size="xs" c="dimmed">
                  {t('toolbar.trashSpaceNote', { size: formatBytes(trashedBytes) })}
                </Text>
                {lifetimeTrashed && lifetimeTrashed.count > 0 && (
                  <Text size="xs" c="dimmed">
                    {t('toolbar.lifetimeSummary', {
                      count: lifetimeTrashed.count,
                      n: formatNumber(lifetimeTrashed.count),
                      size: formatBytes(lifetimeTrashed.bytes),
                    })}
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
