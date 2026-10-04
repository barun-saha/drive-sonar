import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { Toolbar } from './Toolbar';

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('Toolbar', () => {
  const defaultProps = {
    targetPath: '/home/user',
    setTargetPath: vi.fn(),
    onBrowse: vi.fn(),
    onScan: vi.fn(),
    onCancel: vi.fn(),
    isScanning: false,
    scanTime: null,
    totalItems: 0,
    diskInfo: null,
    scanPath: '',
    dirCount: 0,
    fileCount: 0,
    currentViewSize: 0,
    rootScanBytes: 0,
  };

  it('renders target path and handles path typing and action buttons', () => {
    const setTargetPath = vi.fn();
    const onBrowse = vi.fn();
    const onScan = vi.fn();

    renderWithMantine(
      <Toolbar
        {...defaultProps}
        setTargetPath={setTargetPath}
        onBrowse={onBrowse}
        onScan={onScan}
      />
    );

    const input = screen.getByPlaceholderText('Select a target directory to scan...');
    expect(input).toHaveValue('/home/user');

    fireEvent.change(input, { target: { value: '/var/log' } });
    expect(setTargetPath).toHaveBeenCalledWith('/var/log');

    const browseBtn = screen.getByTitle('Browse folder');
    fireEvent.click(browseBtn);
    expect(onBrowse).toHaveBeenCalled();

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    expect(scanBtn).not.toBeDisabled();
    fireEvent.click(scanBtn);
    expect(onScan).toHaveBeenCalled();
  });

  it('disables scan button when path is empty or scanning', () => {
    const { rerender } = renderWithMantine(
      <Toolbar {...defaultProps} targetPath="" />
    );

    const scanBtn = screen.getByRole('button', { name: 'Run Scan' });
    expect(scanBtn).toBeDisabled();

    rerender(
      <MantineProvider>
        <Toolbar {...defaultProps} isScanning={true} />
      </MantineProvider>
    );

    expect(screen.getByRole('button', { name: 'Scanning...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel Scan' })).not.toBeDisabled();
  });

  it('calls onCancel when Cancel Scan button is clicked during scanning', () => {
    const onCancel = vi.fn();
    renderWithMantine(
      <Toolbar {...defaultProps} isScanning={true} onCancel={onCancel} />
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel Scan' });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it('displays disk information and drive label correctly', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        diskInfo={{ total_bytes: 1000000000, free_bytes: 400000000 }}
        scanPath="C:\Users\test"
      />
    );

    expect(screen.getByText('Drive (C:):')).toBeInTheDocument();
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText('used')).toBeInTheDocument();
    expect(screen.getByText('free')).toBeInTheDocument();
  });

  it('displays scan summary and current view stats when scan completes', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        scanTime={1500}
        totalItems={1234}
        diskInfo={{ total_bytes: 1000000000, free_bytes: 400000000 }}
        scanPath="/home/user"
        dirCount={1}
        fileCount={10}
        currentViewSize={5000000}
      />
    );

    expect(screen.getByText('Disk:')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('1.50s')).toBeInTheDocument();
    expect(screen.getByText('Current view:')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('folder')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('files')).toBeInTheDocument();
  });

  it('displays live scanning progress when isScanning and scanProgress is provided in consistent format', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        isScanning={true}
        diskInfo={{ total_bytes: 1000000000, free_bytes: 400000000 }}
        scanPath="/home/user"
        scanProgress={{
          file_count: 123,
          dir_count: 45,
          root_file_count: 10,
          root_dir_count: 3,
          total_file_bytes: 6789000,
          elapsed_secs: 2.3,
        }}
      />
    );

    expect(screen.getByText('Disk:')).toBeInTheDocument();
    expect(screen.getByText('168')).toBeInTheDocument(); // 123 files + 45 dirs
    expect(screen.getByText('2.30s')).toBeInTheDocument();
    expect(screen.getByText('Current view:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('folders')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('files')).toBeInTheDocument();
    expect(screen.queryByText('Scanning progress:')).not.toBeInTheDocument();
  });

  it('displays live scanning progress when disk information is unavailable', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        isScanning={true}
        scanProgress={{
          file_count: 123,
          dir_count: 45,
          root_file_count: 10,
          root_dir_count: 3,
          total_file_bytes: 6789000,
          elapsed_secs: 2.3,
        }}
      />
    );

    expect(screen.getByText('168')).toBeInTheDocument();
    expect(screen.getByText('2.30s')).toBeInTheDocument();
    expect(screen.getByText('Current view:')).toBeInTheDocument();
    expect(screen.queryByText('Disk:')).not.toBeInTheDocument();
  });

  it('shows system allocation notice for volume root scan with large unaccounted gap', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        scanTime={2000}
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 100_000_000_000 }}
        scanPath={"C:\\"}
        dirCount={5}
        fileCount={3}
        currentViewSize={200_000_000_000}
        rootScanBytes={200_000_000_000}
      />
    );
    // used = 400 GB, scanned = 200 GB → delta 200 GB ≥ 1 GiB threshold
    expect(document.body.textContent).toMatch(/unaccounted/);
  });

  it('does NOT show system allocation notice for a non-root scan path', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        scanTime={1000}
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 100_000_000_000 }}
        scanPath="C:\\Users\\test"
        dirCount={3}
        fileCount={10}
        currentViewSize={50_000_000_000}
        rootScanBytes={50_000_000_000}
      />
    );
    expect(document.body.textContent).not.toMatch(/unaccounted/);
  });

  it('does NOT show system allocation notice when delta is below 1 GiB threshold', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        scanTime={1000}
        // used = 200 GB, scanned ≈ 200 GB → delta < 1 GiB
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 300_000_000_000 }}
        scanPath={"C:\\"}
        dirCount={2}
        fileCount={5}
        currentViewSize={199_900_000_000}
        rootScanBytes={199_900_000_000}
      />
    );
    expect(document.body.textContent).not.toMatch(/unaccounted/);
  });
});
