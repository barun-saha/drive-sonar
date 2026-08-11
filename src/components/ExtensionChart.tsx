import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { FlatFileEntry } from "../types";

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

      const dotIdx = entry.path.lastIndexOf('.');
      const ext = dotIdx > 0 ? entry.path.slice(dotIdx).toLowerCase() : 'no ext';
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

  return (
    <Box p="xs" style={{ height: '100%' }}>
      <Text size="xs" c="dimmed" mb="sm" fw={600}>
        TOP 15 FILE EXTENSIONS BY STORAGE (MB)
      </Text>
      <BarChart
        h={380}
        data={data}
        dataKey="extension"
        orientation="vertical"
        series={[{ name: 'sizeMB', color: 'var(--accent-primary, #3b82f6)' }]}
        // Add a bit (1%) of visual breathing room
        xAxisProps={{ domain: [0, (dataMax) => Math.ceil(dataMax * 1.01)] }}
        yAxisProps={{ width: 80 }}
        xAxisLabel="Size (MB)"
        yAxisLabel="Extension"
        gridAxis="y"
      />
    </Box>
  );
}
