import { useState, useEffect, useMemo } from 'react';
import { ActionIcon, Grid, Group, Stack, Container, Text, Title, Menu, Modal } from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Notifications, notifications } from '@mantine/notifications';
import { Menu as MenuIcon, HelpCircle, Info, Sun, Moon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { ItemList } from './components/ItemList';
import { VisualizationPanel } from './components/VisualizationPanel';

import '@mantine/notifications/styles.css';

import { FlatFileEntry, DiskInfo } from './types';

export default function App() {
  const [targetPath, setTargetPath] = useState('');
  const [currentViewPath, setCurrentViewPath] = useState('');
  const [results, setResults] = useState<FlatFileEntry[]>([]);
  const [scanTime, setScanTime] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [scanPath, setScanPath] = useState<string>('');        // path that was scanned
  const [scanTotalSize, setScanTotalSize] = useState<number>(0); // aggregated size at scan root

  // State for the modals
  const [helpOpened, { open: openHelp, close: closeHelp }] = useDisclosure(false);
  const [aboutOpened, { open: openAbout, close: closeAbout }] = useDisclosure(false);

  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('dark');

  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  };

  // Listen to warning events emitted by the backend during scans
  useEffect(() => {
    const unlisten = listen<string>('scan-warning', (event) => {
      notifications.show({
        title: 'Scan Warning',
        message: event.payload,
        color: 'yellow',
        autoClose: 6000
      });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Automatically resolve the user's OS Home directory on startup
  useEffect(() => {
    async function initDefaultPath() {
      try {
        const userHome = await homeDir();
        setTargetPath(userHome);
        setCurrentViewPath(userHome);
      } catch (error) {
        console.error('Failed to resolve default home path:', error);
      }
    }
    initDefaultPath();
  }, []);

  // Dynamically get app version from the config file
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

  // Opens native operating system directory selection window
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
        color: 'red'
      });
    }
  }

  async function handleScan() {
    if (!targetPath.trim()) return;

    try {
      setIsScanning(true);
      setScanTime(null);

      // Fetch and display disk capacity info first (fast syscall)
      try {
        const di = await invoke<DiskInfo>('get_disk_info', { path: targetPath });
        setDiskInfo(di);
        setScanPath(targetPath);
      } catch (e) {
        console.warn('get_disk_info failed:', e);
      }

      // Proceed to directory scanning
      const startTime = performance.now();
      const processedData = await invoke<FlatFileEntry[]>('scan_directory', {
        targetPath: targetPath,
      });
      const endTime = performance.now();

      const normalizedData = processedData.map((entry) => ({
        ...entry,
        normPath: entry.path.replace(/\\/g, '/').toLowerCase(),
      }));

      // Find the scan-root entry (its size == aggregated total for the scanned path)
      const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();
      const rootEntry = normalizedData.find((e) => e.normPath === normTarget);

      setResults(normalizedData);
      setCurrentViewPath(targetPath);
      setScanTime(endTime - startTime);
      setScanTotalSize(rootEntry ? rootEntry.size : 0);
    } catch (error) {
      notifications.show({
        title: 'Scan Failed',
        message: String(error),
        color: 'red'
      });
    } finally {
      setIsScanning(false);
    }
  }

  async function cancelScan() {
    await invoke('cancel_scan');
    setIsScanning(false);
  }

  const visibleItems = useMemo(() => {
    const normCurrentView = currentViewPath.replace(/\\/g, '/').toLowerCase();
    return results.filter(item => {
      const normItemParent = item.parent_path.replace(/\\/g, '/').toLowerCase();
      const normItemPath = item.path.replace(/\\/g, '/').toLowerCase();
      return normItemPath !== normCurrentView && normItemParent === normCurrentView;
    });
  }, [results, currentViewPath]);

  // Single O(N) pass to build a map of { dirs, files } counts keyed by
  // normalised parent_path. Recomputed only when results change (new scan).
  // Navigation is then an O(1) Map lookup — no re-iteration needed.
  const dirCountMap = useMemo(() => {
    const map = new Map<string, { dirs: number; files: number }>();
    for (const entry of results) {
      const key = entry.parent_path.replace(/\\/g, '/').toLowerCase();
      if (!map.has(key)) map.set(key, { dirs: 0, files: 0 });
      const c = map.get(key)!;
      if (entry.is_dir) c.dirs++; else c.files++;
    }
    return map;
  }, [results]);

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
              Depending on the size of its contents, a directory scan can take milliseconds to minutes.
            </Text>
            <br />
            <Text size="lg">
              To cancel an ongoing scan, click on the "Cancel Scan" button.
              No results are displayed when a scan is canceled.
            </Text>
            <br />
            <Text size="lg">
              The visualization panel on the right-hand side presents three views:
              <ul>
                <li>A tree map of the current location's disk space usage</li>
                <li>A distribution of space usage by the top-15 file extensions</li>
                <li>A scatter plot of file size and age</li>
              </ul>
              Collectively, the visualizations offer more insights into deciding which files,
              if any, are potential candidates for removal.
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
              <Text size="lg">
                © Copyright 2026 Barun Saha.
              </Text>
            </Stack>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>

      <Container size='xl' py='xl'>
        <Notifications position='top-right' zIndex={1000} autoClose={6000} />
        <Stack gap='lg'>

          {/* Header with Hamburger Menu */}
          <Group justify="space-between" align="center" gap="xs">
            <Title order={2} style={{ color: 'var(--text-main)', letterSpacing: '-0.5px' }}>
              ⚡ Drive Sonar — map your disk usage
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
                  leftSection={
                    computedColorScheme === 'dark' ? (
                      <Sun size={14} />
                    ) : (
                      <Moon size={14} />
                    )
                  }
                  onClick={toggleColorScheme}
                >
                  {computedColorScheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                </Menu.Item>

                <Menu.Divider />

                <Menu.Item
                  leftSection={<HelpCircle size={14} />}
                  onClick={openHelp}
                >
                  Help
                </Menu.Item>

                <Menu.Divider />

                <Menu.Item
                  leftSection={<Info size={14} />}
                  onClick={openAbout}
                >
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
            totalItems={results.length}
            diskInfo={diskInfo}
            scanPath={scanPath}
            scanTotalSize={scanTotalSize}
            currentViewPath={currentViewPath}
            dirCountMap={dirCountMap}
          />

          <Grid gap='md'>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <ItemList
                items={visibleItems}
                targetPath={targetPath}
                currentViewPath={currentViewPath}
                setCurrentViewPath={setCurrentViewPath}
                onRefresh={handleScan}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <VisualizationPanel
                visibleItems={visibleItems}
                allResults={results}
                currentViewPath={currentViewPath}
              />
            </Grid.Col>
          </Grid>
        </Stack>
      </Container>
    </>
  );
}
