import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { StatusBar } from './StatusBar';

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('StatusBar', () => {
  const defaultProps = {
    isScanning: false,
    scanTime: null,
    totalItems: 0,
    diskInfo: null,
    scanPath: '',
    rootScanBytes: 0,
    warningCount: 0,
  };

  const liveProgress = {
    file_count: 123,
    dir_count: 45,
    root_file_count: 10,
    root_dir_count: 3,
    total_file_bytes: 6789000,
    elapsed_secs: 2.3,
  };

  it('shows nothing before the first scan', () => {
    renderWithMantine(<StatusBar {...defaultProps} />);

    expect(screen.queryByText(/scanned in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/warning/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unaccounted/)).not.toBeInTheDocument();
  });

  it('shows live scan totals while scanning', () => {
    renderWithMantine(
      <StatusBar {...defaultProps} isScanning={true} scanProgress={liveProgress} />
    );

    expect(screen.getByText('168')).toBeInTheDocument(); // 123 files + 45 dirs
    expect(screen.getByText('2.30 s')).toBeInTheDocument();
    expect(screen.getByText(/items scanned in/)).toBeInTheDocument();
  });

  it('shows nothing while scanning until the first progress event arrives', () => {
    renderWithMantine(<StatusBar {...defaultProps} isScanning={true} scanProgress={null} />);

    expect(screen.queryByText(/scanned in/)).not.toBeInTheDocument();
  });

  it('shows final scan totals when the scan completes', () => {
    renderWithMantine(<StatusBar {...defaultProps} scanTime={1500} totalItems={1234} />);

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('1.50 s')).toBeInTheDocument();
    expect(screen.getByText(/items scanned in/)).toBeInTheDocument();
  });

  it('uses the singular form for a single item', () => {
    renderWithMantine(<StatusBar {...defaultProps} scanTime={1000} totalItems={1} />);

    expect(screen.getByText(/item scanned in/)).toBeInTheDocument();
  });

  it('shows the warning count with correct pluralization', () => {
    const { rerender } = renderWithMantine(<StatusBar {...defaultProps} warningCount={1} />);
    expect(screen.getByText('1 warning')).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <StatusBar {...defaultProps} warningCount={3} />
      </MantineProvider>
    );
    expect(screen.getByText('3 warnings')).toBeInTheDocument();
  });

  it('shows system allocation notice for volume root scan with large unaccounted gap', () => {
    renderWithMantine(
      <StatusBar
        {...defaultProps}
        scanTime={2000}
        // total=500GB, free_total=100GB → used=400GB, scanned=200GB → delta=200GB ≥ 1GiB
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 100_000_000_000, free_total_bytes: 100_000_000_000 }}
        scanPath={"C:\\"}
        rootScanBytes={200_000_000_000}
      />
    );
    expect(document.body.textContent).toMatch(/unaccounted/);
  });

  it('does NOT show system allocation notice for a non-root scan path', () => {
    renderWithMantine(
      <StatusBar
        {...defaultProps}
        scanTime={1000}
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 100_000_000_000, free_total_bytes: 100_000_000_000 }}
        scanPath="C:\\Users\\test"
        rootScanBytes={50_000_000_000}
      />
    );
    expect(document.body.textContent).not.toMatch(/unaccounted/);
  });

  it('does NOT show system allocation notice when delta is below 1 GiB threshold', () => {
    renderWithMantine(
      <StatusBar
        {...defaultProps}
        scanTime={1000}
        // used = 200 GB, scanned ≈ 200 GB → delta < 1 GiB
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 300_000_000_000, free_total_bytes: 300_000_000_000 }}
        scanPath={"C:\\"}
        rootScanBytes={199_900_000_000}
      />
    );
    expect(document.body.textContent).not.toMatch(/unaccounted/);
  });

  it('does NOT show system allocation notice before the scan completes', () => {
    renderWithMantine(
      <StatusBar
        {...defaultProps}
        isScanning={true}
        scanProgress={liveProgress}
        diskInfo={{ total_bytes: 500_000_000_000, free_bytes: 100_000_000_000, free_total_bytes: 100_000_000_000 }}
        scanPath={"C:\\"}
        rootScanBytes={200_000_000_000}
      />
    );
    expect(document.body.textContent).not.toMatch(/unaccounted/);
  });
});
