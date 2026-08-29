import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useLogScale } from './useLogScale';

describe('useLogScale', () => {
  it('initializes with default linear scale properties', () => {
    const { result } = renderHook(() => useLogScale(1, 100));

    expect(result.current.useLogScale).toBe(false);
    expect(result.current.axisProps).toEqual({
      scale: 'auto',
      domain: ['auto', 'auto'],
      ticks: undefined,
    });
    expect(result.current.getAxisLabel('Bytes')).toBe('Bytes');
  });

  it('computes log scale ticks and domain when enabled with positive values', () => {
    const { result } = renderHook(() => useLogScale(2, 500));

    act(() => {
      result.current.setUseLogScale(true);
    });

    expect(result.current.useLogScale).toBe(true);
    // min 2 -> minPower = floor(log10(2)) = 0 -> 10^0 = 1
    // max 500 -> maxPower = ceil(log10(500)) = 3 -> 10^3 = 1000
    expect(result.current.axisProps.scale).toBe('log');
    expect(result.current.axisProps.ticks).toEqual([1, 10, 100, 1000]);
    expect(result.current.axisProps.domain).toEqual([1, 1000]);
    expect(result.current.getAxisLabel('Bytes')).toBe('Bytes (Log Scale)');
  });

  it('handles non-positive minValue or maxValue gracefully when log scale is enabled', () => {
    const { result: resZero } = renderHook(() => useLogScale(0, 100));

    act(() => {
      resZero.current.setUseLogScale(true);
    });

    expect(resZero.current.axisProps.scale).toBe('log');
    expect(resZero.current.axisProps.ticks).toBeUndefined();
    expect(resZero.current.axisProps.domain).toEqual(['auto', 'auto']);

    const { result: resNeg } = renderHook(() => useLogScale(10, -5));

    act(() => {
      resNeg.current.setUseLogScale(true);
    });

    expect(resNeg.current.axisProps.ticks).toBeUndefined();
    expect(resNeg.current.axisProps.domain).toEqual(['auto', 'auto']);
  });
});
