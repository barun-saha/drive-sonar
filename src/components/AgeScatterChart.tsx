import { useMemo } from 'react';
import { Box, Text, Group } from '@mantine/core';
import { ScatterChart } from '@mantine/charts';
import { useReducedMotion } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { invoke } from '@tauri-apps/api/core';
import { TopFileNode } from '../types';
import { ChartHeader } from './ChartHeader';
import { useLogScale } from '../hooks/useLogScale';
import { formatBytes } from '../utils/format';

interface AgeScatterChartProps {
  files?: TopFileNode[];
}

// Issue #24: Custom Dot Component with click handler, pointer cursor, and native title hint
const DynamicScatterPoint = (props: any) => {
  const { cx, cy, payload, onPointClick } = props;

  // Use sizeMB from payload
  const sizeMB = payload?.sizeMB ?? 0;

  // Corrected Color Thresholds
  let color = '#ef4444'; // Red (big: >= 1500 MB)
  let radius = 8;
  if (sizeMB < 500) {
    color = '#22c55e'; // Green (small: < 500 MB)
    radius = 4;
  }
  else if (sizeMB < 1500) {
    color = '#f59e0b'; // Amber/Yellow (medium: 500-1499 MB)
    radius = 6;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={color}
      fillOpacity={0.8}
      stroke="#ffffff"
      strokeWidth={1.5}
      style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
      onClick={(e) => {
        // Issue #24: Open file in explorer on dot click
        e.stopPropagation();
        props.onClick?.(e);
        onPointClick?.(payload);
      }}
    >
      {/* Issue #24: Native SVG title hint for immediate hover feedback */}
      <title>{`${payload?.fileName ?? ''}\n${payload?.filePath ?? ''}\nClick to open in Files Explorer`}</title>
    </circle>
  );
};

export function AgeScatterChart({ files = [] }: AgeScatterChartProps) {
  const reduceMotion = useReducedMotion();

  // Issue #24: Open file location in native OS explorer
  const handleOpenInExplorer = async (fileId?: number) => {
    if (typeof fileId !== 'number') return;
    try {
      await invoke('open_in_explorer', { nodeId: fileId });
    } catch (error) {
      notifications.show({
        title: 'Execution Failed',
        message: `Could not open file location: ${error}`,
        color: 'red',
      });
    }
  };

  const points = useMemo(() => {
    if (!files.length) return [];

    const nowSecs = Math.floor(Date.now() / 1000);
    const SECONDS_PER_MONTH = 86400 * 30.4375;

    const basePoints = files.map((file) => ({
      ageMonths: file.modified_secs
        ? Math.max(0, Number(((nowSecs - file.modified_secs) / SECONDS_PER_MONTH).toFixed(1)))
        : 0,
      sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
      rawBytes: file.size,
      fileName: file.name,
      filePath: file.path || file.name, // Issue #24: Full file path
      fileId: file.id, // Issue #24: Arena node ID for explorer reveal
    }));

    // Issue #24: Slight jitter for identical coordinates so points don't fully occlude each other
    const coordCounts = new Map<string, number>();
    basePoints.forEach((p) => {
      const key = `${p.ageMonths}_${p.sizeMB}`;
      coordCounts.set(key, (coordCounts.get(key) || 0) + 1);
    });

    const coordIndices = new Map<string, number>();
    return basePoints.map((p) => {
      const key = `${p.ageMonths}_${p.sizeMB}`;
      const count = coordCounts.get(key) || 1;
      if (count <= 1) return p;

      const idx = coordIndices.get(key) || 0;
      coordIndices.set(key, idx + 1);

      const offset = (idx - (count - 1) / 2) * 0.12;
      return {
        ...p,
        ageMonths: Math.max(0, Number((p.ageMonths + offset).toFixed(2))),
      };
    });
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
              shape: <DynamicScatterPoint onPointClick={(data: any) => handleOpenInExplorer(data?.fileId)} />, // Issue #24
              onClick: (entry: any) => {
                // Issue #24: Support point click via chart handler
                const fileId = entry?.fileId ?? entry?.payload?.fileId;
                handleOpenInExplorer(fileId);
              },
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
                    <Text size="sm" fw={700} style={{ wordBreak: 'break-all' }}>
                      {data.fileName}
                    </Text>
                    {/* Issue #24: Full file path displayed in tooltip */}
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
                    {/* Issue #24: Instruction to click point */}
                    <Text size="xs" c="dimmed" mt={4} style={{ fontStyle: 'italic' }}>
                      Click point to open in Files Explorer
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
