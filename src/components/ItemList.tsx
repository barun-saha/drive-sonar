import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useMemo, useRef } from 'react';
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
  onRefresh: (path?: string) => void;
}

export function ItemList({ payload, onNavigate, onRefresh }: ItemListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const ROW_HEIGHT = 38;
  const VIEWPORT_HEIGHT = 440;
  const BUFFER_ITEMS = 5;

  const items = payload?.items ?? [];

  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [payload?.current_id]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

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
        const rescanRequired = await invoke<boolean>('move_to_trash', { nodeId: item.id });

        notifications.show({
          title: 'Success',
          message: `"${item.name}" was successfully moved to Trash.`,
          color: 'green'
        });

        if (rescanRequired) {
          onRefresh();
        } else if (payload?.current_id !== undefined) {
          onNavigate(payload.current_id);
        } else {
          onRefresh();
        }
      } catch (error) {
        notifications.show({
          title: 'Deletion Failed',
          message: `Could not move item to Trash: ${error}`,
          color: 'red'
        });
      }
    };

    modals.openConfirmModal({
      title: 'Move to Trash',
      centered: true,
      // 1. Make the destructive nature visually distinct
      children:
        <Stack gap="xs">
          <Text size="md">
            Are you sure you want to move {item.is_dir ? 'the directory' : 'the file'}{' '}
            <Text span fw={700} c="red.6" style={{ wordBreak: 'break-all' }}>
              {item.name}
            </Text>
            {item.is_dir ? ' and all its contents' : ''} to the Trash?
          </Text>
          <Text size="md" c="dimmed">
            You can restore items or delete them permanently anytime from your system's Trash.
          </Text>
        </Stack>
      ,
      labels: { confirm: 'Move to Trash', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      // 2. CRITICAL UX TWEAK: Default focus on the Cancel button
      // This prevents accidental deletions if the user happens to press 'Enter' or 'Space' double-tapping
      cancelProps: {
        'data-autofocus': true,
        variant: 'default' // standard neutral styling makes the focus ring clear
      },
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
          ancestors={payload?.ancestors ?? []}
          onNavigate={onNavigate}
          onRescan={(targetPath) => {
            onRefresh(targetPath);
          }}
        />
      </Group>

      <div
        ref={viewportRef}
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
              const itemPercentage = item.percentage_of_parent;
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
