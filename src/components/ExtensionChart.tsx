import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { FlatFileEntry } from "../types";
import { ChartHeader } from "./ChartHeader";
import { useLogScale } from "../hooks/useLogScale";

interface ExtensionChartProps {
  allResults: FlatFileEntry[];
  currentViewPath: string;
}

export function ExtensionChart({ allResults, currentViewPath }: ExtensionChartProps) {
  const data: Record<string, any>[] = useMemo(() => {
    const extMap: Record<string, number> = {};
    const normCurrentView = currentViewPath.replace(/\\/g, '/').toLowerCase();
    const currentPrefix = normCurrentView.endsWith('/') ? normCurrentView : `${normCurrentView}/`;
    const minLength = normCurrentView.length;

    for (let i = 0; i < allResults.length; i++) {
      const entry = allResults[i];
      if (entry.is_dir) continue;
      if (entry.path.length < minLength) continue;

      const normPath = entry.normPath ||  entry.path.replace(/\\/g, '/').toLowerCase();
      if (!normPath.startsWith(currentPrefix) && normPath !== normCurrentView) continue;

      const dotIdx = entry.name.lastIndexOf('.');
      const ext = (dotIdx > 0 && dotIdx < entry.name.length - 1)
        ? entry.name.slice(dotIdx).toLowerCase()
        : '<no ext>';
      extMap[ext] = (extMap[ext] || 0) + entry.size;
    }

    return Object.entries(extMap)
      .map(([ext, totalBytes]) => ({
        extension: ext,
        sizeMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      }))
      .sort((a, b) => b.sizeMB - a.sizeMB)
      .slice(0, 15);
  }, [allResults, currentViewPath]);

  const maxMB = useMemo(() => {
    if (!data.length) return 1;
    return Math.max(...data.map((p) => p.sizeMB));
  }, [data]);

  // Determine logarithmic ticks and axis boundaries dynamically
  const { useLogScale: isLog, setUseLogScale, axisProps, getAxisLabel } = useLogScale(maxMB);

  return (
    <Box p="xs" style={{ height: '100%' }}>
      <ChartHeader
        title='TOP 15 FILE EXTENSIONS BY STORAGE'
        checked={isLog}
        onChange={setUseLogScale}
      />

      <BarChart
        h={380}
        data={data}
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
                  Size: {item.sizeMB} MB
                </Text>
              </Box>
            );
          }
        }}
      />
    </Box>
  );
}
