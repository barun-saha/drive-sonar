import { useMemo } from 'react';
import { Treemap } from '@mantine/charts';
import { Text, Group, Box } from '@mantine/core';

import { FlatFileEntry } from '../types';

interface SizeChartProps {
  items: FlatFileEntry[];
}

export function SizeChart({ items }: SizeChartProps) {
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

  const colorPalette = ['teal.6', 'indigo.6', 'pink.6', 'cyan.6', 'grape.6', 'orange.6'];

  const chartData = useMemo(() => {
    return sortedItems
      .slice(0, 12)
      .map((item, index) => {
        const mbValue = item.size / (1024 * 1024);
        return {
          name: item.name,
          value: mbValue > 0.05 ? Number(mbValue.toFixed(2)) : 0.05,
          realSize: item.size,
          color: colorPalette[index % colorPalette.length],
        };
      });
  }, [sortedItems]);

  return (
    <Box p="xs" style={{ height: '100%' }}>
      <Text size="xs" fw={700} c="dimmed" mb="sm" style={{ textTransform: 'uppercase' }}>
        Space Distribution Map (Values in MB)
      </Text>

      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {chartData.length > 0 ? (
          <Treemap
            data={chartData}
            dataKey="value"
            height={380}
            tooltipProps={{
              content: ({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                  <Box
                    p="sm"
                    style={{
                      background: 'var(--bg-panel, #1e1e1e)',
                      border: '1px solid var(--border-color, #333)',
                      borderRadius: 6,
                    }}
                    >
                      <Text size="sm" fw={700}>{data.name}</Text>
                      <Text size="sm" fw={500} c="dimmed">Size: {formatBytes(data.realSize)}</Text>
                    </Box>
                  );
                }
                return null;
              }
            }}
          />
        ) : (
          <Group justify="center" align="center" style={{ height: '100%' }}>
            <Text size="sm" c="dimmed">No files to map in this scope.</Text>
          </Group>
        )}
      </div>
    </Box>
  );
}
