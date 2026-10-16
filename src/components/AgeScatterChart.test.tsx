import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { AgeScatterChart } from './AgeScatterChart';
import { TopFileNode } from '../types';
import { invoke } from '@tauri-apps/api/core'; // Issue #24
import { notifications } from '@mantine/notifications'; // Issue #24

let capturedScatterProps: any = null;

// Issue #24: Mock Tauri invoke and Mantine notifications
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: {
    show: vi.fn(),
  },
}));

vi.mock('@mantine/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/charts')>();
  return {
    ...actual,
    ScatterChart: (props: any) => {
      capturedScatterProps = props;
      return <div data-testid="mock-scatter-chart" />;
    },
  };
});

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('AgeScatterChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders fallback message when files list is empty', () => {
    renderWithMantine(<AgeScatterChart files={[]} />);
    expect(screen.getByText('TOP 30 LARGEST FILES: SIZE vs AGE')).toBeInTheDocument();
    expect(screen.getByText('No files to analyze in this scope.')).toBeInTheDocument();
  });

  it('renders chart and handles semi-log scale toggle and tooltip content when files exist', () => {
    const mockFiles: TopFileNode[] = [
      { id: 1, name: 'large_file.iso', size: 1048576 * 500, modified_secs: Math.floor(Date.now() / 1000) - 86400 * 60, path: '/downloads/large_file.iso' },
      { id: 2, name: 'zero_file.bin', size: 0, modified_secs: 0, path: '/downloads/zero_file.bin' },
    ];

    renderWithMantine(<AgeScatterChart files={mockFiles} />);

    expect(screen.getByText('TOP 30 LARGEST FILES: SIZE vs AGE')).toBeInTheDocument();
    expect(screen.getByTestId('mock-scatter-chart')).toBeInTheDocument();

    const switchInput = screen.getByLabelText('Use semi-log scale');
    fireEvent.click(switchInput);
    expect(switchInput).toBeChecked();

    // Test tooltip content callback
    const content = capturedScatterProps?.tooltipProps?.content;
    if (content) {
      const tooltipUI = content({
        payload: [{ payload: { fileName: 'large_file.iso', filePath: '/downloads/large_file.iso', fileId: 1, rawBytes: 1048576 * 500, sizeMB: 500, ageMonths: 2 } }],
      });
      renderWithMantine(tooltipUI);
      expect(screen.getByText('large_file.iso')).toBeInTheDocument();
      // Issue #24: verify full path and hint are rendered
      expect(screen.getByText('/downloads/large_file.iso')).toBeInTheDocument();
      expect(screen.getByText('Click point to open in Files Explorer')).toBeInTheDocument();
      expect(screen.getByText('Modified: 2 months ago')).toBeInTheDocument();

      expect(content({ payload: [] })).toBeNull();
      expect(content({})).toBeNull();
    }
  });

  // Issue #24: Test point click opening file in explorer
  it('opens file in explorer when scatter point is clicked', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const mockFiles: TopFileNode[] = [
      { id: 99, name: 'archive.zip', size: 1048576 * 600, modified_secs: Math.floor(Date.now() / 1000) - 86400 * 10, path: '/backups/archive.zip' },
    ];

    renderWithMantine(<AgeScatterChart files={mockFiles} />);

    // Test scatterProps.onClick callback
    capturedScatterProps.scatterProps.onClick({ fileId: 99 });
    expect(invoke).toHaveBeenCalledWith('open_in_explorer', { nodeId: 99 });

    // Test shape onPointClick callback
    vi.mocked(invoke).mockClear();
    capturedScatterProps.scatterProps.shape.props.onPointClick({ fileId: 99 });
    expect(invoke).toHaveBeenCalledWith('open_in_explorer', { nodeId: 99 });
  });

  // Issue #24: Test error notification when open_in_explorer fails on point click
  it('shows error notification when open_in_explorer fails on point click', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Failed to open'));

    const mockFiles: TopFileNode[] = [
      { id: 42, name: 'video.mp4', size: 1048576 * 200, modified_secs: Math.floor(Date.now() / 1000) - 86400 * 30, path: '/movies/video.mp4' },
    ];

    renderWithMantine(<AgeScatterChart files={mockFiles} />);

    capturedScatterProps.scatterProps.onClick({ fileId: 42 });

    await waitFor(() => {
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Execution Failed',
          color: 'red',
        })
      );
    });
  });

  // Issue #24: Test jitter for overlapping points with identical age and size
  it('applies a small offset jitter when points have identical age and size', () => {
    const fixedSecs = Math.floor(Date.now() / 1000) - 86400 * 30;
    const mockFiles: TopFileNode[] = [
      { id: 1, name: 'dup1.zip', size: 1048576 * 100, modified_secs: fixedSecs, path: '/dup1.zip' },
      { id: 2, name: 'dup2.zip', size: 1048576 * 100, modified_secs: fixedSecs, path: '/dup2.zip' },
    ];

    renderWithMantine(<AgeScatterChart files={mockFiles} />);

    const points = capturedScatterProps.data[0].data;
    expect(points.length).toBe(2);
    // ageMonths should be slightly different due to jitter
    expect(points[0].ageMonths).not.toEqual(points[1].ageMonths);
    expect(points[0].rawBytes).toEqual(points[1].rawBytes);
  });
});
