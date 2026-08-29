import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { ChartHeader } from './ChartHeader';

function renderWithMantine(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('ChartHeader', () => {
  it('renders title and toggle switch correctly', () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <ChartHeader title="TEST TITLE" checked={false} onChange={handleChange} />
    );

    expect(screen.getByText('TEST TITLE')).toBeInTheDocument();
    expect(screen.getByLabelText('Use semi-log scale')).not.toBeChecked();
  });

  it('reflects checked state and triggers onChange when clicked', () => {
    const handleChange = vi.fn();
    renderWithMantine(
      <ChartHeader title="TEST TITLE" checked={true} onChange={handleChange} />
    );

    const switchInput = screen.getByLabelText('Use semi-log scale');
    expect(switchInput).toBeChecked();

    fireEvent.click(switchInput);
    expect(handleChange).toHaveBeenCalledWith(false);
  });
});
