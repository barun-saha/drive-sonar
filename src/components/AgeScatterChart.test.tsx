import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { AgeScatterChart } from './AgeScatterChart';
import { TopFileNode } from '../types';

let capturedScatterProps: any = null;

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
        payload: [{ payload: { fileName: 'large_file.iso', rawBytes: 1048576 * 500, sizeMB: 500, ageMonths: 2 } }],
      });
      renderWithMantine(tooltipUI);
      expect(screen.getByText('large_file.iso')).toBeInTheDocument();
      expect(screen.getByText('Modified: 2 months ago')).toBeInTheDocument();

      expect(content({ payload: [] })).toBeNull();
      expect(content({})).toBeNull();
    }
  });
});
