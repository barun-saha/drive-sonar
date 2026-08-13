import { Paper, Tabs } from '@mantine/core';
import { SizeChart } from './SizeChart';
import { ExtensionChart } from './ExtensionChart';
import { AgeScatterChart } from './AgeScatterChart';
import { FlatFileEntry } from '../types';

interface VisualizationPanelProps {
  visibleItems: FlatFileEntry[];
  allResults: FlatFileEntry[];
  currentViewPath: string;
}

export function VisualizationPanel({
  visibleItems,
  allResults,
  currentViewPath,
}: VisualizationPanelProps) {
  return (
    <Paper
      p="md"
      radius="md"
      withBorder
      style={{
        height: '100%',
        minHeight: 480,
        backgroundColor: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Tabs keepMounted={true} defaultValue="treemap">
        <Tabs.List>
          <Tabs.Tab value="treemap">Space Map</Tabs.Tab>
          <Tabs.Tab value="extensions">File Types</Tabs.Tab>
          <Tabs.Tab value="age">Age Analysis</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="treemap">
          <SizeChart
            key={`${currentViewPath}-${visibleItems.length}`}
            items={visibleItems}
          />
        </Tabs.Panel>

        <Tabs.Panel value="extensions">
          <ExtensionChart allResults={allResults} currentViewPath={currentViewPath} />
        </Tabs.Panel>

        <Tabs.Panel value="age">
          <AgeScatterChart allResults={allResults} currentViewPath={currentViewPath} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
