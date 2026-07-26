import { Group, TextInput, Button, Text, ActionIcon, Stack } from '@mantine/core';
import { Search, FolderOpen, Loader2, CircleX } from 'lucide-react';

interface ToolbarProps {
  targetPath: string;
  setTargetPath: (path: string) => void;
  onBrowse: () => void;
  onScan: () => void;
  onCancel: () => void;
  isScanning: boolean;
  scanTime: number | null;
  totalItems: number;
}

export function Toolbar({ targetPath, setTargetPath, onBrowse, onScan, onCancel, isScanning, scanTime, totalItems }: ToolbarProps) {
  return (
    <div style={{ background: 'var(--bg-panel)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      {/* Self-contained animation styles injected right into the component */}
      <style>{`
        @keyframes ui-bridge-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .force-spin {
          animation: ui-bridge-spin 1s linear infinite !important;
          transform-origin: center !important;
          display: inline-block !important;
        }
      `}</style>

      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group style={{ flex: 1 }}>
            <TextInput
              placeholder="Select a target directory to scan..."
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              style={{ flex: 1 }}
              styles={{
                input: { backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }
              }}
              rightSection={
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={onBrowse}
                  disabled={isScanning}
                  title="Browse folder"
                >
                  <FolderOpen size={16} />
                </ActionIcon>
              }
            />
            <Button
              onClick={onScan}
              disabled={isScanning || !targetPath.trim()}
              leftSection={isScanning ? <Loader2 size={16} className="force-spin" /> : <Search size={16} />}
            >
              {isScanning ? 'Scanning...' : 'Run Scan'}
            </Button>
            <Button
              color="red"
              variant="light"
              onClick={onCancel}
              disabled={!isScanning}
              leftSection={<CircleX size={16} />}
            >
              Cancel Scan
            </Button>
          </Group>
        </Group>

        {scanTime !== null && (
        <Text size="sm" c="dimmed">
          Found <strong style={{ color: 'var(--accent-primary)' }}>{totalItems.toLocaleString()}</strong> items in{' '}
          <strong style={{ color: 'var(--color-success)' }}>{(scanTime / 1000).toFixed(3)}s</strong>
        </Text>
        )}
      </Stack>
    </div>
  );
}
