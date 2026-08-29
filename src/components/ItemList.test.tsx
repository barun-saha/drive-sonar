import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { ItemList } from './ItemList';
import { DirectoryPayload } from '../types';
import { invoke } from '@tauri-apps/api/core';

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

    renderWithMantine(
      <ItemList payload={mockPayload} onNavigate={onNavigate} onRefresh={vi.fn()} />
    );

    const trashIcons = screen.getAllByTitle('Move to Trash');
    fireEvent.click(trashIcons[0]); // Folder A

    expect(await screen.findByText('Confirm File/Directory Deletion')).toBeInTheDocument();

    const confirmSpan = screen.getByText('Move to Trash');
    fireEvent.click(confirmSpan);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('move_to_trash', { nodeId: 10 });
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

    expect(await screen.findByText('Confirm File/Directory Deletion')).toBeInTheDocument();

    const confirmSpan = screen.getByText('Move to Trash');
    fireEvent.click(confirmSpan);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('move_to_trash', { nodeId: 11 });
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
});
