import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useLogScale } from './useLogScale';

describe('useLogScale', () => {
  it('initializes with default linear scale properties', () => {
    const { result } = renderHook(() => useLogScale(1, 100));

    expect(result.current.useLogScale).toBe(false);
    expect(result.current.axisProps).toEqual({
      scale: 'auto',
      domain: [0, 'auto'],
      ticks: undefined,
    });
    expect(result.current.getAxisLabel('Bytes')).toBe('Bytes');
  });

  it('computes 1-2-5 log scale ticks starting one tick below the smallest value', () => {
    const { result } = renderHook(() => useLogScale(2, 500));

    act(() => {
      result.current.setUseLogScale(true);
    });

    expect(result.current.useLogScale).toBe(true);
    expect(result.current.axisProps.scale).toBe('log');
    expect(result.current.axisProps.ticks).toEqual([1, 2, 5, 10, 20, 50, 100, 200, 500]);
    expect(result.current.axisProps.domain).toEqual([1, 500]);
    expect(result.current.getAxisLabel('Bytes')).toBe('Bytes (Log Scale)');
  });

  it('keeps the log domain tight around the data without a blank band', () => {
    const { result } = renderHook(() => useLogScale(12, 350));

    act(() => {
      result.current.setUseLogScale(true);
    });

    expect(result.current.axisProps.domain).toEqual([10, 500]);
    expect(result.current.axisProps.ticks).toEqual([10, 20, 50, 100, 200, 500]);
  });

  it('handles fractional values without floating point noise', () => {
    const { result } = renderHook(() => useLogScale(0.03, 0.4));

    act(() => {
      result.current.setUseLogScale(true);
    });

    expect(result.current.axisProps.ticks).toEqual([0.02, 0.05, 0.1, 0.2, 0.5]);
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
