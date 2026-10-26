import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { SizeChart } from './SizeChart';
import { UiDiskNode } from '../types';

let capturedTreemapProps: any = null;

vi.mock('@mantine/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/charts')>();
  return {
    ...actual,
    Treemap: (props: any) => {
      capturedTreemapProps = props;
      return <div data-testid="mock-treemap" />;
    },
  };
});

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('SizeChart', () => {
  it('renders fallback message when items list is empty', () => {
    renderWithMantine(<SizeChart items={[]} />);
    expect(screen.getByText(/Top 12 Space Distribution Map/i)).toBeInTheDocument();
    expect(screen.getByText('No non-empty items to map in this scope.')).toBeInTheDocument();
  });

  it('keeps a block color when the sort order changes', () => {
    const colorsByName = (items: UiDiskNode[]) => {
      renderWithMantine(<SizeChart items={items} />);
      return Object.fromEntries(capturedTreemapProps.data.map((d: any) => [d.name, d.color]));
    };
    const video: UiDiskNode = { id: 1, name: 'Video.mp4', is_dir: false, size: 900, modified_secs: 1, percentage_of_parent: 90 };
    const photos: UiDiskNode = { id: 2, name: 'Photos', is_dir: true, size: 100, modified_secs: 1, percentage_of_parent: 10 };

    const before = colorsByName([video, photos]);
    const after = colorsByName([{ ...video, size: 50 }, photos]);

    expect(after).toEqual(before);
  });

  it('renders treemap and triggers node click and tooltip content callbacks', () => {
    const items: UiDiskNode[] = [
      { id: 1, name: 'Video.mp4', is_dir: false, size: 50000000, modified_secs: 100, percentage_of_parent: 50 },
      { id: 2, name: 'Photos', is_dir: true, size: 50000000, modified_secs: 200, percentage_of_parent: 50 },
      { id: 3, name: 'Tiny', is_dir: false, size: 10, modified_secs: 200, percentage_of_parent: 1 },
      { id: 4, name: 'Zero', is_dir: false, size: 0, modified_secs: 200, percentage_of_parent: 0 },
    ];

    const onNavigate = vi.fn();
    renderWithMantine(<SizeChart items={items} onNavigate={onNavigate} />);

    expect(screen.getByText(/Top 12 Space Distribution Map/i)).toBeInTheDocument();
    expect(screen.getByTestId('mock-treemap')).toBeInTheDocument();

    // Colors come from the item's category, not its rank
    expect(capturedTreemapProps.data.map((d: any) => [d.name, d.color])).toEqual([
      ['Video.mp4', 'var(--cat-media)'],
      ['Photos', 'var(--cat-folder)'],
      ['Tiny', 'var(--cat-other)'],
    ]);
    const legend = screen.getByLabelText('Color legend');
    expect(legend).toHaveTextContent('Folders');
    expect(legend).toHaveTextContent('Media');
    expect(legend).toHaveTextContent('Other');
    expect(legend).not.toHaveTextContent('Archives');

    // Test treemap onClick prop callback
    const onClick = capturedTreemapProps?.treemapProps?.onClick;
    if (onClick) {
      onClick({ isDir: true, id: 2 });
      expect(onNavigate).toHaveBeenCalledWith(2);

      onClick({ payload: { isDir: true, id: 5 } });
      expect(onNavigate).toHaveBeenCalledWith(5);

      onClick({ isDir: false, id: 1 });
      onClick(null);
    }

    // Test tooltip content callback
    const content = capturedTreemapProps?.tooltipProps?.content;
    if (content) {
      const activeTooltip = content({
        active: true,
        payload: [{ payload: { name: 'Photos', isDir: true, realSize: 50000000 } }],
      });
      renderWithMantine(activeTooltip);
      expect(screen.getByText('Photos')).toBeInTheDocument();
      expect(screen.getByText('Folder')).toBeInTheDocument();
      expect(screen.getByText('Click block to open folder')).toBeInTheDocument();

      const nullTooltip = content({ active: false, payload: [] });
      expect(nullTooltip).toBeNull();
    }
  });
});
