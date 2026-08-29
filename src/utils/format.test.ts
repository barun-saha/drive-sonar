import { describe, it, expect } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('handles invalid, zero, or negative numbers correctly', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(0, true)).toBe('0 B');
    expect(formatBytes(-100)).toBe('0 Bytes');
    expect(formatBytes(-100, true)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 Bytes');
    expect(formatBytes(Infinity)).toBe('0 Bytes');
    expect(formatBytes(-Infinity)).toBe('0 Bytes');
  });

  it('formats byte values accurately for default units', () => {
    expect(formatBytes(1)).toBe('1 Bytes');
    expect(formatBytes(500)).toBe('500 Bytes');
    expect(formatBytes(1023)).toBe('1023 Bytes');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(1073741824)).toBe('1.00 GB');
    expect(formatBytes(1099511627776)).toBe('1.00 TB');
    expect(formatBytes(1125899906842624)).toBe('1.00 PB');
    expect(formatBytes(1152921504606846976)).toBe('1.00 EB');
  });

  it('formats byte values accurately with short units', () => {
    expect(formatBytes(1, true)).toBe('1 B');
    expect(formatBytes(500, true)).toBe('500 B');
    expect(formatBytes(1024, true)).toBe('1.00 KB');
    expect(formatBytes(1048576, true)).toBe('1.00 MB');
    expect(formatBytes(1073741824, true)).toBe('1.00 GB');
  });

  it('handles values larger than EB by using the highest available unit', () => {
    const hugeValue = Math.pow(1024, 7); // 1024 EB
    expect(formatBytes(hugeValue)).toBe('1024.00 EB');
  });
});
