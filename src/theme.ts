import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';
import type { AgeGroup } from './utils/ageGroup';
import type { FileCategory } from './utils/fileCategory';

// The website's blue. Light mode uses shade 6 and dark mode shade 4 (see primaryShade below).
const brand: MantineColorsTuple = [
  '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa',
  '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
];

const FONT_SANS = "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 4 },
  autoContrast: true,
  colors: { brand },
  fontFamily: FONT_SANS,
  fontFamilyMonospace: FONT_MONO,
  defaultRadius: 'md',
  headings: { fontWeight: '600' },
});

// File categories are mid-tones, readable on both the light and dark panels and under white treemap labels.
const categoryColors: Record<FileCategory, string> = {
  folder: '#1a85c8',
  media: '#d55e00',
  documents: '#009e73',
  archives: '#cc79a7',
  code: '#b58900',
  installers: '#7b61c9',
  other: '#6b7280',
};

const ageColors: Record<AgeGroup, { light: string; dark: string }> = {
  recent: { light: '#2563eb', dark: '#60a5fa' },
  aging: { light: '#b45309', dark: '#fbbf24' },
  old: { light: '#be123c', dark: '#fb7185' },
};

const lightTokens = {
  '--bg-main': '#eef2f7',
  '--bg-panel': '#ffffff',
  '--bg-raised': '#e2e8f0',
  '--border-color': '#cbd5e1',
  '--text-main': '#0f172a',
  '--text-muted': '#475569',
  '--status-ok': '#166534',
  '--status-warning': '#92400e',
  '--status-danger': '#b91c1c',
  '--age-recent': ageColors.recent.light,
  '--age-aging': ageColors.aging.light,
  '--age-old': ageColors.old.light,
};

const darkTokens = {
  '--bg-main': '#0a1020',
  '--bg-panel': '#111a2e',
  '--bg-raised': '#1c2740',
  '--border-color': '#2a3650',
  '--text-main': '#f1f5f9',
  '--text-muted': '#94a3b8',
  '--status-ok': '#4ade80',
  '--status-warning': '#fbbf24',
  '--status-danger': '#f87171',
  '--age-recent': ageColors.recent.dark,
  '--age-aging': ageColors.aging.dark,
  '--age-old': ageColors.old.dark,
};

// Points Mantine's own surfaces, text and borders at the tokens above
const mantineSurfaces = {
  '--mantine-color-body': 'var(--bg-panel)',
  '--mantine-color-text': 'var(--text-main)',
  '--mantine-color-dimmed': 'var(--text-muted)',
  '--mantine-color-default': 'var(--bg-panel)',
  '--mantine-color-default-hover': 'var(--bg-raised)',
  '--mantine-color-default-border': 'var(--border-color)',
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: Object.fromEntries(Object.entries(categoryColors).map(([name, color]) => [`--cat-${name}`, color])),
  light: { ...lightTokens, ...mantineSurfaces },
  dark: { ...darkTokens, ...mantineSurfaces },
});
