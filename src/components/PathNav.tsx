import { useMemo } from "react";
import { Anchor, Breadcrumbs, Text, Tooltip } from "@mantine/core";
import { ChevronRight } from 'lucide-react';

import { BreadcrumbItem } from '../types';

interface PathNavProps {
  ancestors: BreadcrumbItem[];
  onNavigate: (nodeId: number) => void;
  onRescan?: (path: string) => void;
  isWindows?: boolean;
}

interface RenderItem {
  key: string;
  label: string;
  nodeId?: number;
  fullPath?: string;
  isUnscanned: boolean;
  isLast: boolean;
}

export function PathNav({ ancestors, onNavigate, onRescan, isWindows }: PathNavProps) {
  const items = useMemo(() => {
    if (!ancestors || ancestors.length === 0) return [];

    const result: RenderItem[] = [];
    const rootNode = ancestors[0];
    const isWin = isWindows ?? (/^[a-zA-Z]:/.test(rootNode.name) || rootNode.name.includes('\\'));

    // 1. Split the root path string into individual directory segments
    const isPOSIXRooted = !isWin && rootNode.name.startsWith('/');
    const isUNCPath = isWin && /^\\\\/.test(rootNode.name);
    const rootPathParts = rootNode.name.split(/[\\/]/).filter(Boolean);

    if (rootPathParts.length > 0) {
      let accumulated = '';

      // For POSIX absolute paths, add a breadcrumb for the root "/" before processing parts
      if (isPOSIXRooted) {
        result.push({
          key: 'unscanned-posix-root',
          label: '/',
          fullPath: '/',
          isUnscanned: true,
          isLast: false,
        });
      }

      rootPathParts.forEach((part, index) => {
        const isScanRootFolder = index === rootPathParts.length - 1;

        if (isWin && index === 0) {
          if (part.endsWith(':')) {
            accumulated = `${part}\\`;
          } else if (isUNCPath) {
            accumulated = `\\\\${part}`;
          } else {
            accumulated = part;
          }
        } else {
          accumulated = isWin
            ? accumulated.endsWith('\\')
              ? `${accumulated}${part}`
              : `${accumulated}\\${part}`
            : `${accumulated}/${part}`;
        }

        if (isScanRootFolder) {
          // The leaf directory of the scanned root corresponds to Node ID 0 in memory
          result.push({
            key: `node-${rootNode.id}`,
            label: part,
            nodeId: rootNode.id,
            isUnscanned: false,
            isLast: false,
          });
        } else {
          // Unscanned parent folders outside the current memory tree
          result.push({
            key: `unscanned-${accumulated}`,
            label: part,
            fullPath: accumulated,
            isUnscanned: true,
            isLast: false,
          });
        }
      });
    } else {
      // Fallback if root path is empty
      result.push({
        key: `node-${rootNode.id}`,
        label: rootNode.name,
        nodeId: rootNode.id,
        isUnscanned: false,
        isLast: false,
      });
    }

    // 2. Append in-memory child ancestors (from index 1 onwards)
    for (let i = 1; i < ancestors.length; i++) {
      const node = ancestors[i];
      result.push({
        key: `node-${node.id}`,
        label: node.name,
        nodeId: node.id,
        isUnscanned: false,
        isLast: false,
      });
    }

    if (result.length > 0) {
      result[result.length - 1].isLast = true;
    }

    return result;
  }, [ancestors, isWindows]);

  if (items.length === 0) return null;

  return (
    <Breadcrumbs
      separator={<ChevronRight size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />}
      style={{ flexWrap: 'wrap', rowGap: 4 }}
    >
      {items.map((item) => {
        if (item.isLast) {
          return (
            <Text key={item.key} size="sm" fw={600} style={{ color: 'var(--text-main)' }}>
              {item.label}
            </Text>
          );
        }

        if (item.isUnscanned) {
          return (
            <Tooltip
              key={item.key}
              label={`Scan ${item.fullPath}`}
              position="bottom"
              withArrow
              openDelay={300}
              >
              <Anchor
                component="button"
                type="button"
                size="sm"
                underline="hover"
                c="dimmed"
                onClick={() => item.fullPath && onRescan?.(item.fullPath)}
              >
                {item.label}
              </Anchor>
            </Tooltip>
          );
        }

        return (
          <Anchor
            key={item.key}
            component="button"
            type="button"
            size="sm"
            underline="hover"
            onClick={() => item.nodeId !== undefined && onNavigate(item.nodeId)}
          >
            {item.label}
          </Anchor>
        );
      })}
    </Breadcrumbs>
  );
}
