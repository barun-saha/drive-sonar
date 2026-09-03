import { useMemo } from 'react';
import { Treemap } from '@mantine/charts';
import { Text, Group, Box, Badge } from '@mantine/core';
import type { TreemapNode } from 'recharts';

import { UiDiskNode } from '../types';
import { formatBytes } from '../utils/format';

interface SizeChartProps {
  items: UiDiskNode[];
  onNavigate?: (nodeId: number) => void;
}

export function SizeChart({ items, onNavigate }: SizeChartProps) {
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

  const colorPalette = ['teal.6', 'indigo.6', 'pink.6', 'cyan.6', 'grape.6', 'orange.6'];

  const chartData = useMemo(() => {
    return sortedItems
      .filter((item) => item.size > 0)
      .slice(0, 12)
      .map((item, index) => {
        const mbValue = item.size / (1024 * 1024);
        return {
          id: item.id,
          name: item.name,
          isDir: item.is_dir,
          value: mbValue > 0.05 ? Number(mbValue.toFixed(2)) : 0.05,
          realSize: item.size,
          color: colorPalette[index % colorPalette.length],
        };
      });
  }, [sortedItems]);

  return (
    <Box p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Text size="xs" fw={700} c="dimmed" mb="sm" style={{ textTransform: 'uppercase' }}>
        Top 12 Space Distribution Map
      </Text>

      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {chartData.length > 0 ? (
          <Treemap
            data={chartData}
            dataKey="value"
            height={380}
            treemapProps={{
              isAnimationActive: true,
              animationDuration: 1000,
              animationEasing: 'ease-out',
              onClick: (node: TreemapNode) => {
                const isDir = Boolean(node?.isDir ?? (node as any)?.payload?.isDir);
                const id = node?.id ?? (node as any)?.payload?.id;

                if (isDir && onNavigate && typeof id === 'number') {
                  onNavigate(id);
                }
              }
            }}
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
                      <Group gap={6} mb={4}>
                        <Text size="sm" fw={700}>{data.name}</Text>
                        {data.isDir && <Badge size="xs" variant="light" color="blue">Folder</Badge>}
                      </Group>
                      <Text size="sm" fw={500} c="dimmed">
                        Size: {formatBytes(data.realSize)}
                      </Text>
                      {data.isDir && onNavigate && (
                        <Text size="xs" c="blue" mt={4}>
                          Click block to open folder
                        </Text>
                      )}
                    </Box>
                  );
                }
                return null;
              }
            }}
          />
        ) : (
          <Group justify="center" align="center" style={{ height: '100%' }}>
            <Text size="sm" c="dimmed">No non-empty items to map in this scope.</Text>
          </Group>
        )}
      </div>
    </Box>
  );
}
