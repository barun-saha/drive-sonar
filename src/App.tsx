import { useState, useEffect, useMemo, useRef } from 'react';
import { ActionIcon, Anchor, Button, Code, Collapse, Group, Stack, Text, Menu, Modal } from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { Notifications, notifications } from '@mantine/notifications';
import { Menu as MenuIcon, HelpCircle, Info, Sun, Moon, Save, Star, Languages, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { StatusBar } from './components/StatusBar';
import { saveReportToTextFile } from './utils/exportReport';
import { formatBytes } from './utils/format';
import i18n, { applyLanguage } from './i18n';
import {
  LANGUAGES, LANGUAGE_STORAGE_KEY, parseLanguageSetting, type LanguageSetting,
} from './i18n/languages';
import thirdPartyNotices from '../THIRD_PARTY_NOTICES.md?raw';

import '@mantine/notifications/styles.css';

import { DirectoryPayload, DiskInfo, ScanProgress, KeyStats, DirNode, UiDiskNode, TrashedTotals } from './types';

const NO_TRASHED: TrashedTotals = { count: 0, bytes: 0 };

/** Falls back to zero totals if the stored value is missing, malformed or hand-edited. */
function parseTrashedTotals(stored?: string): TrashedTotals {
  try {
    const parsed = JSON.parse(stored ?? '');
    if (
      Number.isInteger(parsed?.count) && parsed.count >= 0 &&
      Number.isFinite(parsed?.bytes) && parsed.bytes >= 0 &&
      (parsed.count > 0 || parsed.bytes === 0)
    ) {
      return { count: parsed.count, bytes: parsed.bytes };
    }
  } catch {
    // Invalid JSON, treated the same as a wrong shape
  }
  return NO_TRASHED;
}

export default function App() {
  const { t } = useTranslation();
  const [targetPath, setTargetPath] = useState('');
  const [payload, setPayload] = useState<DirectoryPayload | null>(null);
  const [scanTime, setScanTime] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [scanPath, setScanPath] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [trashedCount, setTrashedCount] = useState(0);
  const [trashedBytes, setTrashedBytes] = useState(0);
  const [lifetimeTrashed, setLifetimeTrashed] = useLocalStorage({
    key: 'drive-sonar-lifetime-trashed',
    defaultValue: NO_TRASHED,
    deserialize: parseTrashedTotals,
    getInitialValueInEffect: false,
  });
  const [warningCount, setWarningCount] = useState(0);
  const [languageSetting, setLanguageSetting] = useLocalStorage<LanguageSetting>({
    key: LANGUAGE_STORAGE_KEY,
    defaultValue: 'system',
    deserialize: parseLanguageSetting,
    getInitialValueInEffect: false,
  });

  const selectLanguage = (setting: LanguageSetting) => {
    setLanguageSetting(setting);
    void applyLanguage(setting);
  };

  // Store the root scan statistics and top-level structure specifically for report export
  const [rootStats, setRootStats] = useState<{
    totalBytes: number;
    totalFiles: number;
    totalDirectories: number;
    topLevelDirs: DirNode[];
    topFiles: NonNullable<DirectoryPayload['top_files']>;
  } | null>(null);

  const scanGenerationRef = useRef(0);
  const activeScanGenerationRef = useRef<number | null>(null);

  // Hide the webview's built-in context menu (Back, Refresh, ...), except in text fields where Paste is useful
  useEffect(() => {
    const hideNativeMenu = (e: MouseEvent) => {
      if (!(e.target as Element).closest('input, textarea')) e.preventDefault();
    };
    document.addEventListener('contextmenu', hideNativeMenu);
    return () => document.removeEventListener('contextmenu', hideNativeMenu);
  }, []);

  const [helpOpened, { open: openHelp, close: closeHelp }] = useDisclosure(false);
  const [aboutOpened, { open: openAbout, close: closeAbout }] = useDisclosure(false);
  const [noticesOpened, { toggle: toggleNotices }] = useDisclosure(false);

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
      setWarningCount((count) => count + 1);
      notifications.show({
        title: i18n.t('notify.scanWarning'),
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
        title: t('notify.error'),
        message: t('notify.pickerFailed', { error: String(error) }),
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
      setRootStats(null);
      setWarningCount(0);

      try {
        const di = await invoke<DiskInfo>('get_disk_info', { path });
        if (activeScanGenerationRef.current === scanGeneration && scanGenerationRef.current === scanGeneration) {
          setDiskInfo(di);
          setScanPath(path);
        }
      } catch (e) {
        if (activeScanGenerationRef.current === scanGeneration && scanGenerationRef.current === scanGeneration) {
          console.warn('get_disk_info failed:', e);
        }
      }

      const startTime = performance.now();
      const res = await invoke<DirectoryPayload>('scan_directory', { targetPath: path });
      const endTime = performance.now();

      if (activeScanGenerationRef.current !== scanGeneration || scanGenerationRef.current !== scanGeneration) {
        return;
      }

      setPayload(res);
      setScanTime(endTime - startTime);

      // Compute and capture initial scan root stats before any navigation occurs
      const sep = res.current_path.includes('\\') ? '\\' : '/';
      let dirs = 0;
      let files = 0;
      let totalSize = 0;
      const topLevelDirs: DirNode[] = [];

      for (const item of res.items) {
        if (item.is_dir) {
          dirs++;
          topLevelDirs.push({
            name: item.name,
            path: `${res.current_path}${res.current_path.endsWith(sep) ? '' : sep}${item.name}`,
            size: item.size,
          });
        } else {
          files++;
        }
        totalSize += item.size;
      }

      setRootStats({
        totalBytes: totalSize,
        totalFiles: files,
        totalDirectories: dirs,
        topLevelDirs,
        topFiles: res.top_files ?? [],
      });
    } catch (error) {
      if (activeScanGenerationRef.current === scanGeneration && scanGenerationRef.current === scanGeneration) {
        notifications.show({
          title: t('notify.scanFailed'),
          message: String(error),
          color: 'red',
        });
      }
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
        title: t('notify.navigationFailed'),
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

  const handleItemTrashed = (item: UiDiskNode) => {
    setTrashedCount((prev) => prev + 1);
    setTrashedBytes((prev) => prev + item.size);
    setLifetimeTrashed((prev) => ({ count: prev.count + 1, bytes: prev.bytes + item.size }));
  };

  // Handler for Exporting Report
  const handleExportReport = async () => {
    if (!payload || !rootStats) {
      notifications.show({
        title: t('notify.noDataTitle'),
        message: t('notify.noDataMessage'),
        color: 'yellow',
      });
      return;
    }

    // Report stats are always based on the target scan path, retrieved from saved rootStats
    const stats: KeyStats = {
      scanPath: scanPath,
      totalBytes: rootStats.totalBytes,
      totalFiles: rootStats.totalFiles,
      totalDirectories: rootStats.totalDirectories,
      scanDurationMs: scanTime ?? undefined,
      totalDriveBytes: diskInfo?.total_bytes,
      totalDriveUsed: diskInfo
        ? diskInfo.total_bytes - diskInfo.free_bytes
        : undefined,
      totalDriveFree: diskInfo?.free_bytes,
    };

    const saved = await saveReportToTextFile(
      stats,
      rootStats.topLevelDirs,
      rootStats.topFiles
    );

    if (saved) {
      notifications.show({
        title: t('notify.reportSavedTitle'),
        message: t('notify.reportSavedMessage'),
        color: 'green',
      });
    }
  };

  return (
    <div className="app-frame">
      <Modal.Root opened={helpOpened} onClose={closeHelp} centered radius="md">
        <Modal.Overlay backgroundOpacity={0.6} blur={4} />
        <Modal.Content>
          <Modal.Header style={{ borderBottom: '1px solid var(--border-color)' }}>
            <Modal.Title>
              <Group gap="xs">
                <HelpCircle size={20} color="var(--mantine-color-dimmed)" />
                <Text fw={600} size="lg" c="dimmed">{t('help.title')}</Text>
              </Group>
            </Modal.Title>
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body pt="md">
            <Text size="lg">
              {t('help.scan', { run: t('toolbar.runScan') })}
            </Text>
            <br />
            <Text size="lg">
              {t('help.cancel', { cancel: t('toolbar.cancelScan') })}
            </Text>
            <br />
            <Text size="lg">
              {t('help.keyboard')}
            </Text>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>

      <Modal.Root opened={aboutOpened} onClose={closeAbout} centered radius="md">
        <Modal.Overlay backgroundOpacity={0.6} blur={4} />
        <Modal.Content>
          <Modal.Header style={{ borderBottom: '1px solid var(--border-color)' }}>
            <Modal.Title>
              <Group gap="xs">
                <Info size={20} color="var(--mantine-color-dimmed)" />
                <Text fw={600} size="lg" c="dimmed">{t('about.title')}</Text>
              </Group>
            </Modal.Title>
            <Modal.CloseButton />
          </Modal.Header>
          <Modal.Body pt="md">
            <Stack gap="xs">
              <Text fw={500}>Drive Sonar {appVersion ? `v${appVersion}` : ''}</Text>
              <Text size="lg">
                {t('about.description')}
              </Text>
              <br />
              <Text size="lg">{t('about.license')}</Text>
              <Text size="lg">{t('about.copyright')}</Text>
              <br />
              <Text size="md">
                {t('about.website')}{' '}
                <Anchor
                  href="https://drivesonar.download/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://drivesonar.download/
                </Anchor>
              </Text>

              <Text size="md">
                {t('about.starPrompt')}
              </Text>

              <Button
                component="a"
                href="https://github.com/barun-saha/drive-sonar"
                target="_blank"
                rel="noopener noreferrer"
                variant="light"
                color="yellow"
                size="sm"
                leftSection={<Star fill="currentColor" />}
                style={{ alignSelf: 'flex-start' }}
              >
                {t('about.starButton')}
              </Button>

              {lifetimeTrashed.count > 0 && (
                <Group gap="xs" mt="xs">
                  <Text size="sm" c="dimmed">
                    {t('about.lifetime', { size: formatBytes(lifetimeTrashed.bytes) })}
                  </Text>
                  <Button variant="subtle" color="gray" size="compact-xs" onClick={() => setLifetimeTrashed(NO_TRASHED)}>
                    {t('about.reset')}
                  </Button>
                </Group>
              )}

              <Text size="sm" c="dimmed" mt="xs">
                {t('about.fonts')}{' '}
                <Anchor
                  href="https://github.com/barun-saha/drive-sonar/blob/main/THIRD_PARTY_NOTICES.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('about.notices')}
                </Anchor>
              </Text>
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                onClick={toggleNotices}
                aria-expanded={noticesOpened}
                style={{ alignSelf: 'flex-start' }}
              >
                {noticesOpened ? t('about.hideLicense') : t('about.showLicense')}
              </Button>
              <Collapse expanded={noticesOpened}>
                <Code block mah={240} style={{ overflow: 'auto' }}>{thirdPartyNotices}</Code>
              </Collapse>
            </Stack>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>

      <div className="app-shell">
        <Notifications position="top-right" zIndex={1000} autoClose={6000} />
        <Toolbar
          targetPath={targetPath}
          setTargetPath={setTargetPath}
          onBrowse={handleBrowse}
          onScan={handleScan}
          onCancel={cancelScan}
          isScanning={isScanning}
          scanTime={scanTime}
          diskInfo={diskInfo}
          scanPath={scanPath}
          dirCount={dirCount}
          fileCount={fileCount}
          currentViewSize={currentViewSize}
          scanProgress={scanProgress}
          trashedCount={trashedCount}
          trashedBytes={trashedBytes}
          lifetimeTrashed={lifetimeTrashed}
        >
          <Menu shadow="md" width={240} position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" size="lg" aria-label={t('menu.label')} color="gray">
                <MenuIcon size={20} />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>{t('menu.application')}</Menu.Label>
              <Menu.Item
                leftSection={computedColorScheme === 'dark' ? <Sun /> : <Moon />}
                onClick={toggleColorScheme}
              >
                {computedColorScheme === 'dark' ? t('menu.switchToLight') : t('menu.switchToDark')}
              </Menu.Item>

              <Menu.Sub>
                <Menu.Sub.Target>
                  <Menu.Sub.Item leftSection={<Languages />}>{t('menu.language')}</Menu.Sub.Item>
                </Menu.Sub.Target>
                <Menu.Sub.Dropdown>
                  <Menu.Item
                    onClick={() => selectLanguage('system')}
                    rightSection={languageSetting === 'system' ? <Check size={14} /> : null}
                  >
                    {t('menu.systemDefault')}
                  </Menu.Item>
                  {LANGUAGES.map(({ code, name }) => (
                    <Menu.Item
                      key={code}
                      lang={code}
                      onClick={() => selectLanguage(code)}
                      rightSection={languageSetting === code ? <Check size={14} /> : null}
                    >
                      {name}
                    </Menu.Item>
                  ))}
                </Menu.Sub.Dropdown>
              </Menu.Sub>
              <Menu.Divider />

              <Menu.Item
                leftSection={<Save />}
                onClick={handleExportReport}
                disabled={!payload || isScanning}
              >
                {t('menu.saveReport')}
              </Menu.Item>
              <Menu.Divider />

              <Menu.Item leftSection={<HelpCircle />} onClick={openHelp}>
                {t('menu.help')}
              </Menu.Item>
              <Menu.Divider />

              <Menu.Item leftSection={<Info />} onClick={openAbout}>
                {t('menu.about')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Toolbar>

        <Workspace
          payload={payload}
          onNavigate={handleNavigate}
          onRefresh={handleScan}
          onItemTrashed={handleItemTrashed}
        />
      </div>

      <StatusBar
        isScanning={isScanning}
        scanTime={scanTime}
        totalItems={payload?.total_scanned_items ?? 0}
        scanProgress={scanProgress}
        diskInfo={diskInfo}
        scanPath={scanPath}
        rootScanBytes={rootStats?.totalBytes ?? 0}
        warningCount={warningCount}
      />
    </div>
  );
}
