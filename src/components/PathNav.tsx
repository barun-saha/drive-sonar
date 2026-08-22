import { useMemo } from "react";
import { Anchor, Breadcrumbs, Text } from "@mantine/core";
import { ChevronRight } from 'lucide-react';

interface PathNavProps {
  currentPath: string;
  parentId: number | null;
  onNavigate: (nodeId: number) => void;
  isWindows?: boolean; // Optional
}

interface PathSegment {
  label: string;
  path: string;
}

export function PathNav({ currentPath, parentId, onNavigate, isWindows }: PathNavProps) {
  const isWin = isWindows ?? (/^[a-zA-Z]:/.test(currentPath) || currentPath.includes('\\'));
  // Reconstruct path segments with their accumulated full paths
  const segments = useMemo(() => {
    if (!currentPath) return [];

    const parts = currentPath.split(/[\\/]/).filter(Boolean);
    const result: PathSegment[] = [];
    let accumulated = '';

    parts.forEach((part, index) => {
      if (isWin && index === 0) {
        // Windows drive root (e.g. 'C:' -> 'C:\')
        accumulated = part.endsWith(':') ? `${part}\\` : part;
      } else {
        if (isWin) {
          accumulated = accumulated.endsWith('\\')
            ? `${accumulated}${part}`
            : `${accumulated}\\${part}`;
        } else {
          accumulated = `${accumulated}/${part}`;
        }
      }

      result.push({ label: part, path: accumulated });
    });

    return result;
  }, [currentPath, isWin]);

  return (
    <Breadcrumbs
      separator={<ChevronRight size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />}
      style={{ flexWrap: 'wrap', rowGap: 4 }}
    >
      {segments.map((seg, index) => {
        const isLast = index === segments.length - 1;
        const isParent = index === segments.length - 2;

        if (isLast) {
          return (
            <Text key={seg.path} size="sm" fw={600} style={{ color: 'var(--text-main)' }}>
              {seg.label}
            </Text>
          );
        }

        if (isParent && parentId !== null) {
          return (
            <Anchor
              key={seg.path}
              component="button"
              type="button"
              size="sm"
              underline="hover"
              onClick={() => onNavigate(parentId)}
            >
              {seg.label}
            </Anchor>
          );
        }

        return (
          <Text key={seg.path} size="sm" c="dimmed">
            {seg.label}
          </Text>
        );
      })}
    </Breadcrumbs>
  );
}
