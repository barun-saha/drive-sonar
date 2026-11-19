import { useMemo, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { Box, Button, Text, Group } from '@mantine/core';
import { ScatterChart } from '@mantine/charts';
import { useReducedMotion } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import { invoke } from '@tauri-apps/api/core';
import { TopFileNode } from '../types';
import { ChartHeader } from './ChartHeader';
import { ChartTooltip } from './ChartTooltip';
import { CategoryLegend } from './CategoryLegend';
import { useLogScale } from '../hooks/useLogScale';
import { formatBytes } from '../utils/format';
import i18n from '../i18n';
import {
  AGE_GROUPS, AGING_MAX_MONTHS, RECENT_MAX_MONTHS, ageGroupLabel, getAgeGroup, type AgeGroup,
} from '../utils/ageGroup';
import {
  categoryColor, categoryOfItem, type FileCategory,
} from '../utils/fileCategory';

interface AgeScatterChartProps {
  files?: TopFileNode[];
}

// Faint vertical lines at the age thresholds. `extendDomain` keeps them visible even when no file is that old.
const ageReferenceLines = () => [RECENT_MAX_MONTHS, AGING_MAX_MONTHS].map((months) => ({
  x: months,
  label: i18n.t('age.months', { n: months }),
  strokeDasharray: '4 4',
  ifOverflow: 'extendDomain' as const,
}));

// Issue #24: Custom Dot Component with click handler, pointer cursor, and native title hint
const DynamicScatterPoint = (props: any) => {
  const { cx, cy, payload, onPointClick } = props;

  // Issue #112: Color shows file category (matches the File Types bar graph palette).
  // Radius still grows with size for a secondary size cue.
  const sizeMB = payload?.sizeMB ?? 0;
  const color = categoryColor(payload?.fileCategory ?? 'other');
  const radius = sizeMB < 500 ? 6 : sizeMB < 1500 ? 8 : 10;

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
      stroke={'var(--bg-panel)'}
      strokeWidth={1.5}
      tabIndex={0}
      role="button"
      aria-label={i18n.t('age.openFile', { name: payload?.fileName ?? '' })}
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
      <title>{`${payload?.fileName ?? ''}\n${payload?.filePath ?? ''}\n${i18n.t('list.openInExplorer')}`}</title>
    </circle>
  );
};

export function AgeScatterChart({ files = [] }: AgeScatterChartProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const referenceLines = useMemo(ageReferenceLines, [t]);

  // Issue #24: Open file location in native OS explorer
  const handleOpenInExplorer = async (fileId?: number) => {
    if (typeof fileId !== 'number') return;
    try {
      await invoke('open_in_explorer', { nodeId: fileId });
    } catch (error) {
      notifications.show({
        title: t('notify.executionFailed'),
        message: t('notify.openLocationFailed', { error: String(error) }),
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
      // Issue #112: derive file category from the file name extension (files are never dirs)
      const fileCategory = categoryOfItem(file.name, false);
      return {
        ageMonths,
        ageGroup: getAgeGroup(ageMonths),
        sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
        rawBytes: file.size,
        fileName: file.name,
        filePath: file.path || file.name, // Issue #24: Full file path
        fileId: file.id, // Issue #24: Arena node ID for explorer reveal
        fileCategory,
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

  // Issue #112: collect the file categories present in the current view for the legend
  const displayedCategories = useMemo(
    () => displayPoints.map((p) => p.fileCategory as FileCategory),
    [displayPoints]
  );

  return (
    <Box p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChartHeader
        title={t('age.title')}
        checked={isLog}
        onChange={setUseLogScale}
      />

      {points.length > 0 && (
        <Group gap="xs" mb="xs" role="group" aria-label={t('age.groupsLabel')}>
          {AGE_GROUPS.map(({ group }) => {
            const visible = !hiddenGroups.has(group);
            return (
              <Button
                key={group}
                size="compact-xs"
                variant={visible ? 'light' : 'subtle'}
                color="gray"
                c={visible ? undefined : 'dimmed'}
                fw={visible ? 600 : 400}
                aria-pressed={visible}
                onClick={() => toggleGroup(group)}
                style={{
                  opacity: visible ? 1 : 0.45,
                }}
              >
                {ageGroupLabel(group)} · {groupCounts[group]}
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
            data={[{ color: 'brand', name: t('age.series'), data: displayPoints as any }]}
            dataKey={{ x: 'plottedAgeMonths', y: 'sizeMB' }}
            xAxisLabel={t('age.axis')}
            yAxisLabel={getAxisLabel(t('charts.sizeMb'))}
            yAxisProps={axisProps}
            referenceLines={referenceLines}
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
                  <ChartTooltip maxWidth={360}>
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
                      {t('charts.size', { size: formatBytes(data.rawBytes) })}
                    </Text>
                    <Text size="sm" fw={500} c="dimmed">
                      {t('age.modified', { n: data.ageMonths })}
                    </Text>
                    {/* Issue #112: Show the file category in the tooltip */}
                    <Text size="sm" fw={500} c="dimmed">
                      {t('age.category', { category: t(`category.${data.fileCategory}`) })}
                    </Text>
                    {/* Issue #24: Instruction to click point */}
                    <Text size="xs" c="dimmed" mt={4} style={{ fontStyle: 'italic' }}>
                      {t('age.clickToOpen')}
                    </Text>
                  </ChartTooltip>
                );
              },
            }}
          />
        ) : (
          <Group justify="center" align="center" style={{ height: '100%' }}>
            <Text size="sm" c="dimmed">
              {t('charts.noFiles')}
            </Text>
          </Group>
        )}
      </div>

      {/* Issue #112: Category legend below the chart, same as ExtensionChart / SizeChart */}
      {displayPoints.length > 0 && <CategoryLegend categories={displayedCategories} />}
    </Box>
  );
}
