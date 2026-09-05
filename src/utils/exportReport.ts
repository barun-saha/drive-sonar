import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { formatBytes } from './format';
import { KeyStats, TopFileNode, DirNode } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export function generateTextReport(
  stats: KeyStats,
  topLevelDirs: DirNode[],
  top30Files: TopFileNode[]
): string {
  const now = new Date();
  // 05-Sep-2026
  const dateStr = [
    String(now.getDate()).padStart(2, '0'),
    now.toLocaleString('en-US', { month: 'short' }),
    now.getFullYear()
  ].join('-');
  const timeStr = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join(':');

  const divider = '='.repeat(84);
  const subDivider = '-'.repeat(84);
  const lines: string[] = [];

  // Title Header
  lines.push(divider);
  lines.push('                        DRIVE SONAR DISK SCAN SUMMARY REPORT');
  lines.push(`\nGenerated On: ${dateStr} ${timeStr}`);
  lines.push(divider);
  lines.push('');

  // Section 1: Drive Stats
  lines.push('1. DRIVE STATISTICS');
  lines.push(subDivider);
  lines.push(`Total Size : ${formatBytes(stats.totalDriveBytes)}`);
  lines.push(`Space Used : ${formatBytes(stats.totalDriveUsed)}`);
  lines.push(`Space Free : ${formatBytes(stats.totalDriveFree)}`);
  lines.push('');

  // Section 2: Key Stats
  lines.push('2. KEY STATISTICS');
  lines.push(subDivider);
  lines.push(`Scanned Target Path : ${stats.scanPath}`);
  lines.push(`Target Path Size    : ${formatBytes(stats.totalBytes)}`);
  lines.push(`Files Count         : ${stats.totalFiles.toLocaleString()}`);
  lines.push(`Folders Count       : ${stats.totalDirectories.toLocaleString()}`);
  if (stats.scanDurationMs) {
    lines.push(`Scan Time           : ${(stats.scanDurationMs / 1000).toFixed(2)} seconds`);
  }
  lines.push('');

  // Section 3: Top Level Directories
  lines.push('3. TOP-LEVEL DIRECTORIES LISTING');
  lines.push(subDivider);
  lines.push(`${'FOLDER NAME'.padEnd(30)} ${'SIZE'.padStart(12)}   ${'PATH'}`);
  lines.push(subDivider);

  if (!topLevelDirs || topLevelDirs.length === 0) {
    lines.push('No top-level directories recorded.');
  } else {
    topLevelDirs.forEach((dir) => {
      const name = dir.name.length > 28 ? dir.name.substring(0, 25) + '...' : dir.name;
      const sizeStr = formatBytes(dir.size).padStart(12);
      lines.push(`${name.padEnd(30)} ${sizeStr}   ${dir.path}`);
    });
  }
  lines.push('');

  // Section 4: Top 30 Largest Files
  lines.push('4. TOP 30 LARGEST FILES (RECURSIVE)');
  lines.push(subDivider);
  lines.push(`${'#'.padEnd(4)} ${'FILE NAME'.padEnd(32)} ${'SIZE'.padStart(12)}   ${'PATH'}`);
  lines.push(subDivider);

  const sortedFiles = [...top30Files].sort((a, b) => b.size - a.size).slice(0, 30);

  if (sortedFiles.length === 0) {
    lines.push('No files found.');
  } else {
    sortedFiles.forEach((file, index) => {
      const rank = `${index + 1}.`.padEnd(4);
      const name = file.name.length > 30 ? file.name.substring(0, 27) + '...' : file.name;
      const sizeStr = formatBytes(file.size).padStart(12);
      lines.push(`${rank} ${name.padEnd(32)} ${sizeStr}   ${file.path}`);
    });
  }

  lines.push('');
  lines.push(divider);
  lines.push('END OF REPORT');
  lines.push(divider);

  return lines.join('\n');
}

/**
 * Prompts user with save dialog and writes the report file
 */
export async function saveReportToTextFile(
  stats: KeyStats,
  topLevelDirs: DirNode[],
  top30Files: TopFileNode[]
) {
  const content = generateTextReport(stats, topLevelDirs, top30Files);

  try {
    const now = new Date();

    // Result: scan-report-2026-09-05-15-33-26.txt
    const dateStr = [
      now.getFullYear(),
      pad(now.getMonth() + 1), // Months are 0-indexed
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('-');
    const filePath = await save({
      title: 'Save Scan Report',
      defaultPath: `scan-report-${dateStr}.txt`,
      filters: [{ name: 'Text Document', extensions: ['txt'] }],
    });

    if (filePath) {
      await writeTextFile(filePath, content);
      return true;
    }
  } catch (err) {
    console.error('Tauri FS Save Error, falling back to browser download:', err);

    // Browser fallback for local testing outside Tauri webview
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drive-sonar-scan-report_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return false;
}
