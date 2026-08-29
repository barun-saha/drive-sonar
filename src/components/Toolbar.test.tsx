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
    expect(screen.getByText('1.500s')).toBeInTheDocument();
    expect(screen.getByText('Current view:')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('folder')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('files')).toBeInTheDocument();
  });
});
