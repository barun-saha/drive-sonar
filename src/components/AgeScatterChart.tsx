import { useMemo, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { Box, Button, Text, Group } from '@mantine/core';
import { ScatterChart } from '@mantine/charts';
import { useReducedMotion } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { invoke } from '@tauri-apps/api/core';
import { TopFileNode } from '../types';
import { ChartHeader } from './ChartHeader';
import { useLogScale } from '../hooks/useLogScale';
import { formatBytes } from '../utils/format';
import {
  AGE_GROUPS, AGING_MAX_MONTHS, RECENT_MAX_MONTHS, ageColor, getAgeGroup, type AgeGroup,
} from '../utils/ageGroup';

interface AgeScatterChartProps {
  files?: TopFileNode[];
}

// Faint vertical lines at the age thresholds. `extendDomain` keeps them visible even when no file is that old.
const AGE_REFERENCE_LINES = [RECENT_MAX_MONTHS, AGING_MAX_MONTHS].map((months) => ({
  x: months,
  label: `${months} mo`,
  strokeDasharray: '4 4',
  ifOverflow: 'extendDomain' as const,
}));

// Issue #24: Custom Dot Component with click handler, pointer cursor, and native title hint
const DynamicScatterPoint = (props: any) => {
  const { cx, cy, payload, onPointClick } = props;

  // Color shows age; the radius still grows with size. The oldest group also gets a heavier outline,
  // so the groups can be told apart without relying on color.
  const sizeMB = payload?.sizeMB ?? 0;
  const color = ageColor(payload?.ageGroup);
  const isOld = payload?.ageGroup === 'old';
  const radius = sizeMB < 500 ? 4 : sizeMB < 1500 ? 6 : 8;

  const handleActivate = (event: MouseEvent<SVGCircleElement> | KeyboardEvent<SVGCircleElement>) => {
    event.stopPropagation();
    props.onClick?.(event);
    onPointClick?.(payload);
  };

  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={color}
      fillOpacity={0.8}
      stroke={isOld ? 'var(--text-main)' : 'var(--bg-panel)'}
      strokeWidth={isOld ? 2 : 1.5}
      tabIndex={0}
      role="button"
      aria-label={`Open ${payload?.fileName ?? 'file'} in Files Explorer`}
      style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleActivate(event);
        }
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

    const basePoints = files.map((file) => {
      const ageMonths = file.modified_secs
        ? Math.max(0, Number(((nowSecs - file.modified_secs) / SECONDS_PER_MONTH).toFixed(1)))
        : 0;
      return {
        ageMonths,
        ageGroup: getAgeGroup(ageMonths),
        sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
        rawBytes: file.size,
        fileName: file.name,
        filePath: file.path || file.name, // Issue #24: Full file path
        fileId: file.id, // Issue #24: Arena node ID for explorer reveal
      };
    });

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
      if (count <= 1) return { ...p, plottedAgeMonths: p.ageMonths };

      const idx = coordIndices.get(key) || 0;
      coordIndices.set(key, idx + 1);

      // Shift the whole group if centered jitter would cross zero.
      const groupStartAge = Math.max(0, p.ageMonths - ((count - 1) / 2) * 0.12);
      return {
        ...p,
        plottedAgeMonths: Number((groupStartAge + idx * 0.12).toFixed(2)),
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

  const [hiddenGroups, setHiddenGroups] = useState<Set<AgeGroup>>(new Set());

  const toggleGroup = (group: AgeGroup) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      return next;
    });
  };

  const plottablePoints = useMemo(() => {
    if (!isLog) return points;
    return points.filter((p) => p.sizeMB > 0);
  }, [points, isLog]);

  const groupCounts = useMemo(() => {
    const counts: Record<AgeGroup, number> = { recent: 0, aging: 0, old: 0 };
    plottablePoints.forEach((p) => counts[p.ageGroup]++);
    return counts;
  }, [plottablePoints]);

  const displayPoints = useMemo(
    () => plottablePoints.filter((p) => !hiddenGroups.has(p.ageGroup)),
    [plottablePoints, hiddenGroups]
  );

  return (
    <Box p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChartHeader
        title="TOP 30 LARGEST FILES: SIZE vs AGE"
        checked={isLog}
        onChange={setUseLogScale}
      />

      {points.length > 0 && (
        <Group gap="xs" mb="xs" role="group" aria-label="Age groups">
          {AGE_GROUPS.map(({ group, label }) => {
            const visible = !hiddenGroups.has(group);
            return (
              <Button
                key={group}
                size="compact-xs"
                variant={visible ? 'light' : 'subtle'}
                color="gray"
                aria-pressed={visible}
                onClick={() => toggleGroup(group)}
                leftSection={
                  <Box
                    w={10}
                    h={10}
                    style={{
                      borderRadius: '50%',
                      background: ageColor(group),
                      border: group === 'old' ? '2px solid var(--text-main)' : undefined,
                      opacity: visible ? 1 : 0.4,
                    }}
                  />
                }
              >
                {label} · {groupCounts[group]}
              </Button>
            );
          })}
        </Group>
      )}

      <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
        {displayPoints.length > 0 ? (
          <ScatterChart
            h="100%"
            style={{ position: 'absolute', inset: 0 }}
            data={[{ color: 'brand', name: 'Files', data: displayPoints as any }]}
            dataKey={{ x: 'plottedAgeMonths', y: 'sizeMB' }}
            xAxisLabel="Age (Months Since Modified)"
            yAxisLabel={getAxisLabel('Size (MB)')}
            yAxisProps={axisProps}
            referenceLines={AGE_REFERENCE_LINES}
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
                      background: 'var(--bg-panel)',
                      border: '1px solid var(--border-color)',
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
                      ff="monospace"
                      title={data.filePath}
                      style={{
                        wordBreak: 'break-all',
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
