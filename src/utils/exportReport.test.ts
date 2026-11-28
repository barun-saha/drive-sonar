import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { generateTextReport, saveReportToTextFile } from './exportReport';
import type { KeyStats, TopFileNode } from '../types';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));

const stats: KeyStats = {
  scanPath: '/data',
  totalDriveBytes: 1000,
  totalDriveUsed: 600,
  totalDriveFree: 400,
  totalBytes: 2048,
  totalFiles: 12345,
  totalDirectories: 67,
  scanDurationMs: 1500,
};

const file = (id: number, name: string, size: number): TopFileNode => ({
  id,
  name,
  size,
  modified_secs: 0,
  path: `/data/${name}`,
});

describe('generateTextReport', () => {
  it('renders missing drive statistics as unavailable and includes a zero-duration scan', () => {
    const report = generateTextReport(
      {
        scanPath: '/tmp/example',
        totalBytes: 0,
        totalFiles: 0,
        totalDirectories: 0,
        scanDurationMs: 0,
      },
      [],
      [],
    );

    expect(report).toContain('Total Size : Unavailable');
    expect(report).toContain('Space Used : Unavailable');
    expect(report).toContain('Space Free : Unavailable');
    expect(report).toContain('Scan Time           : 0.00 seconds');
  });

  it('omits the scan time line when the duration is unknown', () => {
    const report = generateTextReport({ ...stats, scanDurationMs: undefined }, [], []);
    expect(report).not.toContain('Scan Time');
  });

  it('prints key statistics with thousands separators', () => {
    const report = generateTextReport(stats, [], []);
    expect(report).toContain('Scanned Target Path : /data');
    expect(report).toContain(`Files Count         : ${(12345).toLocaleString()}`);
    expect(report).toContain('Folders Count       : 67');
    expect(report).toContain('Scan Time           : 1.50 seconds');
  });

  it('shows placeholders when there are no directories or files', () => {
    const report = generateTextReport(stats, [], []);
    expect(report).toContain('No top-level directories recorded.');
    expect(report).toContain('No files found.');
    expect(report).toContain('END OF REPORT');
  });

  it('lists top-level directories and truncates long names', () => {
    const longName = 'a'.repeat(40);
    const report = generateTextReport(
      stats,
      [
        { name: 'docs', path: '/data/docs', size: 1024 },
        { name: longName, path: `/data/${longName}`, size: 10 },
      ],
      [],
    );
    expect(report).toContain('docs');
    expect(report).toContain('/data/docs');
    expect(report).toContain(`${'a'.repeat(25)}...`);
    expect(report).not.toContain(longName.padEnd(40, 'a') + '   ');
  });

  it('sorts files by size descending, ranks them, and truncates long names', () => {
    const longName = 'b'.repeat(40);
    const report = generateTextReport(
      stats,
      [],
      [file(1, 'small.txt', 10), file(2, longName, 5000), file(3, 'mid.txt', 100)],
    );
    const lines = report.split('\n');
    const rows = lines.filter((l) => /^\d+\.\s.*\/data\//.test(l));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(`${'b'.repeat(27)}...`);
    expect(rows[1]).toContain('mid.txt');
    expect(rows[2]).toContain('small.txt');
    expect(rows[0].startsWith('1.')).toBe(true);
  });

  it('limits the file listing to 30 entries without mutating the input', () => {
    const files = Array.from({ length: 35 }, (_, i) => file(i, `f${i}.bin`, i + 1));
    const copy = [...files];
    const report = generateTextReport(stats, [], files);
    expect(report.split('\n').filter((l) => /^\d+\.\s.*\/data\//.test(l))).toHaveLength(30);
    expect(files).toEqual(copy);
  });
});

describe('saveReportToTextFile', () => {
  beforeEach(() => {
    vi.mocked(save).mockReset();
    vi.mocked(writeTextFile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the report to the chosen path and returns true', async () => {
    vi.mocked(save).mockResolvedValue('/out/report.txt');
    vi.mocked(writeTextFile).mockResolvedValue(undefined);

    await expect(saveReportToTextFile(stats, [], [])).resolves.toBe(true);

    const opts = vi.mocked(save).mock.calls[0][0];
    expect(opts?.defaultPath).toMatch(/^scan-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.txt$/);
    expect(opts?.filters).toEqual([{ name: 'Text Document', extensions: ['txt'] }]);
    expect(writeTextFile).toHaveBeenCalledWith('/out/report.txt', expect.stringContaining('DRIVE SONAR DISK SCAN'));
  });

  it('returns false and writes nothing when the dialog is cancelled', async () => {
    vi.mocked(save).mockResolvedValue(null);
    await expect(saveReportToTextFile(stats, [], [])).resolves.toBe(false);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it('falls back to a browser download when saving fails', async () => {
    vi.mocked(save).mockRejectedValue(new Error('not in tauri'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(saveReportToTextFile(stats, [], [])).resolves.toBe(false);

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
  });
});
