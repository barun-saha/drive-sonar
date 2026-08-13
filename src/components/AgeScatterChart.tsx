import { useMemo } from 'react';
import { Box, Text } from '@mantine/core';
import { ScatterChart } from '@mantine/charts';
import { FlatFileEntry } from '../types';

interface AgeScatterChartProps {
  allResults: FlatFileEntry[];
  currentViewPath: string;
}

export function AgeScatterChart({ allResults, currentViewPath }: AgeScatterChartProps) {
  const points = useMemo(() => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const normCurrentView = currentViewPath.replace(/\\/g, '/').toLowerCase();
    const currentPrefix = normCurrentView.endsWith('/') ? normCurrentView : `${normCurrentView}/`;
    const minLength = normCurrentView.length;
    const scopedFiles: FlatFileEntry[] = [];

    // Traditional loop to prevent closure creation across 1M+ array items
    for (let i = 0; i < allResults.length; i++) {
      const item = allResults[i];
      if (item.is_dir) continue;
      if (item.path.length < minLength) continue;

      const normPath = item.normPath || item.path.replace(/\\/g, '/').toLowerCase();
      if (normPath.startsWith(currentPrefix) || normPath === normCurrentView) {
        scopedFiles.push(item);
      }
    }

    // Safely sort scoped subset and take top 30
    const topN = scopedFiles.sort((a, b) => b.size - a.size).slice(0, 30);
    const SECONDS_PER_MONTH = 86400 * 30.4375;

    return topN.map((file) => ({
      ageMonths: file.modified_secs
        ? Math.max(0, Number(((nowSecs - file.modified_secs) / SECONDS_PER_MONTH).toFixed(1)))
        : 0,
      sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
      fileName: file.name,
    }));
  }, [allResults, currentViewPath]);

  return (
    <Box p="xs" style={{ height: '100%' }}>
      <Text size="xs" c="dimmed" mb="sm" fw={600}>
        TOP 30 LARGEST FILES: SIZE vs AGE
      </Text>
      <ScatterChart
        h={380}
        data={[{ color: 'var(--accent-primary, #3b82f6)', name: 'Files', data: points as any }]}
        dataKey={{ x: 'ageMonths', y: 'sizeMB' }}
        xAxisLabel="Age (Months Since Modified)"
        yAxisLabel="Size (MB)"
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
                  Size: {data.sizeMB} MB
                </Text>
                <Text size="sm" fw={500} c="dimmed">
                  Modified: {data.ageMonths} months ago
                </Text>
              </Box>
            );
          },
        }}
      />
    </Box>
  );
}
