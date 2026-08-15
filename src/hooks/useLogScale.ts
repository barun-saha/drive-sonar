import { useState, useMemo } from 'react';

export function useLogScale(maxValue: number) {
  const [useLogScale, setUseLogScale] = useState(false);

  // Compute dynamic ticks and domain whenever maxValue or toggle changes
  const { ticks, domain } = useMemo(() => {
    if (!useLogScale || maxValue < 0) {
      return {
        ticks: undefined,
        domain: ['auto', 'auto'] as const
      };
    }

    // Find upper power of 10 (e.g., max 350 MB -> log10 is ~2.54 -> ceil is 3 -> 10^3 = 1000)
    const maxPower = Math.max(1, Math.ceil(Math.log10(maxValue)));
    const calculatedTicks = Array.from(
      { length: maxPower + 1 },
      (_, i) => Math.pow(10, i)
    );
    const upperTick = calculatedTicks[calculatedTicks.length - 1];

    return {
      ticks: calculatedTicks,
      domain: [1, upperTick] as [number, number],
    };
  }, [maxValue, useLogScale]
  );

  // Helper to format axis labels dynamically
  const getAxisLabel = (baseLabel: string) =>
    useLogScale ? `${baseLabel} (Log Scale)` : baseLabel;

  // Return everything the consuming chart needs
  return {
    useLogScale,
    setUseLogScale,
    axisProps: {
      scale: useLogScale ? ('log' as const) : ('auto' as const),
      domain,
      ticks,
    },
    getAxisLabel,
  };
}
