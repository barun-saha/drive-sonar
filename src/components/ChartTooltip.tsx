import { ReactNode } from 'react';
import { Box } from '@mantine/core';

interface ChartTooltipProps {
  children: ReactNode;
  maxWidth?: number;
}

/** The box shared by all chart tooltips; each chart supplies its own content */
export function ChartTooltip({ children, maxWidth }: ChartTooltipProps) {
  return (
    <Box
      p="sm"
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        maxWidth,
      }}
    >
      {children}
    </Box>
  );
}
