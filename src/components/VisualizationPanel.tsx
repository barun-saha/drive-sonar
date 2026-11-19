import { Paper, Tabs } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { SizeChart } from './SizeChart';
import { ExtensionChart } from './ExtensionChart';
import { AgeScatterChart } from './AgeScatterChart';
import { DirectoryPayload } from '../types';

interface VisualizationPanelProps {
  payload: DirectoryPayload | null;
  onNavigate: (nodeId: number) => void;
}

export function VisualizationPanel({ payload, onNavigate }: VisualizationPanelProps) {
  const { t } = useTranslation();
  const items = payload?.items ?? [];
  const extensionStats = payload?.extension_stats ?? [];
  const currentId = payload?.current_id ?? 0;

  return (
    <Paper
      p="md"
      radius="md"
      withBorder
      style={{
        minHeight: 0,
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
          <Tabs.Tab value="treemap">{t('tabs.spaceMap')}</Tabs.Tab>
          <Tabs.Tab value="extensions">{t('tabs.fileTypes')}</Tabs.Tab>
          <Tabs.Tab value="age">{t('tabs.ageAnalysis')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="treemap" style={{ flex: 1, minHeight: 0, paddingTop: '12px' }}>
          <SizeChart
            key={`treemap-${currentId}`}
            items={items}
            onNavigate={onNavigate}
          />
        </Tabs.Panel>

        <Tabs.Panel value="extensions" style={{ flex: 1, minHeight: 0, paddingTop: '12px' }}>
          <ExtensionChart stats={extensionStats} />
        </Tabs.Panel>

        <Tabs.Panel value="age" style={{ flex: 1, minHeight: 0, paddingTop: '12px' }}>
          <AgeScatterChart files={payload?.top_files || []} />
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
