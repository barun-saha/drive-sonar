import { cloneElement } from 'react';
import { render, screen, fireEvent, createEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const singlePoint = capturedScatterProps.data[0].data[0];
    expect(singlePoint.plottedAgeMonths).toBe(singlePoint.ageMonths);

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

  it.each(['click', 'Enter', ' '])('activates a focusable point with %j and preserves callbacks', async (action) => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const mockFiles: TopFileNode[] = [
      { id: 99, name: 'archive.zip', size: 1048576 * 600, modified_secs: 0, path: '/backups/archive.zip' },
    ];
    renderWithMantine(<AgeScatterChart files={mockFiles} />);

    const payload = capturedScatterProps.data[0].data[0];
    const pointClick = vi.fn();
    const parentClick = vi.fn();
    const parentKeyDown = vi.fn();
    renderWithMantine(
      <svg>
        <g onClick={parentClick} onKeyDown={parentKeyDown}>
          {cloneElement(capturedScatterProps.scatterProps.shape, {
            cx: 10, cy: 10, payload, onClick: pointClick,
          })}
        </g>
      </svg>
    );

    const point = screen.getByRole('button', { name: 'Open archive.zip in Files Explorer' });
    await user.tab(); // Scale switch
    await user.tab(); // Scatter point
    expect(point).toHaveFocus();

    const unrelatedKey = createEvent.keyDown(point, { key: 'ArrowRight' });
    fireEvent(point, unrelatedKey);
    expect(unrelatedKey.defaultPrevented).toBe(false);
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
    expect(pointClick).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    parentKeyDown.mockClear();

    const event = action === 'click'
      ? createEvent.click(point)
      : createEvent.keyDown(point, { key: action });
    fireEvent(point, event);

    expect(event.defaultPrevented).toBe(action !== 'click');
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(pointClick).toHaveBeenCalledTimes(1);
    expect(pointClick.mock.calls[0][0].nativeEvent).toBe(event);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_in_explorer', { nodeId: 99 });
    expect(pointClick.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(invoke).mock.invocationCallOrder[0]);
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
    expect(capturedScatterProps.dataKey.x).toBe('plottedAgeMonths');
    expect(points.map((point: any) => point.plottedAgeMonths)).toEqual([0.94, 1.06]);
    expect(points.map((point: any) => point.ageMonths)).toEqual([1, 1]);
    expect(points[0].rawBytes).toEqual(points[1].rawBytes);

    renderWithMantine(capturedScatterProps.tooltipProps.content({ payload: [{ payload: points[0] }] }));
    expect(screen.getByText('Modified: 1 months ago')).toBeInTheDocument();
  });

  it.each([
    { ageMonths: 0, count: 3, expected: [0, 0.12, 0.24] },
    { ageMonths: 0, count: 4, expected: [0, 0.12, 0.24, 0.36] },
    { ageMonths: 0.1, count: 3, expected: [0, 0.12, 0.24] },
  ])('keeps $count overlapping points at age $ageMonths distinct and nonnegative', ({ ageMonths, count, expected }) => {
    const modifiedSecs = Math.floor(Date.now() / 1000) - ageMonths * 86400 * 30.4375;
    const mockFiles: TopFileNode[] = Array.from({ length: count }, (_, id) => ({
      id, name: `file${id}.zip`, size: 1048576 * 100, modified_secs: modifiedSecs, path: `/file${id}.zip`,
    }));
    renderWithMantine(<AgeScatterChart files={mockFiles} />);

    const points = capturedScatterProps.data[0].data;
    expect(points.map((point: any) => point.plottedAgeMonths)).toEqual(expected);
    expect(points.map((point: any) => point.ageMonths)).toEqual(Array(count).fill(ageMonths));

    renderWithMantine(capturedScatterProps.tooltipProps.content({ payload: [{ payload: points[count - 1] }] }));
    expect(screen.getByText(`Modified: ${ageMonths} months ago`)).toBeInTheDocument();
  });
});
