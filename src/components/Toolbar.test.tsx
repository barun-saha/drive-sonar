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
    diskInfo: null,
    scanPath: '',
    dirCount: 0,
    fileCount: 0,
    currentViewSize: 0,
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

  it('displays the disk card with free space headline and total capacity', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        diskInfo={{ total_bytes: 1000000000, free_bytes: 400000000, free_total_bytes: 400000000 }}
        scanPath="C:\\Users\\test"
      />
    );

    expect(screen.getByText('Drive (C:)')).toBeInTheDocument();
    expect(screen.getByText('381.47 MB free')).toBeInTheDocument();
    expect(screen.getByText(/953\.67 MB total · 40\.0% free/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
  });

  it.each([
    [25, 'blue'],
    [15, 'yellow'],
    [5, 'red'],
  ])('colors the disk bar for %i%% free as %s', (freePercent, color) => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        diskInfo={{ total_bytes: 100, free_bytes: freePercent, free_total_bytes: freePercent }}
        scanPath="/home/user"
      />
    );

    expect(screen.getByRole('progressbar').getAttribute('style')).toContain(`-${color}-`);
  });

  it('does not break when total disk size is zero', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        diskInfo={{ total_bytes: 0, free_bytes: 0, free_total_bytes: 0 }}
        scanPath="/home/user"
      />
    );

    expect(screen.getByText('0 Bytes free')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('displays current folder stats when scan completes', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        scanTime={1500}
        diskInfo={{ total_bytes: 1000000000, free_bytes: 400000000, free_total_bytes: 400000000 }}
        scanPath="/home/user"
        dirCount={1}
        fileCount={10}
        currentViewSize={5000000}
      />
    );

    expect(screen.getByText('Disk')).toBeInTheDocument();
    expect(screen.getByText('Current folder')).toBeInTheDocument();
    expect(screen.getByText('4.77 MB')).toBeInTheDocument();
    expect(screen.getByText(/1 folder · 10 files/)).toBeInTheDocument();
    expect(screen.queryByText(/scanned in/)).not.toBeInTheDocument();
    expect(screen.queryByText('1.50s')).not.toBeInTheDocument();
  });

  it('displays live root folder stats while scanning', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        isScanning={true}
        diskInfo={{ total_bytes: 1000000000, free_bytes: 400000000, free_total_bytes: 400000000 }}
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

    expect(screen.getByText('Disk')).toBeInTheDocument();
    expect(screen.getByText('Current folder')).toBeInTheDocument();
    expect(screen.getByText('6.47 MB')).toBeInTheDocument();
    expect(screen.getByText(/3 folders · 10 files/)).toBeInTheDocument();
  });

  it('displays live root folder stats while scanning when disk information is unavailable', () => {
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

    expect(screen.getByText('Current folder')).toBeInTheDocument();
    expect(screen.getByText(/3 folders · 10 files/)).toBeInTheDocument();
    expect(screen.queryByText('Disk')).not.toBeInTheDocument();
  });

  it('shows no cards before the first scan', () => {
    renderWithMantine(<Toolbar {...defaultProps} />);

    expect(screen.queryByText('Current folder')).not.toBeInTheDocument();
    expect(screen.queryByText('This session')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('does not render the session card when trashedCount is 0 or omitted', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        trashedCount={0}
        trashedBytes={0}
      />
    );
    expect(screen.queryByText('This session')).not.toBeInTheDocument();
  });

  it('renders singular item and formatted bytes when trashedCount is 1', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        trashedCount={1}
        trashedBytes={1024 * 500}
      />
    );
    expect(screen.getByText('This session')).toBeInTheDocument();
    expect(screen.getByText(/1 item moved to Trash/)).toBeInTheDocument();
    expect(screen.getByText(/500\.00 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Space is released once the Trash is emptied/)).toBeInTheDocument();
    expect(screen.queryByText(/freed/)).not.toBeInTheDocument();
  });

  it('renders plural items and formatted bytes when trashedCount is greater than 1', () => {
    renderWithMantine(
      <Toolbar
        {...defaultProps}
        trashedCount={5}
        trashedBytes={1024 * 1024 * 25}
      />
    );
    expect(screen.getByText('This session')).toBeInTheDocument();
    expect(screen.getByText(/5 items moved to Trash/)).toBeInTheDocument();
    expect(screen.getByText(/25\.00 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/freed/)).not.toBeInTheDocument();
  });
});
