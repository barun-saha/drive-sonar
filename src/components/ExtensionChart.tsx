import { useMemo } from 'react';
import { Box, Text, Group } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { ExtensionStat } from '../types';
import { ChartHeader } from './ChartHeader';
import { useLogScale } from '../hooks/useLogScale';
import { formatBytes } from '../utils/format';

interface ExtensionChartProps {
  stats?: ExtensionStat[];
}

export function ExtensionChart({ stats = [] }: ExtensionChartProps) {
  const data = useMemo(() => {
    if (!stats.length) return [];

    return stats.map((stat) => ({
      extension: stat.extension,
      sizeMB: Number((stat.total_bytes / (1024 * 1024)).toFixed(2)),
      rawBytes: stat.total_bytes,
      fileCount: stat.file_count,
    }));
  }, [stats]);

  const { minMB, maxMB } = useMemo(() => {
    if (!data.length) return { minMB: 1, maxMB: 1 };

    const positiveSizes = data.map((p) => p.sizeMB).filter((size) => size > 0);

    if (!positiveSizes.length) return { minMB: 1, maxMB: 1 };

    return {
      minMB: Math.min(...positiveSizes),
      maxMB: Math.max(...positiveSizes),
    };
  }, [data]);

  const { useLogScale: isLog, setUseLogScale, axisProps, getAxisLabel } = useLogScale(minMB, maxMB);

  const displayData = useMemo(() => {
    if (!isLog) return data;
    return data.filter((item) => item.sizeMB > 0);
  }, [data, isLog]);

  return (
    <Box p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChartHeader
        title="TOP 15 FILE EXTENSIONS BY STORAGE"
        checked={isLog}
        onChange={setUseLogScale}
      />

      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {displayData.length > 0 ? (
          <BarChart
            h={380}
            data={displayData}
            dataKey="extension"
            orientation="vertical"
            series={[{ name: 'sizeMB', color: 'var(--accent-primary, #3b82f6)' }]}
            xAxisProps={axisProps}
            yAxisProps={{ width: 80 }}
            xAxisLabel={getAxisLabel('Size (MB)')}
            yAxisLabel="Extension"
            gridAxis="y"
            tooltipProps={{
              content: ({ payload }) => {
                if (!payload || !payload.length) return null;
                const item = payload[0].payload;

                return (
                  <Box
                    p="sm"
                    style={{
                      background: 'var(--bg-panel, #1e1e1e)',
                      border: '1px solid var(--border-color, #333)',
                      borderRadius: 6,
                    }}
                  >
                    <Text size="sm" fw={700}>
                      {item.extension}
                    </Text>
                    <Text size="sm" fw={500} c="dimmed">
                      Size: {formatBytes(item.rawBytes)} ({item.sizeMB} MB)
                    </Text>
                    <Text size="xs" c="dimmed">
                      Files: {item.fileCount.toLocaleString()}
                    </Text>
                  </Box>
                );
              },
            }}
          />
        ) : (
          <Group justify="center" align="center" style={{ height: '100%' }}>
            <Text size="sm" c="dimmed">
              No files to analyze in this scope.
            </Text>
          </Group>
        )}
      </div>
    </Box>
  );
}
