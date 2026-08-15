import { useState, useMemo } from 'react';

export function useLogScale(minValue: number, maxValue: number) {
  const [useLogScale, setUseLogScale] = useState(false);

  // Compute dynamic ticks and domain whenever minValue, maxValue or toggle changes
  const { ticks, domain } = useMemo(() => {
    if (!useLogScale || maxValue <= 0 || minValue <= 0) {
      return {
        ticks: undefined,
        domain: ['auto', 'auto'] as const
      };
    }

    // Find lower and upper powers of 10
    // E.g., min 0.5 MB -> log10 is ~-0.3 -> floor is -1 -> 10^-1 = 0.1
    // E.g., max 350 MB -> log10 is ~2.54 -> ceil is 3 -> 10^3 = 1000
    const minPower = Math.floor(Math.log10(minValue));
    const maxPower = Math.ceil(Math.log10(maxValue));

    const calculatedTicks = Array.from(
      { length: maxPower - minPower + 1 },
      (_, i) => Math.pow(10, minPower + i)
    );
    const lowerTick = calculatedTicks[0];
    const upperTick = calculatedTicks[calculatedTicks.length - 1];

    return {
      ticks: calculatedTicks,
      domain: [lowerTick, upperTick] as [number, number],
    };
  }, [minValue, maxValue, useLogScale]
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
