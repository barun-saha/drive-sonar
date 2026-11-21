import { cloneElement } from 'react';
import { render, screen, fireEvent, createEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { AgeScatterChart } from './AgeScatterChart';
import { applyLanguage } from '../i18n';
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
        payload: [{ payload: { fileName: 'large_file.iso', filePath: '/downloads/large_file.iso', fileId: 1, rawBytes: 1048576 * 500, sizeMB: 500, ageMonths: 2, fileCategory: 'installers' } }],
      });
      renderWithMantine(tooltipUI);
      expect(screen.getByText('large_file.iso')).toBeInTheDocument();
      // Issue #24: verify full path and hint are rendered
      expect(screen.getByText('/downloads/large_file.iso')).toBeInTheDocument();
      expect(screen.getByText('Click point to open in Files Explorer')).toBeInTheDocument();
      expect(screen.getByText('Modified: 2 months ago')).toBeInTheDocument();
      // Issue #112: verify category row is rendered
      expect(screen.getByText('Category: Installers')).toBeInTheDocument();

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
    await user.tab(); // Recent legend chip
    await user.tab(); // Aging legend chip
    await user.tab(); // Old legend chip
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

  it('labels each point with its file name and path for assistive tech and hover', () => {
    renderWithMantine(<AgeScatterChart files={[{ id: 7, name: 'movie.mkv', size: 1048576 * 700, modified_secs: 1, path: '/media/movie.mkv' }]} />);
    const shape = capturedScatterProps.scatterProps.shape;
    const point = (payload?: object) =>
      render(<svg>{cloneElement(shape, { cx: 10, cy: 10, payload })}</svg>).container.querySelector('circle')!;

    const labelled = point({ fileName: 'movie.mkv', filePath: '/media/movie.mkv', sizeMB: 700 });
    expect(labelled).toHaveAttribute('aria-label', 'Open movie.mkv in Files Explorer');
    expect(labelled.querySelector('title')!.textContent).toBe('movie.mkv\n/media/movie.mkv\nOpen in Files Explorer');

    // A point without data must still render rather than throw
    const bare = point(undefined);
    expect(bare).toHaveAttribute('aria-label', 'Open  in Files Explorer');
    expect(bare.querySelector('title')!.textContent).toBe('\n\nOpen in Files Explorer');
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
    expect(screen.getByText('Modified: 1 month ago')).toBeInTheDocument();
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

  describe('modified age in the active language', () => {
    const tooltipFor = (monthsAgo: number) => {
      const modifiedSecs = Math.floor(Date.now() / 1000) - monthsAgo * 86400 * 30.4375;
      renderWithMantine(<AgeScatterChart files={[{ id: 1, name: 'a.zip', size: 1048576 * 100, modified_secs: modifiedSecs, path: '/a.zip' }]} />);
      const point = capturedScatterProps.data[0].data[0];
      renderWithMantine(capturedScatterProps.tooltipProps.content({ payload: [{ payload: point }] }));
    };

    afterEach(async () => {
      await applyLanguage('en');
    });

    it.each([
      ['en', 1, 'Modified: 1 month ago'],
      ['en', 3, 'Modified: 3 months ago'],
      ['es', 1, 'Modificado: hace 1 mes'],
      ['es', 4, 'Modificado: hace 4 meses'],
      ['de', 1, 'Geändert: vor 1 Monat'],
      ['de', 4, 'Geändert: vor 4 Monaten'],
    ] as const)('%s, %s month(s): singular and plural are chosen by the count', async (language, months, expected) => {
      await applyLanguage(language);
      tooltipFor(months);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it('shows fractional months with the language\'s decimal separator', async () => {
      await applyLanguage('de');
      tooltipFor(1.5);
      expect(screen.getByText('Geändert: vor 1,5 Monaten')).toBeInTheDocument();
    });

    it('keeps Latin digits in Bengali and Hindi', async () => {
      await applyLanguage('bn');
      tooltipFor(2);
      expect(screen.getByText('পরিবর্তিত: 2 মাস আগে')).toBeInTheDocument();
    });
  });

  describe('age group assignment', () => {
    const monthsAgo = (months: number) => Math.floor(Date.now() / 1000) - months * 86400 * 30.4375;
    const MB = 1048576;
    const mixedFiles: TopFileNode[] = [
      { id: 1, name: 'recent.zip', size: MB * 100, modified_secs: monthsAgo(1), path: '/recent.zip' },
      { id: 2, name: 'aging.zip', size: MB * 200, modified_secs: monthsAgo(12), path: '/aging.zip' },
      { id: 3, name: 'old1.zip', size: MB * 300, modified_secs: monthsAgo(36), path: '/old1.zip' },
      { id: 4, name: 'old2.zip', size: MB * 400, modified_secs: monthsAgo(60), path: '/old2.zip' },
      { id: 5, name: 'empty.bin', size: 0, modified_secs: monthsAgo(2), path: '/empty.bin' },
    ];

    it('assigns each point to an age group using the 6 and 24 month thresholds', () => {
      renderWithMantine(<AgeScatterChart files={mixedFiles} />);

      const groups = capturedScatterProps.data[0].data.map((p: any) => [p.fileName, p.ageGroup]);
      expect(groups).toEqual([
        ['recent.zip', 'recent'],
        ['aging.zip', 'aging'],
        ['old1.zip', 'old'],
        ['old2.zip', 'old'],
        ['empty.bin', 'recent'],
      ]);
    });

    it('shows the thresholds as reference lines on the chart', () => {
      renderWithMantine(<AgeScatterChart files={mixedFiles} />);

      expect(capturedScatterProps.referenceLines.map((line: any) => [line.x, line.label])).toEqual([
        [6, '6 mo'],
        [24, '24 mo'],
      ]);
    });

    const chip = (name: RegExp) => screen.getByRole('button', { name });
    const plottedNames = () => capturedScatterProps.data[0].data.map((p: any) => p.fileName);

    it('shows a legend with the thresholds and a count per group', () => {
      renderWithMantine(<AgeScatterChart files={mixedFiles} />);

      expect(chip(/^Recent \(≤ 6 mo\)/)).toHaveTextContent('Recent (≤ 6 mo) · 2');
      expect(chip(/^Aging/)).toHaveTextContent('Aging (6–24 mo) · 1');
      expect(chip(/^Old/)).toHaveTextContent('Old (> 24 mo) · 2');
    });

    it('does not count zero-size files in log mode', () => {
      renderWithMantine(<AgeScatterChart files={mixedFiles} />);

      fireEvent.click(screen.getByLabelText('Use semi-log scale'));

      expect(chip(/^Recent/)).toHaveTextContent('· 1');
      expect(plottedNames()).not.toContain('empty.bin');
    });

    it('hides and shows a group when its legend chip is toggled', () => {
      renderWithMantine(<AgeScatterChart files={mixedFiles} />);

      fireEvent.click(chip(/^Old/));
      expect(chip(/^Old/)).toHaveAttribute('aria-pressed', 'false');
      expect(plottedNames()).toEqual(['recent.zip', 'aging.zip', 'empty.bin']);
      expect(chip(/^Old/)).toHaveTextContent('· 2');

      fireEvent.click(chip(/^Old/));
      expect(chip(/^Old/)).toHaveAttribute('aria-pressed', 'true');
      expect(plottedNames()).toHaveLength(5);
    });

    it('keeps the legend available when every group is hidden', () => {
      renderWithMantine(<AgeScatterChart files={mixedFiles} />);

      fireEvent.click(chip(/^Recent/));
      fireEvent.click(chip(/^Aging/));
      fireEvent.click(chip(/^Old/));

      expect(screen.getByText('No files to analyze in this scope.')).toBeInTheDocument();
      fireEvent.click(chip(/^Old/));
      expect(screen.getByTestId('mock-scatter-chart')).toBeInTheDocument();
    });
  });

  // Issue #112: file-category coloring and legend
  describe('file-category coloring (#112)', () => {
    const MB = 1048576;
    const monthsAgo = (months: number) => Math.floor(Date.now() / 1000) - months * 86400 * 30.4375;

    it('assigns fileCategory to each point based on the file name extension', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'movie.mp4',   size: MB * 500, modified_secs: monthsAgo(1),  path: '/movie.mp4' },
        { id: 2, name: 'report.pdf',  size: MB * 100, modified_secs: monthsAgo(12), path: '/report.pdf' },
        { id: 3, name: 'backup.zip',  size: MB * 200, modified_secs: monthsAgo(36), path: '/backup.zip' },
        { id: 4, name: 'setup.exe',   size: MB * 300, modified_secs: monthsAgo(2),  path: '/setup.exe' },
        { id: 5, name: 'script.py',   size: MB * 50,  modified_secs: monthsAgo(5),  path: '/script.py' },
        { id: 6, name: 'unknown.xyz', size: MB * 10,  modified_secs: monthsAgo(3),  path: '/unknown.xyz' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);

      const categories = capturedScatterProps.data[0].data.map((p: any) => [p.fileName, p.fileCategory]);
      expect(categories).toEqual([
        ['movie.mp4',   'media'],
        ['report.pdf',  'documents'],
        ['backup.zip',  'archives'],
        ['setup.exe',   'installers'],
        ['script.py',   'code'],
        ['unknown.xyz', 'other'],
      ]);
    });

    it('colors each point using the category CSS variable, not an age variable', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'movie.mp4',  size: MB * 500, modified_secs: monthsAgo(1),  path: '/movie.mp4' },
        { id: 2, name: 'backup.zip', size: MB * 200, modified_secs: monthsAgo(60), path: '/backup.zip' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);

      const renderPoint = (payload: any) =>
        render(
          <svg>{cloneElement(capturedScatterProps.scatterProps.shape, { cx: 1, cy: 1, payload })}</svg>
        ).container.querySelector('circle')!;

      const [mediaPoint, archivePoint] = capturedScatterProps.data[0].data;

      const mediaDot = renderPoint(mediaPoint);
      expect(mediaDot).toHaveAttribute('fill', 'var(--cat-media)');
      expect(mediaDot).not.toHaveAttribute('fill', 'var(--age-recent)');

      const archiveDot = renderPoint(archivePoint);
      expect(archiveDot).toHaveAttribute('fill', 'var(--cat-archives)');
      expect(archiveDot).not.toHaveAttribute('fill', 'var(--age-old)');

      // Uniform stroke regardless of age
      expect(mediaDot).toHaveAttribute('stroke-width', '1.5');
      expect(archiveDot).toHaveAttribute('stroke-width', '1.5');
    });

    it('renders the CategoryLegend with the categories present in the data', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'movie.mp4',  size: MB * 500, modified_secs: monthsAgo(1),  path: '/movie.mp4' },
        { id: 2, name: 'report.pdf', size: MB * 100, modified_secs: monthsAgo(12), path: '/report.pdf' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);

      expect(screen.getByText('Media')).toBeInTheDocument();
      expect(screen.getByText('Documents')).toBeInTheDocument();
      // Categories not present should not appear in the legend
      expect(screen.queryByText('Installers')).not.toBeInTheDocument();
    });

    it('does not render the legend when no files are provided', () => {
      renderWithMantine(<AgeScatterChart files={[]} />);
      // Legend items use specific category labels; none should appear
      expect(screen.queryByText('Media')).not.toBeInTheDocument();
      expect(screen.queryByText('Other')).not.toBeInTheDocument();
    });

    it('does not render the legend when all points are filtered out in log mode', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'empty.zip', size: 0, modified_secs: monthsAgo(1), path: '/empty.zip' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);
      fireEvent.click(screen.getByLabelText('Use semi-log scale'));

      expect(screen.queryByText('Archives')).not.toBeInTheDocument();
      expect(screen.getByText('No files to analyze in this scope.')).toBeInTheDocument();
    });

    it('shows the file category in the tooltip', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'movie.mp4', size: MB * 500, modified_secs: monthsAgo(1), path: '/movie.mp4' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);

      const content = capturedScatterProps?.tooltipProps?.content;
      const tooltipUI = content({
        payload: [{ payload: { fileName: 'movie.mp4', filePath: '/movie.mp4', fileId: 1, rawBytes: MB * 500, sizeMB: 500, ageMonths: 1, fileCategory: 'media' } }],
      });
      renderWithMantine(tooltipUI);
      expect(screen.getByText('Category: Media')).toBeInTheDocument();
    });

    it('renders scatter points with slightly larger radii based on file size', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'small.txt',  size: MB * 100,  modified_secs: monthsAgo(1), path: '/small.txt' },
        { id: 2, name: 'medium.zip', size: MB * 800,  modified_secs: monthsAgo(1), path: '/medium.zip' },
        { id: 3, name: 'large.iso',  size: MB * 2000, modified_secs: monthsAgo(1), path: '/large.iso' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);

      const renderPoint = (payload: any) =>
        render(
          <svg>{cloneElement(capturedScatterProps.scatterProps.shape, { cx: 1, cy: 1, payload })}</svg>
        ).container.querySelector('circle')!;

      const [small, medium, large] = capturedScatterProps.data[0].data;

      expect(renderPoint(small)).toHaveAttribute('r', '6');
      expect(renderPoint(medium)).toHaveAttribute('r', '8');
      expect(renderPoint(large)).toHaveAttribute('r', '10');
    });

    it('falls back to raw fileCategory string in tooltip when category is unrecognised', () => {
      const files: TopFileNode[] = [
        { id: 1, name: 'weird.xyz', size: MB * 10, modified_secs: monthsAgo(1), path: '/weird.xyz' },
      ];
      renderWithMantine(<AgeScatterChart files={files} />);

      const content = capturedScatterProps?.tooltipProps?.content;
      const tooltipUI = content({
        payload: [{ payload: { fileName: 'weird.xyz', filePath: '/weird.xyz', fileId: 1, rawBytes: MB * 10, sizeMB: 10, ageMonths: 1, fileCategory: 'other' } }],
      });
      renderWithMantine(tooltipUI);
      expect(screen.getByText('Category: Other')).toBeInTheDocument();
    });
  });
});
