import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useElementSize, useMergedRef } from '@mantine/hooks';
import { Box, Stack, Group, Text, Progress, Tooltip, ActionIcon, Menu } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Folder, File, FolderOpen, Trash2 } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';

import { DirectoryPayload, UiDiskNode } from '../types';
import { formatBytes, formatPercent } from '../utils/format';
import { categoryColor, categoryOfItem } from '../utils/fileCategory';
import { PathNav } from '../components/PathNav';

interface ItemListProps {
  payload: DirectoryPayload | null;
  onNavigate: (nodeId: number) => void;
  onRefresh: (path?: string) => void;
  onItemTrashed?: (item: UiDiskNode) => void;
}

export function ItemList({ payload, onNavigate, onRefresh, onItemTrashed }: ItemListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: UiDiskNode } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { ref: sizeRef, height: viewportHeight } = useElementSize();
  const mergedViewportRef = useMergedRef(viewportRef, sizeRef);

  const ROW_HEIGHT = 38;
  const BUFFER_ITEMS = 5;

  const items = payload?.items ?? [];

  useEffect(() => {
    setScrollTop(0);
    setSelectedId(null);
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [payload?.current_id]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => b.size - a.size);
  }, [items]);

  const totalHeight = sortedItems.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ITEMS);
  const endIndex = Math.min(sortedItems.length, Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ITEMS);

  const displayItems = sortedItems.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  // Selects a row and scrolls it into view (rows outside the window are not rendered, so focus can't do this)
  const selectIndex = (index: number) => {
    const i = Math.max(0, Math.min(sortedItems.length - 1, index));
    setSelectedId(sortedItems[i].id);
    const viewport = viewportRef.current;
    if (!viewport) return;
    const top = i * ROW_HEIGHT;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (top + ROW_HEIGHT > viewport.scrollTop + viewportHeight) {
      viewport.scrollTop = top + ROW_HEIGHT - viewportHeight;
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) {
      // On a row action button: Escape returns to the list, any other key is left to the button
      if (e.key === 'Escape') e.currentTarget.focus();
      return;
    }
    if (sortedItems.length === 0) return;

    const current = sortedItems.findIndex((item) => item.id === selectedId);
    const selected = current >= 0 ? sortedItems[current] : null;
    const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT));

    switch (e.key) {
      case 'ArrowDown': selectIndex(current + 1); break;
      case 'ArrowUp': selectIndex(current < 0 ? 0 : current - 1); break;
      case 'PageDown': selectIndex(current + page); break;
      case 'PageUp': selectIndex(current - page); break;
      case 'Home': selectIndex(0); break;
      case 'End': selectIndex(sortedItems.length - 1); break;
      case 'Enter':
        if (!selected?.is_dir) return;
        onNavigate(selected.id);
        break;
      case 'Delete':
        if (!selected) return;
        handleDelete(selected);
        break;
      default: return;
    }
    e.preventDefault();
  };

  const openContextMenu = (e: MouseEvent, item: UiDiskNode) => {
    e.preventDefault();
    setSelectedId(item.id);
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

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

        onItemTrashed?.(item);

        notifications.show({
          title: 'Success',
          message: `"${item.name}" (${formatBytes(item.size)}) was successfully moved to Trash.`,
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
        minHeight: 0,
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
        ref={mergedViewportRef}
        className="item-list"
        role="list"
        aria-label="Files and folders"
        tabIndex={0}
        onKeyDown={handleKeyDown}
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

              const isSelected = item.id === selectedId;
              const itemColor = categoryColor(categoryOfItem(item.name, item.is_dir));

              return (
                <Group
                  key={item.id}
                  className="item-row"
                  role="listitem"
                  data-selected={isSelected || undefined}
                  justify="space-between"
                  wrap="nowrap"
                  onClick={() => {
                    setSelectedId(item.id);
                    if (item.is_dir) onNavigate(item.id);
                  }}
                  onContextMenu={(e) => openContextMenu(e, item)}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    padding: '0 12px',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: item.is_dir ? 'pointer' : 'default',
                    userSelect: 'none'
                  }}
                >
                  <Group gap="sm" wrap="nowrap" style={{ flex: 2, minWidth: 0 }}>
                    {
                      item.is_dir
                        ? <Folder color={itemColor} style={{ flexShrink: 0 }} />
                        : <File color={itemColor} style={{ flexShrink: 0 }} />
                    }
                    <Tooltip label="Click to open" disabled={!item.is_dir} openDelay={200}>
                      <Text size="sm" style={{ color: 'var(--text-main)' }} truncate>
                        {item.name}
                      </Text>
                    </Tooltip>
                  </Group>

                  {/* Actions column */}
                  <div
                    className="row-actions"
                    style={{ flex: '0 0 60px', display: 'flex', gap: '4px', justifyContent: 'flex-end' }}
                  >
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      style={{ color: 'var(--text-muted)' }}
                      tabIndex={isSelected ? 0 : -1}
                      title="Open in Files Explorer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenInExplorer(item);
                      }}
                    >
                      <FolderOpen />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red.5"
                      size="sm"
                      tabIndex={isSelected ? 0 : -1}
                      title="Move to Trash"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                    >
                      <Trash2 />
                    </ActionIcon>
                  </div>

                  <div style={{ flex: 1, padding: '0 16px', minWidth: '80px' }}>
                    <Progress.Root size="md" style={{ borderRadius: '4px' }}>
                      <Progress.Section value={itemPercentage} color={itemColor} />
                    </Progress.Root>
                  </div>

                  <Tooltip label="% of current folder" openDelay={200}>
                    <Text
                      size="sm"
                      ff="monospace"
                      style={{ flex: '0 0 56px', textAlign: 'right', color: 'var(--text-muted)' }}
                    >
                      {formatPercent(itemPercentage)}
                    </Text>
                  </Tooltip>

                  {/* File size column */}
                  <Text
                    size="sm"
                    ff="monospace"
                    style={{ flex: '0 0 90px', textAlign: 'right', color: 'var(--text-muted)' }}
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

      {/* Outside the translated rows, so the fixed position is relative to the window */}
      <Menu
        opened={menu !== null}
        onClose={() => {
          setMenu(null);
          viewportRef.current?.focus();
        }}
        position="bottom-start"
        shadow="md"
        transitionProps={{ duration: 0 }}
      >
        <Menu.Target>
          <div style={{ position: 'fixed', left: menu?.x ?? 0, top: menu?.y ?? 0, width: 0, height: 0 }} />
        </Menu.Target>
        <Menu.Dropdown>
          {menu?.item.is_dir && (
            <Menu.Item leftSection={<Folder />} onClick={() => onNavigate(menu.item.id)}>
              Open folder
            </Menu.Item>
          )}
          <Menu.Item leftSection={<FolderOpen />} onClick={() => handleOpenInExplorer(menu!.item)}>
            Open in Files Explorer
          </Menu.Item>
          <Menu.Item color="red" leftSection={<Trash2 />} onClick={() => handleDelete(menu!.item)}>
            Move to Trash
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
