import { useMemo } from 'react';
import { Box, Text, Group } from '@mantine/core';
import { ScatterChart } from '@mantine/charts';
import { useReducedMotion } from '@mantine/hooks';
import { TopFileNode } from '../types';
import { ChartHeader } from './ChartHeader';
import { useLogScale } from '../hooks/useLogScale';
import { formatBytes } from '../utils/format';

interface AgeScatterChartProps {
  files?: TopFileNode[];
}

// Custom Dot Component
const DynamicScatterPoint = (props: any) => {
  const { cx, cy, payload } = props;

  // Use sizeMB from payload
  const sizeMB = payload?.sizeMB ?? 0;

  // 1. Corrected Color Thresholds
  let color = '#ef4444'; // Red (small/low)
  if (sizeMB < 500) color = '#22c55e'; // Green (medium)
  else if (sizeMB < 1500) color = '#f59e0b'; // Amber (large)

  // 2. Dynamic Radius based on file size (clamped between 4px and 14px)
  const radius = Math.max(4, Math.min(8, sizeMB / 50));

  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={color}
      fillOpacity={0.8}
      stroke="#ffffff"
      strokeWidth={1.5}
      style={{ transition: 'all 0.3s ease' }}
    />
  );
};

export function AgeScatterChart({ files = [] }: AgeScatterChartProps) {
  const reduceMotion = useReducedMotion();

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
      filePath: file.path || file.name,
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
            scatterProps={{
              shape: <DynamicScatterPoint />,
              isAnimationActive: !reduceMotion,
              animationDuration: 1000,
              animationEasing: 'ease-in-out',
              animationBegin: 100,
            }}
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
                      maxWidth: 360,
                    }}
                  >
                    <Text size="sm" fw={700}>
                      {data.fileName}
                    </Text>
                    <Text
                      size="sm"
                      c="dimmed"
                      title={data.filePath}
                      style={{
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                        marginTop: 2,
                        marginBottom: 6,
                      }}
                    >
                      {data.filePath}
                    </Text>
                    <Text size="sm" fw={500} c="dimmed">
                      Size: {formatBytes(data.rawBytes)}
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
