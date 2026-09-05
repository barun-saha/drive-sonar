import { describe, expect, it } from 'vitest';
import { generateTextReport } from './exportReport';

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
      []
    );

    expect(report).toContain('Total Size : Unavailable');
    expect(report).toContain('Space Used : Unavailable');
    expect(report).toContain('Space Free : Unavailable');
    expect(report).toContain('Scan Time           : 0.00 seconds');
  });
});
