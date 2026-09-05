import { useState, useEffect, useMemo, useRef } from 'react';
import { ActionIcon, Grid, Group, Stack, Container, Text, Title, Menu, Modal } from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Notifications, notifications } from '@mantine/notifications';
import { Menu as MenuIcon, HelpCircle, Info, Sun, Moon, Save } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { ItemList } from './components/ItemList';
import { VisualizationPanel } from './components/VisualizationPanel';
import { saveReportToTextFile } from './utils/exportReport';

import '@mantine/notifications/styles.css';

import { DirectoryPayload, DiskInfo, ScanProgress, KeyStats, DirNode } from './types';

export default function App() {
  const [targetPath, setTargetPath] = useState('');
  const [payload, setPayload] = useState<DirectoryPayload | null>(null);
  const [scanTime, setScanTime] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [scanPath, setScanPath] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const scanGenerationRef = useRef(0);
  const activeScanGenerationRef = useRef<number | null>(null);

  const [helpOpened, { open: openHelp, close: closeHelp }] = useDisclosure(false);
  const [aboutOpened, { open: openAbout, close: closeAbout }] = useDisclosure(false);

  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('dark');

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    let unlistenWarning: (() => void) | null = null;
    let unlistenProgress: (() => void) | null = null;
    let disposed = false;

    listen<string>('scan-warning', (event) => {
      notifications.show({
        title: 'Scan Warning',
        message: event.payload,
        color: 'yellow',
        autoClose: 6000,
      });
    }).then((f) => {
      if (disposed) f();
      else unlistenWarning = f;
    });

    listen<ScanProgress>('scan-progress', (event) => {
      const activeGeneration = activeScanGenerationRef.current;
      if (activeGeneration !== null && activeGeneration === scanGenerationRef.current) {
        setScanProgress(event.payload);
      }
    }).then((f) => {
      if (disposed) f();
      else unlistenProgress = f;
    });

    return () => {
      disposed = true;
      unlistenWarning?.();
      unlistenProgress?.();
    };
  }, []);

  useEffect(() => {
    async function initDefaultPath() {
      try {
        const userHome = await homeDir();
        setTargetPath(userHome);
      } catch (error) {
        console.error('Failed to resolve default home path:', error);
      }
    }
    initDefaultPath();
  }, []);

  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    async function fetchAppVersion() {
      try {
        const ver = await getVersion();
        setAppVersion(ver);
      } catch (err) {
        console.error('Failed to fetch app version:', err);
      }
    }
    fetchAppVersion();
  }, []);

  async function handleBrowse() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: targetPath || undefined,
      });

      if (selected && typeof selected === 'string') {
        setTargetPath(selected);
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: `Could not open directory picker: ${error}`,
        color: 'red',
      });
    }
  }

  async function handleScan(pathOverride?: string) {
    const path = pathOverride ?? targetPath;
    if (!path.trim()) return;
    const scanGeneration = ++scanGenerationRef.current;
    activeScanGenerationRef.current = scanGeneration;

    if (pathOverride) {
      setTargetPath(pathOverride);
    }

    try {
      setIsScanning(true);
      setScanTime(null);
      setDiskInfo(null);
      setScanPath('');
      setScanProgress(null);

      try {
        const di = await invoke<DiskInfo>('get_disk_info', { path });
        setDiskInfo(di);
        setScanPath(path);
      } catch (e) {
        console.warn('get_disk_info failed:', e);
      }

      const startTime = performance.now();
      const res = await invoke<DirectoryPayload>('scan_directory', { targetPath: path });
      const endTime = performance.now();

      setPayload(res);
      setScanTime(endTime - startTime);
    } catch (error) {
      notifications.show({
        title: 'Scan Failed',
        message: String(error),
        color: 'red',
      });
    } finally {
      if (activeScanGenerationRef.current === scanGeneration) {
        activeScanGenerationRef.current = null;
        scanGenerationRef.current += 1;
        setIsScanning(false);
        setScanProgress(null);
      }
    }
  }

  async function handleNavigate(nodeId: number) {
    try {
      const res = await invoke<DirectoryPayload>('open_directory', { nodeId });
      setPayload(res);
    } catch (error) {
      notifications.show({
        title: 'Navigation Failed',
        message: String(error),
        color: 'red',
      });
    }
  }

  async function cancelScan() {
    try {
      await invoke('cancel_scan');
    } catch (error) {
      console.warn('cancel_scan invocation failed:', error);
    }
  }

  const { dirCount, fileCount, currentViewSize } = useMemo(() => {
    if (!payload) return { dirCount: 0, fileCount: 0, currentViewSize: 0 };
    let dirs = 0;
    let files = 0;
    let totalSize = 0;

    for (const item of payload.items) {
      if (item.is_dir) dirs++;
      else files++;
      totalSize += item.size;
    }

    return { dirCount: dirs, fileCount: files, currentViewSize: totalSize };
  }, [payload]);

  // Handler for Exporting Report
  const handleExportReport = async () => {
    if (!payload) {
      notifications.show({
        title: 'No Data to Export',
        message: 'Please run a scan before saving a report.',
        color: 'yellow',
      });
      return;
    }

    const sep = payload.current_path.includes('\\') ? '\\' : '/';

    // Map top level directories from payload items
    const topLevelDirs: DirNode[] = payload.items
      .filter((item) => item.is_dir)
      .map((item) => ({
        name: item.name,
        path: `${payload.current_path}${payload.current_path.endsWith(sep) ? '' : sep}${item.name}`,
        size: item.size,
      }));

    const isScanRoot = payload.parent_id === null;
    const stats: KeyStats = {
      scanPath: isScanRoot ? (scanPath || payload.current_path) : payload.current_path,
      totalBytes: payload.items.reduce((sum, item) => sum + item.size, 0),
      totalFiles: isScanRoot ? (scanProgress?.file_count ?? fileCount) : fileCount,
      totalDirectories: isScanRoot ? (scanProgress?.dir_count ?? dirCount) : dirCount,
      scanDurationMs: scanTime ?? undefined,
      totalDriveBytes: diskInfo?.total_bytes,
      totalDriveUsed: diskInfo
        ? diskInfo.total_bytes - diskInfo.free_bytes
        : undefined,
      totalDriveFree: diskInfo?.free_bytes,
    };

    const saved = await saveReportToTextFile(
      stats,
      topLevelDirs,
      payload.top_files ?? []
    );

    if (saved) {
      notifications.show({
        title: 'Report Saved',
        message: 'Scan report has been saved successfully.',
        color: 'green',
      });
    }
  };

  return (
    <>
      <Modal.Root opened={helpOpened} onClose={closeHelp} centered radius="md">
        <Modal.Overlay backgroundOpacity={0.6} blur={4} />
        <Modal.Content>
          <Modal.Header style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Modal.Title>
              <Group gap="xs">
                <HelpCircle size={20} color="var(--mantine-color-dimmed)" />
                <Text fw={600} size="lg" c="dimmed">Usage Guide</Text>
              </Group>
            </Modal.Title>
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body pt="md">
            <Text size="lg">
              To find the disk usage of a given directory, select the directory and click on the "Run Scan" button.
            </Text>
            <br />
            <Text size="lg">
              To cancel an ongoing scan, click on the "Cancel Scan" button.
            </Text>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>

      <Modal.Root opened={aboutOpened} onClose={closeAbout} centered radius="md">
        <Modal.Overlay backgroundOpacity={0.6} blur={4} />
        <Modal.Content>
          <Modal.Header style={{ borderBottom: '1px solid var(--mantine-color-dimmed)' }}>
            <Modal.Title>
              <Group gap="xs">
                <Info size={20} color="var(--mantine-color-cyan-4)" />
                <Text fw={600} size="lg" c="dimmed">About Drive Sonar</Text>
              </Group>
            </Modal.Title>
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body pt="md">
            <Stack gap="xs">
              <Text fw={500}>Drive Sonar {appVersion ? `v${appVersion}` : ''}</Text>
              <Text size="lg">
                A fast, lightweight disk space explorer powered by Rust and Tauri. Apache-2.0 licensed.
              </Text>
              <br />
              <Text size="lg">Licensed under Apache-2.0</Text>
              <Text size="lg">© 2026 Barun Saha.</Text>
              <br />
              <Text size="md">
                Website:{' '}
                <a
                  href="https://drivesonar.baruns.workers.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  https://drivesonar.baruns.workers.dev/
                </a>
              </Text>

              <Text size="md">
                Source Code:{' '}
                <a
                  href="https://github.com/barun-saha/drive-sonar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  https://github.com/barun-saha/drive-sonar
                </a>
              </Text>
            </Stack>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>

      <Container size="xl" py="xl">
        <Notifications position="top-right" zIndex={1000} autoClose={6000} />
        <Stack gap="lg">
          <Group justify="space-between" align="center" gap="xs">
            <Title order={2} style={{ color: 'var(--text-main)', letterSpacing: '-0.5px' }}>
              ⚡ Drive Sonar — insights on your disk usage
            </Title>

            <Menu shadow="md" width={200} position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" size="lg" aria-label="Menu" color="gray">
                  <MenuIcon size={20} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                <Menu.Label>Application</Menu.Label>
                <Menu.Item
                  leftSection={computedColorScheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                  onClick={toggleColorScheme}
                >
                  {computedColorScheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                </Menu.Item>
                <Menu.Divider />

                <Menu.Item
                  leftSection={<Save size={14} />}
                  onClick={handleExportReport}
                  disabled={!payload || isScanning}
                >
                  Save Report
                </Menu.Item>
                <Menu.Divider />

                <Menu.Item leftSection={<HelpCircle size={14} />} onClick={openHelp}>
                  Help
                </Menu.Item>
                <Menu.Divider />

                <Menu.Item leftSection={<Info size={14} />} onClick={openAbout}>
                  About Drive Sonar
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>

          <Toolbar
            targetPath={targetPath}
            setTargetPath={setTargetPath}
            onBrowse={handleBrowse}
            onScan={handleScan}
            onCancel={cancelScan}
            isScanning={isScanning}
            scanTime={scanTime}
            totalItems={payload?.total_scanned_items ?? 0}
            diskInfo={diskInfo}
            scanPath={scanPath}
            dirCount={dirCount}
            fileCount={fileCount}
            currentViewSize={currentViewSize}
            scanProgress={scanProgress}
          />

          <Grid gap="md" align="flex-start">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <ItemList
                payload={payload}
                onNavigate={handleNavigate}
                onRefresh={handleScan}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <VisualizationPanel payload={payload} onNavigate={handleNavigate} />
            </Grid.Col>
          </Grid>
        </Stack>
      </Container>
    </>
  );
}
