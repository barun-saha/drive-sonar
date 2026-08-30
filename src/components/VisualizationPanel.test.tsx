import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { VisualizationPanel } from './VisualizationPanel';
import { DirectoryPayload } from '../types';

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('VisualizationPanel', () => {
  const mockPayload: DirectoryPayload = {
    current_id: 1,
    current_path: '/home/user',
    parent_id: null,
    ancestors: [],
    items: [{ id: 1, name: 'file1.txt', is_dir: false, size: 100, modified_secs: 100, percentage_of_parent: 100 }],
    extension_stats: [{ extension: '.txt', total_bytes: 100, file_count: 1 }],
    top_files: [{ id: 1, name: 'file1.txt', size: 100, modified_secs: 100, path: '/path/to/file1.txt' }],
    total_scanned_items: 1,
  };

  it('renders tabs and allows switching between visualization panels', () => {
    const onNavigate = vi.fn();
    renderWithMantine(
      <VisualizationPanel payload={mockPayload} onNavigate={onNavigate} />
    );

    expect(screen.getByRole('tab', { name: 'Space Map' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'File Types' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Age Analysis' })).toBeInTheDocument();

    expect(screen.getByText(/Top 12 Space Distribution Map/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'File Types' }));
    expect(screen.getByText('TOP 15 FILE EXTENSIONS BY STORAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Age Analysis' }));
    expect(screen.getByText('TOP 30 LARGEST FILES: SIZE vs AGE')).toBeInTheDocument();
  });
});
