import { Paper, Tabs } from '@mantine/core';
import { SizeChart } from './SizeChart';
import { ExtensionChart } from './ExtensionChart';
import { AgeScatterChart } from './AgeScatterChart';
import { DirectoryPayload } from '../types';

interface VisualizationPanelProps {
  payload: DirectoryPayload | null;
  onNavigate: (nodeId: number) => void;
}

export function VisualizationPanel({ payload, onNavigate }: VisualizationPanelProps) {
  const items = payload?.items ?? [];
  const extensionStats = payload?.extension_stats ?? [];
  const currentViewPath = payload?.current_path ?? '';
  const currentId = payload?.current_id ?? 0;

  return (
    <Paper
      p="md"
      radius="md"
      withBorder
      style={{
        height: 500,
        backgroundColor: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <Tabs
        defaultValue="treemap"
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <Tabs.List>
          <Tabs.Tab value="treemap">Space Map</Tabs.Tab>
          <Tabs.Tab value="extensions">File Types</Tabs.Tab>
          <Tabs.Tab value="age">Age Analysis</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="treemap" style={{ flex: 1, minHeight: 0, paddingTop: '12px' }}>
          <SizeChart
            key={`treemap-${currentId}`}
            items={items}
            onNavigate={onNavigate}
          />
        </Tabs.Panel>

        <Tabs.Panel value="extensions" style={{ flex: 1, minHeight: 0, paddingTop: '12px' }}>
          <ExtensionChart stats={extensionStats} currentViewPath={currentViewPath} />
        </Tabs.Panel>

        <Tabs.Panel value="age" style={{ flex: 1, minHeight: 0, paddingTop: '12px' }}>
          <AgeScatterChart files={payload?.top_files || []} currentViewPath={currentViewPath} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
