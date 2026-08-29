import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { ExtensionChart } from './ExtensionChart';
import { ExtensionStat } from '../types';

let capturedBarProps: any = null;

vi.mock('@mantine/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/charts')>();
  return {
    ...actual,
    BarChart: (props: any) => {
      capturedBarProps = props;
      return <div data-testid="mock-bar-chart" />;
    },
  };
});

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('ExtensionChart', () => {
  it('renders fallback message when stats list is empty', () => {
    renderWithMantine(<ExtensionChart stats={[]} />);
    expect(screen.getByText('TOP 15 FILE EXTENSIONS BY STORAGE')).toBeInTheDocument();
    expect(screen.getByText('No files to analyze in this scope.')).toBeInTheDocument();
  });

  it('renders chart and handles semi-log scale toggle and tooltip content when extension stats exist', () => {
    const mockStats: ExtensionStat[] = [
      { extension: '.mp4', total_bytes: 1048576 * 100, file_count: 5 },
      { extension: '.txt', total_bytes: 0, file_count: 2 },
    ];

    renderWithMantine(<ExtensionChart stats={mockStats} />);

    expect(screen.getByText('TOP 15 FILE EXTENSIONS BY STORAGE')).toBeInTheDocument();
    expect(screen.getByTestId('mock-bar-chart')).toBeInTheDocument();

    const switchInput = screen.getByLabelText('Use semi-log scale');
    fireEvent.click(switchInput);
    expect(switchInput).toBeChecked();

    // Test tooltip content callback
    const content = capturedBarProps?.tooltipProps?.content;
    if (content) {
      const tooltipUI = content({
        payload: [{ payload: { extension: '.mp4', rawBytes: 1048576 * 100, sizeMB: 100, fileCount: 5 } }],
      });
      renderWithMantine(tooltipUI);
      expect(screen.getByText('.mp4')).toBeInTheDocument();
      expect(screen.getByText('Files: 5')).toBeInTheDocument();

      expect(content({ payload: [] })).toBeNull();
      expect(content({})).toBeNull();
    }
  });
});
