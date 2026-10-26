import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { ItemList } from './ItemList';
import { DirectoryPayload } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { notifications } from '@mantine/notifications';

const sizeMock = vi.hoisted(() => ({ height: 0 }));
vi.mock('@mantine/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mantine/hooks')>()),
  useElementSize: () => ({ ref: () => {}, width: 0, height: sizeMock.height }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function renderWithMantine(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>
  );
}

describe('ItemList', () => {
  const mockPayload: DirectoryPayload = {
    current_id: 1,
    current_path: '/home/user/docs',
    parent_id: 0,
    ancestors: [{ id: 0, name: '/home/user/docs' }],
    items: [
      {
        id: 10,
        name: 'Folder A',
        is_dir: true,
        size: 500000,
        modified_secs: 1000,
        percentage_of_parent: 80,
      },
      {
        id: 11,
        name: 'File B.txt',
        is_dir: false,
        size: 100000,
        modified_secs: 2000,
        percentage_of_parent: 20,
      },
    ],
    extension_stats: [],
    top_files: [],
    total_scanned_items: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders items sorted by size and handles empty state', () => {
    const onNavigate = vi.fn();
    const onRefresh = vi.fn();

    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={onNavigate} onRefresh={onRefresh} />
    );

    expect(screen.getByText('Folder A')).toBeInTheDocument();
    expect(screen.getByText('File B.txt')).toBeInTheDocument();

    const emptyPayload: DirectoryPayload = {
      ...mockPayload,
      items: [],
    };

    renderWithMantine(
      <ItemList payload={emptyPayload} onNavigate={onNavigate} onRefresh={onRefresh} />
    );

    expect(screen.getByText('This directory is empty.')).toBeInTheDocument();
  });

  it('shows the percentage of the current folder next to the size', () => {
    const payload: DirectoryPayload = {
      ...mockPayload,
      items: [
        ...mockPayload.items,
        { id: 12, name: 'tiny.zip', is_dir: false, size: 10, modified_secs: 1, percentage_of_parent: 0.04 },
      ],
    };
    renderWithMantine(<ItemList payload={payload} onNavigate={vi.fn()} onRefresh={vi.fn()} />);

    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();
    expect(screen.getByText('<0.1%')).toBeInTheDocument();
  });

  it('colors the size bars by category regardless of how large the share is', () => {
    const payload: DirectoryPayload = {
      ...mockPayload,
      items: [
        ...mockPayload.items,
        { id: 12, name: 'tiny.zip', is_dir: false, size: 10, modified_secs: 1, percentage_of_parent: 0.04 },
      ],
    };
    const { container } = renderWithMantine(
      <ItemList payload={payload} onNavigate={vi.fn()} onRefresh={vi.fn()} />
    );

    // Rows are sorted by size: Folder A (80%), File B.txt (20%), tiny.zip
    const bars = Array.from(container.querySelectorAll('.mantine-Progress-section'));
    expect(bars.map((bar) => bar.getAttribute('style'))).toEqual([
      expect.stringContaining('var(--cat-folder)'),
      expect.stringContaining('var(--cat-documents)'),
      expect.stringContaining('var(--cat-archives)'),
    ]);
  });

  it('navigates when clicking a directory item', () => {
    const onNavigate = vi.fn();
    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={onNavigate} onRefresh={vi.fn()} />
    );

    fireEvent.click(screen.getByText('Folder A'));
    expect(onNavigate).toHaveBeenCalledWith(10);

    onNavigate.mockClear();
    fireEvent.click(screen.getByText('File B.txt'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('invokes open_in_explorer when action icon is clicked', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={vi.fn()} onRefresh={vi.fn()} />
    );

    const openIcons = screen.getAllByTitle('Open in Files Explorer');
    fireEvent.click(openIcons[0]);

    expect(invoke).toHaveBeenCalledWith('open_in_explorer', { nodeId: 10 });
  });

  it('handles open_in_explorer failure gracefully', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Explorer failed'));

    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={vi.fn()} onRefresh={vi.fn()} />
    );

    const openIcons = screen.getAllByTitle('Open in Files Explorer');
    fireEvent.click(openIcons[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('open_in_explorer', { nodeId: 10 });
    });
  });

  it('opens confirm modal for deletion and moves item to trash on confirm', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    const onItemTrashed = vi.fn();
    const showSpy = vi.spyOn(notifications, 'show');

    renderWithMantine(
      <ItemList
        payload={mockPayload}
        onNavigate={onNavigate}
        onRefresh={vi.fn()}
        onItemTrashed={onItemTrashed}
      />
    );

    const trashIcons = screen.getAllByTitle('Move to Trash');
    fireEvent.click(trashIcons[0]); // Folder A

    expect(await screen.findByText(/Are you sure you want to move/)).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('move_to_trash', { nodeId: 10 });
      expect(onItemTrashed).toHaveBeenCalledWith(mockPayload.items[0]);
      expect(showSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Success',
          message: expect.stringMatching(/Folder A.*KB/),
        })
      );
      expect(onNavigate).toHaveBeenCalledWith(1);
    });
  });

  it('handles move_to_trash error on deletion confirm', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Permission denied'));

    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={vi.fn()} onRefresh={vi.fn()} />
    );

    const trashIcons = screen.getAllByTitle('Move to Trash');
    fireEvent.click(trashIcons[1]); // File B.txt

    expect(await screen.findByText(/Are you sure you want to move/)).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('move_to_trash', { nodeId: 11 });
    });
  });

  it('rescans instead of navigating when trashing detects stale arena state', async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    const onNavigate = vi.fn();
    const onRefresh = vi.fn();

    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={onNavigate} onRefresh={onRefresh} />
    );

    // Trigger modal
    fireEvent.click(screen.getAllByTitle('Move to Trash')[0]);
    expect(await screen.findByText(/Are you sure you want to move/)).toBeInTheDocument();

    // Scope query to the modal dialog
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalledOnce();
      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  it('triggers scroll event on viewport', () => {
    const { container } = renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={vi.fn()} onRefresh={vi.fn()} />
    );

    const scrollContainer = container.querySelector('div[style*="overflow-y: auto"]') || container.querySelector('div[style*="overflowY"]');
    if (scrollContainer) {
      fireEvent.scroll(scrollContainer, { target: { scrollTop: 100 } });
    }
  });

  describe('virtualization viewport', () => {
    const manyItems: DirectoryPayload = {
      ...mockPayload,
      items: Array.from({ length: 100 }, (_, i) => ({
        id: 100 + i,
        name: `file-${String(i).padStart(3, '0')}`,
        is_dir: false,
        size: 100000 - i, // distinct, so sort order is file-000, file-001, ...
        modified_secs: 1000,
        percentage_of_parent: 1,
      })),
      total_scanned_items: 100,
    };

    const renderedCount = () => screen.queryAllByText(/^file-\d{3}$/).length;

    it.each([
      // rows = floor(height / 38) + 5 buffer rows
      [190, 10],
      [440, 16],
      [760, 25],
    ])('renders the rows that fit a %ipx viewport', (height, expected) => {
      sizeMock.height = height;
      renderWithMantine(<ItemList payload={manyItems} onNavigate={vi.fn()} onRefresh={vi.fn()} />);
      expect(renderedCount()).toBe(expected);
      expect(screen.getByText('file-000')).toBeInTheDocument();
    });

    it('renders more rows after the viewport grows', () => {
      sizeMock.height = 190;
      const { rerender } = renderWithMantine(
        <ItemList payload={manyItems} onNavigate={vi.fn()} onRefresh={vi.fn()} />
      );
      expect(renderedCount()).toBe(10);

      sizeMock.height = 760;
      rerender(
        <MantineProvider>
          <ModalsProvider>
            <ItemList payload={manyItems} onNavigate={vi.fn()} onRefresh={vi.fn()} />
          </ModalsProvider>
        </MantineProvider>
      );
      expect(renderedCount()).toBe(25);
    });
  });
});
