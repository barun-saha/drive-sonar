import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useMemo } from 'react';
import { Box, Stack, Group, Text, Progress, Tooltip, ActionIcon } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Folder, File, FolderOpen, Trash2 } from 'lucide-react';

import { DirectoryPayload, UiDiskNode } from '../types';
import { formatBytes } from '../utils/format';
import { PathNav } from '../components/PathNav';

interface ItemListProps {
  payload: DirectoryPayload | null;
  onNavigate: (nodeId: number) => void;
  onRefresh: () => void;
}

export function ItemList({ payload, onNavigate, onRefresh }: ItemListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const ROW_HEIGHT = 38;
  const VIEWPORT_HEIGHT = 440;
  const BUFFER_ITEMS = 5;

  const items = payload?.items ?? [];

  useEffect(() => {
    setScrollTop(0);
    const scrollContainer = document.getElementById('virtual-scroll-viewport');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, [payload?.current_id]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

  const maxVisibleSize = sortedItems.length > 0 && sortedItems[0].size > 0 ? sortedItems[0].size : 1;
  const totalHeight = sortedItems.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ITEMS);
  const endIndex = Math.min(sortedItems.length, Math.floor((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + BUFFER_ITEMS);

  const displayItems = sortedItems.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  const handleOpenInExplorer = async (item: UiDiskNode) => {
    try {
      await invoke('open_in_explorer', { nodeId: item.id });
    } catch (error) {
      notifications.show({
        title: 'Execution Failed',
        message: `Could not open file location: ${error}`,
        color: 'red'
      });
    }
  };

  const handleDelete = (item: UiDiskNode) => {
    const executeDelete = async () => {
      try {
        await invoke('move_to_trash', { nodeId: item.id });

        notifications.show({
          title: 'Success',
          message: `"${item.name}" was successfully moved to Trash.`,
          color: 'green'
        });

        onRefresh();
      } catch (error) {
        notifications.show({
          title: 'Deletion Failed',
          message: `Could not move item to Trash: ${error}`,
          color: 'red'
        });
      }
    };

    modals.openConfirmModal({
      title: 'Confirm File/Directory Deletion',
      centered: true,
      children: item.is_dir ? (
        <Text size="sm">
          Are you absolutely sure you want to move the directory <strong>{item.name}</strong> and all its contents to the Trash?
        </Text>
      ) : (
        <Text size="sm">
          Are you absolutely sure you want to move the file <strong>{item.name}</strong> to the Trash?
        </Text>
      ),
      labels: { confirm: 'Move to Trash', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: executeDelete
    });
  };

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        height: 500,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }}
    >
      <Group justify="space-between" align="center" mb="md">
        <PathNav
          currentPath={payload?.current_path ?? ''}
          parentId={payload?.parent_id ?? null}
          onNavigate={onNavigate}
        />
      </Group>

      <div
        id="virtual-scroll-viewport"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          position: 'relative',
          backgroundColor: 'var(--bg-main)',
          borderRadius: '6px',
          border: '1px solid var(--border-color)'
        }}
      >
        <div
          style={{ height: `${totalHeight}px`, width: '100%', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />

        <div
          style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', left: 0, right: 0, top: 0 }}
        >
          <Stack gap={0}>
            {displayItems.map((item) => {
              const itemPercentage = item.percentage_of_parent ?? (item.size / maxVisibleSize) * 100;
              const isHovered = hoveredId === item.id;

              let barColor = 'green.5';
              if (itemPercentage > 75) barColor = 'red.6';
              else if (itemPercentage > 40) barColor = 'yellow.5';

              return (
                <Group
                  key={item.id}
                  justify="space-between"
                  wrap="nowrap"
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => {
                    if (item.is_dir) onNavigate(item.id);
                  }}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    padding: '0 12px',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: item.is_dir ? 'pointer' : 'default',
                    userSelect: 'none',
                    backgroundColor: isHovered ? 'var(--mantine-color-default-hover)' : 'transparent'
                  }}
                >
                  <Group gap="sm" wrap="nowrap" style={{ flex: 2, minWidth: 0 }}>
                    {
                      item.is_dir
                        ? <Folder size={16} color="var(--color-dir)" />
                        : <File size={16} color="var(--color-file)" />
                    }
                    <Tooltip label="Click to open" disabled={!item.is_dir} openDelay={200}>
                      <Text size="sm" style={{ color: 'var(--text-main)' }} truncate>
                        {item.name}
                      </Text>
                    </Tooltip>
                  </Group>

                  {/* Actions column */}
                  <div
                    style={{
                      flex: '0 0 10px',
                      display: 'flex',
                      gap: '12px',
                      justifyContent: 'flex-end',
                      opacity: isHovered ? 1 : 0,
                      transition: 'opacity 0.12s ease',
                      pointerEvents: isHovered ? 'auto' : 'none'
                    }}
                  >
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      title="Open in Files Explorer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenInExplorer(item);
                      }}
                    >
                      <FolderOpen size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red.5"
                      size="sm"
                      title="Move to Trash"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  </div>

                  <div style={{ flex: 1, padding: '0 16px', minWidth: '80px' }}>
                    <Progress.Root size="md" style={{ borderRadius: '4px' }}>
                      <Tooltip label={`${itemPercentage.toFixed(2)}%`}>
                        <div style={{ width: '100%', height: '100%' }}>
                          <Progress.Section value={itemPercentage} color={barColor} />
                        </div>
                      </Tooltip>
                    </Progress.Root>
                  </div>

                  {/* File size column */}
                  <Text
                    size="sm"
                    style={{ flex: '0 0 90px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}
                  >
                    {formatBytes(item.size)}
                  </Text>
                </Group>
              );
            })}

            {sortedItems.length === 0 && (
              <Box py="xl" style={{ textAlign: 'center' }}>
                <Text size="sm" c="dimmed">
                  This directory is empty.
                </Text>
              </Box>
            )}
          </Stack>
        </div>
      </div>
    </div>
  );
}
