import { useMemo } from 'react';
import { Treemap } from '@mantine/charts';
import { Box, Text, Group, Badge } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import type { TreemapNode } from 'recharts';

import { UiDiskNode } from '../types';
import { formatBytes } from '../utils/format';
import { categoryColor, categoryOfItem } from '../utils/fileCategory';
import { CategoryLegend } from './CategoryLegend';
import { ChartTooltip } from './ChartTooltip';

interface SizeChartProps {
  items: UiDiskNode[];
  onNavigate?: (nodeId: number) => void;
}

export function SizeChart({ items, onNavigate }: SizeChartProps) {
  const reduceMotion = useReducedMotion();

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

  const chartData = useMemo(() => {
    return sortedItems
      .filter((item) => item.size > 0)
      .slice(0, 12)
      .map((item) => {
        const mbValue = item.size / (1024 * 1024);
        const category = categoryOfItem(item.name, item.is_dir);
        return {
          id: item.id,
          name: item.name,
          isDir: item.is_dir,
          value: mbValue > 0.05 ? Number(mbValue.toFixed(2)) : 0.05,
          realSize: item.size,
          category,
          color: categoryColor(category),
        };
      });
  }, [sortedItems]);

  return (
    <Box p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Text size="xs" fw={700} c="dimmed" mb="sm" style={{ textTransform: 'uppercase' }}>
        Top 12 Space Distribution Map
      </Text>

      <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
        {chartData.length > 0 ? (
          <Treemap
            data={chartData}
            dataKey="value"
            // Mantine types height as number, but forwards it to ResponsiveContainer, which accepts a percentage
            height={'100%' as unknown as number}
            style={{ position: 'absolute', inset: 0 }}
            treemapProps={{
              isAnimationActive: !reduceMotion,
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
                    <ChartTooltip>
                      <Group gap={6} mb={4}>
                        <Text size="sm" fw={700}>{data.name}</Text>
                        {data.isDir && <Badge size="xs" variant="light">Folder</Badge>}
                      </Group>
                      <Text size="sm" fw={500} c="dimmed">
                        Size: {formatBytes(data.realSize)}
                      </Text>
                      {data.isDir && onNavigate && (
                        <Text size="xs" c="brand" mt={4}>
                          Click block to open folder
                        </Text>
                      )}
                    </ChartTooltip>
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

      {chartData.length > 0 && <CategoryLegend categories={chartData.map((d) => d.category)} />}
    </Box>
  );
}
