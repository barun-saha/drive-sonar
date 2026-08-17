import { useMemo } from 'react';
import { Box, Text, Group } from '@mantine/core';
import { ScatterChart } from '@mantine/charts';
import { TopFileNode } from '../types';
import { ChartHeader } from './ChartHeader';
import { useLogScale } from '../hooks/useLogScale';
import { formatBytes } from '../utils/format';

interface AgeScatterChartProps {
  files?: TopFileNode[];
  currentViewPath?: string;
}

export function AgeScatterChart({ files = [] }: AgeScatterChartProps) {
  const points = useMemo(() => {
    if (!files.length) return [];

    const nowSecs = Math.floor(Date.now() / 1000);
    const SECONDS_PER_MONTH = 86400 * 30.4375;

    return files.map((file) => ({
      ageMonths: file.modified_secs
        ? Math.max(0, Number(((nowSecs - file.modified_secs) / SECONDS_PER_MONTH).toFixed(1)))
        : 0,
      sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
      rawBytes: file.size,
      fileName: file.name,
    }));
  }, [files]);

  const { minMB, maxMB } = useMemo(() => {
    if (!points.length) return { minMB: 1, maxMB: 1 };

    const positiveSizes = points.map((p) => p.sizeMB).filter((size) => size > 0);

    if (!positiveSizes.length) return { minMB: 1, maxMB: 1 };

    return {
      minMB: Math.min(...positiveSizes),
      maxMB: Math.max(...positiveSizes),
    };
  }, [points]);

  const { useLogScale: isLog, setUseLogScale, axisProps, getAxisLabel } = useLogScale(minMB, maxMB);

  const displayPoints = useMemo(() => {
    if (!isLog) return points;
    return points.filter((p) => p.sizeMB > 0);
  }, [points, isLog]);

  return (
    <Box p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChartHeader
        title="TOP 30 LARGEST FILES: SIZE vs AGE"
        checked={isLog}
        onChange={setUseLogScale}
      />

      <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
        {displayPoints.length > 0 ? (
          <ScatterChart
            h={380}
            data={[{ color: 'var(--accent-primary, #3b82f6)', name: 'Files', data: displayPoints as any }]}
            dataKey={{ x: 'ageMonths', y: 'sizeMB' }}
            xAxisLabel="Age (Months Since Modified)"
            yAxisLabel={getAxisLabel('Size (MB)')}
            yAxisProps={axisProps}
            tooltipProps={{
              content: ({ payload }) => {
                if (!payload || !payload.length) return null;
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
                    <Text size="sm" fw={700}>
                      {data.fileName}
                    </Text>
                    <Text size="sm" fw={500} c="dimmed">
                      Size: {formatBytes(data.rawBytes)} ({data.sizeMB} MB)
                    </Text>
                    <Text size="sm" fw={500} c="dimmed">
                      Modified: {data.ageMonths} months ago
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
