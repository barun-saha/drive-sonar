import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { cssVariablesResolver, theme } from './theme';
import { CATEGORY_ORDER } from './utils/fileCategory';
import { AGE_GROUPS } from './utils/ageGroup';

const tokens = cssVariablesResolver(mergeMantineTheme(DEFAULT_THEME, theme)) as Record<
  'variables' | 'light' | 'dark',
  Record<string, string>
>;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe.each(['light', 'dark'] as const)('%s theme tokens', (scheme) => {
  const t = tokens[scheme];

  it.each(['--text-main', '--text-muted', '--status-ok', '--status-warning', '--status-danger'])(
    '%s has WCAG AA contrast on both surfaces',
    (name) => {
      expect(contrast(t[name], t['--bg-main'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[name], t['--bg-panel'])).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each(AGE_GROUPS.map(({ group }) => `--age-${group}`))('%s is visible on the panel', (name) => {
    expect(contrast(t[name], t['--bg-panel'])).toBeGreaterThanOrEqual(3);
  });

  it.each(CATEGORY_ORDER.map((category) => `--cat-${category}`))(
    '%s is visible on the panel and under white treemap labels',
    (name) => {
      const color = tokens.variables[name];
      expect(contrast(color, t['--bg-panel'])).toBeGreaterThanOrEqual(3);
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(3);
    }
  );
});

describe('theme', () => {
  it('uses the brand palette with a different primary shade per mode', () => {
    expect(theme.primaryColor).toBe('brand');
    expect(theme.primaryShade).toEqual({ light: 6, dark: 4 });
    expect(theme.colors?.brand).toHaveLength(10);
  });

  it('lists the bundled fonts first, with system fonts as fallback', () => {
    expect(theme.fontFamily).toMatch(/^'Inter Variable', .*system-ui/);
    expect(theme.fontFamilyMonospace).toMatch(/^'JetBrains Mono Variable', .*monospace$/);
  });
});
