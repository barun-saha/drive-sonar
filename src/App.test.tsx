import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import App from './App';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { saveReportToTextFile } from './utils/exportReport';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('./utils/exportReport', () => ({
  saveReportToTextFile: vi.fn().mockResolvedValue(true),
}));

function renderApp() {
  return render(
    <MantineProvider defaultColorScheme="dark">
      <ModalsProvider>
        <App />
      </ModalsProvider>
    </MantineProvider>
  );
}

describe('App', () => {
  let scanWarningCallback: ((event: { payload: string }) => void) | null = null;
  let scanProgressCallback: ((event: { payload: any }) => void) | null = null;
  const mockUnlisten = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    scanWarningCallback = null;
    scanProgressCallback = null;

    vi.mocked(homeDir).mockResolvedValue('/Users/testuser');
    vi.mocked(getVersion).mockResolvedValue('0.6.0');
    vi.mocked(listen).mockImplementation(async (event, callback) => {
      if (event === 'scan-warning') {
        scanWarningCallback = callback as any;
      }
      if (event === 'scan-progress') {
        scanProgressCallback = callback as any;
      }
      return mockUnlisten;
    });
  });

  it('initializes default home path, app version, and sets up event listener', async () => {
    const { unmount } = renderApp();

    await waitFor(() => {
      expect(homeDir).toHaveBeenCalled();
      expect(getVersion).toHaveBeenCalled();
      expect(listen).toHaveBeenCalledWith('scan-warning', expect.any(Function));
      expect(listen).toHaveBeenCalledWith('scan-progress', expect.any(Function));
    });

    const input = screen.getByPlaceholderText('Select a target directory to scan...');
    await waitFor(() => {
      expect(input).toHaveValue('/Users/testuser');
    });

    // Test scan-warning listener execution
    if (scanWarningCallback) {
      scanWarningCallback({ payload: 'Permission warning on folder' });
      expect(await screen.findByText('Scan Warning')).toBeInTheDocument();
    }

    // Unmount to test event cleanup unlisten
    unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it('handles homeDir failure and getVersion failure gracefully on init', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(homeDir).mockRejectedValue(new Error('Home path error'));
    vi.mocked(getVersion).mockRejectedValue(new Error('Version error'));

    renderApp();

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });

    consoleError.mockRestore();
  });

  it('handles folder browse dialog interaction and dialog error', async () => {
    vi.mocked(openDialog).mockResolvedValueOnce('/selected/folder/path');

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    const browseBtn = screen.getByTitle('Browse folder');
    fireEvent.click(browseBtn);

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith({
        directory: true,
        multiple: false,
        defaultPath: '/Users/testuser',
      });
    });

    const input = screen.getByPlaceholderText('Select a target directory to scan...');
    await waitFor(() => {
      expect(input).toHaveValue('/selected/folder/path');
    });

    // Handle browse error
    vi.mocked(openDialog).mockRejectedValueOnce(new Error('Dialog canceled'));
    fireEvent.click(browseBtn);

    expect(await screen.findByText('Could not open directory picker: Error: Dialog canceled')).toBeInTheDocument();
  });

  it('executes handleScan successfully with get_disk_info and scan_directory', async () => {
    const mockDiskInfo = { total_bytes: 500000000, free_bytes: 200000000 };
    const mockPayload = {
      current_id: 0,
      current_path: '/Users/testuser',
      parent_id: null,
      ancestors: [{ id: 0, name: '/Users/testuser/projects' }],
      items: [
        { id: 1, name: 'Downloads', is_dir: true, size: 200000, modified_secs: 100, percentage_of_parent: 100 },
      ],
      extension_stats: [{ extension: '.zip', total_bytes: 200000, file_count: 1 }],
      top_files: [],
      total_scanned_items: 1,
    };

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') return mockDiskInfo;
      if (cmd === 'scan_directory') return mockPayload;
      return null;
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    fireEvent.click(scanBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('get_disk_info', { path: '/Users/testuser' });
      expect(invoke).toHaveBeenCalledWith('scan_directory', { targetPath: '/Users/testuser' });
    });

    expect(await screen.findByText('Downloads')).toBeInTheDocument();

    // Click unscanned breadcrumb to trigger handleScan with pathOverride
    const breadcrumbRoot = screen.getByText('testuser');
    fireEvent.click(breadcrumbRoot);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('scan_directory', { targetPath: '/Users/testuser' });
    });
  });

  it('ignores handleScan when target path is empty', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    const input = screen.getByPlaceholderText('Select a target directory to scan...');
    fireEvent.change(input, { target: { value: '   ' } });

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    expect(scanBtn).toBeDisabled();
  });

  it('handles get_disk_info failure and scan_directory error during handleScan', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') throw new Error('Disk info failed');
      if (cmd === 'scan_directory') throw new Error('Scan failed error');
      return null;
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    fireEvent.click(scanBtn);

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith('get_disk_info failed:', expect.any(Error));
    });

    expect(await screen.findByText('Scan Failed')).toBeInTheDocument();

    consoleWarn.mockRestore();
  });

  it('executes handleNavigate successfully and handles navigation failure', async () => {
    const initialPayload = {
      current_id: 0,
      current_path: '/Users/testuser',
      parent_id: null,
      ancestors: [{ id: 0, name: '/Users/testuser' }],
      items: [
        { id: 5, name: 'Documents', is_dir: true, size: 100000, modified_secs: 100, percentage_of_parent: 100 },
      ],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 1,
    };

    const navigatedPayload = {
      current_id: 5,
      current_path: '/Users/testuser/Documents',
      parent_id: 0,
      ancestors: [
        { id: 0, name: '/Users/testuser' },
        { id: 5, name: 'Documents' },
      ],
      items: [],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 0,
    };

    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'scan_directory') return initialPayload;
      if (cmd === 'open_directory' && args?.nodeId === 5) return navigatedPayload;
      if (cmd === 'open_directory' && args?.nodeId === 99) throw new Error('Invalid node');
      return null;
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    // Trigger scan first
    fireEvent.click(screen.getByRole('button', { name: 'Run Scan' }));
    expect(await screen.findByText('Documents')).toBeInTheDocument();

    // Click Documents folder to navigate
    fireEvent.click(screen.getByText('Documents'));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_directory', { nodeId: 5 });
    });
  });

  it('exports root target scan statistics even after navigating into subdirectories', async () => {
    const initialPayload = {
      current_id: 0,
      current_path: '/canonical/testuser',
      parent_id: null,
      ancestors: [{ id: 0, name: '/canonical/testuser' }],
      items: [
        { id: 5, name: 'Documents', is_dir: true, size: 100, modified_secs: 100, percentage_of_parent: 100 },
        { id: 6, name: 'root.txt', is_dir: false, size: 20, modified_secs: 100, percentage_of_parent: 20 },
      ],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 3,
    };
    const navigatedPayload = {
      current_id: 5,
      current_path: '/canonical/testuser/Documents',
      parent_id: 0,
      ancestors: [
        { id: 0, name: '/canonical/testuser' },
        { id: 5, name: 'Documents' },
      ],
      items: [
        { id: 7, name: 'notes.txt', is_dir: false, size: 7, modified_secs: 100, percentage_of_parent: 100 },
      ],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 3,
    };

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') return { total_bytes: 1_000, free_bytes: 400 };
      if (cmd === 'scan_directory') return initialPayload;
      if (cmd === 'open_directory') return navigatedPayload;
      return null;
    });

    renderApp();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run Scan' }));
    expect(await screen.findByText('Documents')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Menu'));
    fireEvent.click(await screen.findByText('Save Report'));
    await waitFor(() => {
      expect(saveReportToTextFile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scanPath: '/Users/testuser',
          totalBytes: 120,
          totalFiles: 1,
          totalDirectories: 1,
        }),
        expect.any(Array),
        expect.any(Array)
      );
    });

    // Navigate into Documents subfolder
    fireEvent.click(screen.getByText('Documents'));
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();

    // Verify report export still targets original root scan path stats
    fireEvent.click(screen.getByLabelText('Menu'));
    fireEvent.click(await screen.findByText('Save Report'));
    await waitFor(() => {
      expect(saveReportToTextFile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scanPath: '/Users/testuser',
          totalBytes: 120,
          totalFiles: 1,
          totalDirectories: 1,
        }),
        expect.any(Array),
        expect.any(Array)
      );
    });
  });

  it('exports unavailable drive statistics when disk information is missing', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') throw new Error('Disk info failed');
      if (cmd === 'scan_directory') {
        return {
          current_id: 0,
          current_path: '/Users/testuser',
          parent_id: null,
          ancestors: [{ id: 0, name: '/Users/testuser' }],
          items: [],
          extension_stats: [],
          top_files: [],
          total_scanned_items: 0,
        };
      }
      return null;
    });

    renderApp();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Scan' }));
    await waitFor(() => expect(screen.getByLabelText('Menu')).toBeEnabled());

    fireEvent.click(screen.getByLabelText('Menu'));
    fireEvent.click(await screen.findByText('Save Report'));
    await waitFor(() => {
      expect(saveReportToTextFile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          totalDriveBytes: undefined,
          totalDriveUsed: undefined,
          totalDriveFree: undefined,
        }),
        expect.any(Array),
        expect.any(Array)
      );
    });

    consoleWarn.mockRestore();
  });

  it('handles cancelScan invocation and warning on cancelScan error', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'scan_directory') return new Promise(() => {});
      if (cmd === 'cancel_scan') throw new Error('Cancel error');
      return Promise.resolve(null);
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    fireEvent.click(scanBtn);

    const cancelBtn = await screen.findByRole('button', { name: 'Cancel Scan' });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('cancel_scan');
      expect(consoleWarn).toHaveBeenCalledWith('cancel_scan invocation failed:', expect.any(Error));
    });

    consoleWarn.mockRestore();
  });

  it('opens Help modal and About modal from application menu', async () => {
    renderApp();

    const menuBtn = screen.getByLabelText('Menu');
    fireEvent.click(menuBtn);

    // Click Help
    const helpMenuItem = await screen.findByText('Help');
    fireEvent.click(helpMenuItem);

    expect(await screen.findByText('Usage Guide')).toBeInTheDocument();
    expect(screen.getByText(/To find the disk usage of a given directory/)).toBeInTheDocument();

    // Click Menu again for About
    fireEvent.click(menuBtn);

    const aboutMenuItem = await screen.findByText('About Drive Sonar');
    fireEvent.click(aboutMenuItem);

    expect(await screen.findByText(/A fast, lightweight disk space explorer powered by Rust and Tauri/)).toBeInTheDocument();
    expect(screen.getByText(/If you like Drive Sonar, please consider starring the project on GitHub!/)).toBeInTheDocument();
    const starBtn = screen.getByRole('link', { name: /Star on GitHub/i });
    expect(starBtn).toBeInTheDocument();
    expect(starBtn).toHaveAttribute('href', 'https://github.com/barun-saha/drive-sonar');
  });

  it('toggles color scheme between light and dark mode', async () => {
    renderApp();

    const menuBtn = screen.getByLabelText('Menu');
    fireEvent.click(menuBtn);

    const themeToggle = await screen.findByText('Switch to Light Mode');
    fireEvent.click(themeToggle);

    // Open menu again to verify label changed
    fireEvent.click(menuBtn);
    expect(await screen.findByText('Switch to Dark Mode')).toBeInTheDocument();
  });

  it('renders live progress when scan-progress events are emitted during scanning', async () => {
    let resolveScan: ((value: any) => void) | null = null;
    const scanPromise = new Promise((resolve) => {
      resolveScan = resolve;
    });

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') return { total_bytes: 500000000, free_bytes: 200000000 };
      if (cmd === 'scan_directory') return scanPromise;
      return null;
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    fireEvent.click(scanBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Scanning...' })).toBeInTheDocument();
    });

    // Simulate scan-progress event emission
    if (scanProgressCallback) {
      scanProgressCallback({
        payload: {
          file_count: 555,
          dir_count: 42,
          root_file_count: 15,
          root_dir_count: 4,
          total_file_bytes: 1048576,
          elapsed_secs: 1.5,
        },
      });
    }

    expect(await screen.findByText('Current folder')).toBeInTheDocument();
    expect(screen.getByText(/4 folders · 15 files/)).toBeInTheDocument();
    // Scan totals are shown in the status bar
    expect(screen.getByText('597')).toBeInTheDocument(); // 555 files + 42 dirs
    expect(screen.getByText('1.50 s')).toBeInTheDocument();

    // Resolve the scan
    resolveScan!({
      current_id: 0,
      current_path: '/Users/testuser',
      parent_id: null,
      ancestors: [{ id: 0, name: '/Users/testuser' }],
      items: [],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 0,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run Scan' })).toBeInTheDocument();
    });
  });

  it('does not apply a scan response after a newer breadcrumb rescan starts', async () => {
    let resolveOlderScan: ((value: any) => void) | null = null;
    let resolveNewerScan: ((value: any) => void) | null = null;
    const olderScan = new Promise((resolve) => { resolveOlderScan = resolve; });
    const newerScan = new Promise((resolve) => { resolveNewerScan = resolve; });
    let scanCount = 0;

    const payload = (currentPath: string, itemName: string) => ({
      current_id: 0,
      current_path: currentPath,
      parent_id: null,
      ancestors: [{ id: 0, name: '/Users/testuser/projects' }],
      items: [{
        id: 1,
        name: itemName,
        is_dir: false,
        size: 1,
        modified_secs: 0,
        percentage_of_parent: 100,
      }],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 1,
    });

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') return { total_bytes: 100, free_bytes: 50 };
      if (cmd === 'scan_directory') {
        scanCount += 1;
        if (scanCount === 1) return payload('/Users/testuser', 'Initial result');
        if (scanCount === 2) return olderScan;
        return newerScan;
      }
      return null;
    });

    renderApp();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Scan' }));
    expect(await screen.findByText('Initial result')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Users'));
    await waitFor(() => expect(scanCount).toBe(2));
    fireEvent.click(screen.getByText('testuser'));
    await waitFor(() => expect(scanCount).toBe(3));

    resolveNewerScan!(payload('/Users/testuser', 'Newer result'));
    expect(await screen.findByText('Newer result')).toBeInTheDocument();

    resolveOlderScan!(payload('/Users', 'Stale result'));
    await waitFor(() => expect(screen.queryByText('Stale result')).not.toBeInTheDocument());
    expect(screen.getByText('Newer result')).toBeInTheDocument();
  });

  it('increments and prominently displays session trashed count and size in toolbar when items are moved to trash', async () => {
    const mockDiskInfo = { total_bytes: 500000000, free_bytes: 200000000, free_total_bytes: 200000000 };
    const mockPayload = {
      current_id: 0,
      current_path: '/Users/testuser',
      parent_id: null,
      ancestors: [{ id: 0, name: '/Users/testuser' }],
      items: [
        { id: 1, name: 'temp.log', is_dir: false, size: 204800, modified_secs: 100, percentage_of_parent: 100 },
      ],
      extension_stats: [],
      top_files: [],
      total_scanned_items: 1,
    };

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'get_disk_info') return mockDiskInfo;
      if (cmd === 'scan_directory') return mockPayload;
      if (cmd === 'move_to_trash') return false;
      return null;
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Select a target directory to scan...')).toHaveValue('/Users/testuser');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Run Scan' }));
    expect(await screen.findByText('temp.log')).toBeInTheDocument();

    // Verify session trash line is not visible initially
    expect(screen.queryByText('This session')).not.toBeInTheDocument();

    // Delete temp.log
    const trashBtn = screen.getByTitle('Move to Trash');
    fireEvent.click(trashBtn);

    expect(await screen.findByText(/Are you sure you want to move/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));

    // Verify the session card is now displayed in the toolbar
    await waitFor(() => {
      expect(screen.getByText('This session')).toBeInTheDocument();
      expect(screen.getByText(/1 item moved to Trash/)).toBeInTheDocument();
      expect(screen.getByText(/Space is released once the Trash is emptied/)).toBeInTheDocument();
      expect(screen.queryByText(/freed/)).not.toBeInTheDocument();
    });
    expect(JSON.parse(localStorage.getItem('drive-sonar-lifetime-trashed')!)).toEqual({ count: 1, bytes: 204800 });
  });

  it('does not show the session card at startup even if a lifetime total was saved', async () => {
    localStorage.setItem('drive-sonar-lifetime-trashed', JSON.stringify({ count: 12, bytes: 5 * 1024 * 1024 }));

    renderApp();

    expect(await screen.findByRole('button', { name: 'Run Scan' })).toBeInTheDocument();
    expect(screen.queryByText('This session')).not.toBeInTheDocument();
    expect(screen.queryByText(/Lifetime: 12 items/)).not.toBeInTheDocument();
  });

  it('resets the lifetime trashed total from the About dialog', async () => {
    localStorage.setItem('drive-sonar-lifetime-trashed', JSON.stringify({ count: 12, bytes: 5 * 1024 * 1024 }));

    renderApp();
    fireEvent.click(screen.getByLabelText('Menu'));
    fireEvent.click(await screen.findByText('About Drive Sonar'));
    expect(await screen.findByText(/Lifetime: 5\.00 MB moved to Trash/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(screen.queryByText(/Lifetime:/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    });
    expect(JSON.parse(localStorage.getItem('drive-sonar-lifetime-trashed')!)).toEqual({ count: 0, bytes: 0 });
  });
  it.each([
    ['invalid JSON', 'not json{'],
    ['null', 'null'],
    ['the wrong shape', JSON.stringify({ count: 'many', bytes: -1 })],
  ])('starts normally when the stored lifetime total is %s', async (_label, stored) => {
    localStorage.setItem('drive-sonar-lifetime-trashed', stored);

    renderApp();

    expect(await screen.findByRole('button', { name: 'Run Scan' })).toBeInTheDocument();
    expect(screen.queryByText('This session')).not.toBeInTheDocument();
  });

  it('still works when local storage is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });

    renderApp();

    expect(await screen.findByRole('button', { name: 'Run Scan' })).toBeInTheDocument();
    expect(screen.queryByText('This session')).not.toBeInTheDocument();

    getItem.mockRestore();
    setItem.mockRestore();
    warn.mockRestore();
  });

  it('counts scan warnings in the status bar', async () => {
    renderApp();
    await waitFor(() => expect(scanWarningCallback).not.toBeNull());

    expect(screen.queryByText(/^\d+ warnings?$/)).not.toBeInTheDocument();

    act(() => {
      scanWarningCallback!({ payload: 'Permission denied: /root' });
      scanWarningCallback!({ payload: 'Permission denied: /var' });
    });

    expect(await screen.findByText('2 warnings')).toBeInTheDocument();
  });
});
