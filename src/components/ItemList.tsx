import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useMemo } from 'react';
import { Box, Stack, Group, Text, Progress, Tooltip, ActionIcon } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Folder, File, FolderOpen, Trash2 } from 'lucide-react';

import { FlatFileEntry } from '../types';
import { formatBytes } from '../utils/format';
import { PathNav } from '../components/PathNav';

interface ItemListProps {
  items: FlatFileEntry[];
  targetPath: string;
  currentViewPath: string;
  setCurrentViewPath: (path: string) => void;
  onRefresh: () => void;
}

export function ItemList({ items, targetPath, currentViewPath, setCurrentViewPath, onRefresh }: ItemListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const ROW_HEIGHT = 38;
  const VIEWPORT_HEIGHT = 440; // Virtual scroll buffer calculation
  const BUFFER_ITEMS = 5;

  useEffect(() => {
    setScrollTop(0);
    const scrollContainer = document.getElementById('virtual-scroll-viewport');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  }, [currentViewPath]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

  const maxVisibleSize = sortedItems.length > 0 && sortedItems[0].size > 0 ? sortedItems[0].size : 1;
  const totalHeight = sortedItems.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ITEMS);
  const endIndex = Math.min(sortedItems.length, Math.floor((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + BUFFER_ITEMS);

  const displayItems = sortedItems.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;
  const normCurrentView = currentViewPath.replace(/\\/g, '/').toLowerCase();
  const normTarget = targetPath.replace(/\\/g, '/').toLowerCase();
  const normTargetPrefix = normTarget.endsWith('/') ? normTarget : `${normTarget}/`;
  const isOutsideScan = normCurrentView !== normTarget && !normCurrentView.startsWith(normTargetPrefix);

  const handleOpenInExplorer = async (item: FlatFileEntry) => {
    try {
      await invoke('open_in_explorer', { pathStr: item.path, isDir: item.is_dir });
    } catch (error) {
      notifications.show({
        title: 'Execution Failed',
        message: `Could not open file location: ${error}`,
        color: 'red'
      });
    }
  };

  const handleDelete = (item: FlatFileEntry) => {
    const executeDelete = async () => {
      try {
        await invoke('move_to_trash', { pathStr: item.path });

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

    if (item.is_dir) {
      modals.openConfirmModal({
        title: 'Confirm Directory Deletion',
        centered: true,
        children: (
          <Text size="sm">
            Are you absolutely sure you want to move the directory <strong>{item.name}</strong> and all its contents to the Trash?
          </Text>
        ),
        labels: { confirm: 'Move to Trash', cancel: 'Cancel' },
        confirmProps: { color: 'red' },
        onConfirm: executeDelete
      });
    } else {
      executeDelete();
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        height: 500, // Matching explicit height
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }}
    >
      <Group justify="space-between" align="center" mb="md">
        <PathNav
          currentPath={currentViewPath}
          onNavigate={setCurrentViewPath}
        />
      </Group>

      <div
        id="virtual-scroll-viewport"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          flex: 1,
          minHeight: 0, // Fills exact remaining space in the 500px card
          overflowY: 'auto',
          position: 'relative',
          backgroundColor: 'var(--bg-main)',
          borderRadius: '6px',
          border: '1px solid var(--border-color)'
        }}
      >
        <div style={{ height: `${totalHeight}px`, width: '100%', position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />

        <div style={{ transform: `translateY(${offsetY}px)`, position: 'absolute', left: 0, right: 0, top: 0 }}>
          <Stack gap={0}>
            {displayItems.map((item) => {
              const itemPercentage = (item.size / maxVisibleSize) * 100;
              const isHovered = hoveredPath === item.path;

              let barColor = 'green.5';
              if (itemPercentage > 75) barColor = 'red.6';
              else if (itemPercentage > 40) barColor = 'yellow.5';

              return (
                <Group
                  key={item.path}
                  justify="space-between"
                  wrap="nowrap"
                  onMouseEnter={() => setHoveredPath(item.path)}
                  onMouseLeave={() => setHoveredPath(null)}
                  onClick={() => {
                    if (item.is_dir) setCurrentViewPath(item.path);
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
                  <Text size="xs" style={{ flex: '0 0 90px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {formatBytes(item.size)}
                  </Text>
                </Group>
              );
            })}

            {sortedItems.length === 0 && (
              <Box py="xl" style={{ textAlign: 'center' }}>
                {isOutsideScan ? (
                  <Stack align="center" gap="xs">
                    <Text size="sm" fw={600} style={{ color: 'var(--text-main)' }}>
                      Location Outside Scanned Scope
                    </Text>
                    <Text size="sm" c="dimmed" style={{ maxWidth: 380 }}>
                      This folder was not included in your scan of <br /><code>{targetPath}</code>
                      <br />Select the location and run a scan to view the contents.
                    </Text>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    This directory is empty.
                  </Text>
                )}
              </Box>
            )}
          </Stack>
        </div>
      </div>
    </div>
  );
}
