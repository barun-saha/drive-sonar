import { useState, useMemo } from 'react';

export function useLogScale(minValue: number, maxValue: number) {
  const [useLogScale, setUseLogScale] = useState(false);

  // Compute dynamic ticks and domain whenever minValue, maxValue or toggle changes
  const { ticks, domain } = useMemo(() => {
    if (!useLogScale) {
      return {
        ticks: undefined,
        domain: [0, 'auto'] as [number, 'auto']
      };
    }

    if (maxValue <= 0 || minValue <= 0) {
      return {
        ticks: undefined,
        domain: ['auto', 'auto'] as const
      };
    }

    // 1-2-5 ticks (1, 2, 5, 10, 20, 50, ...) keep the domain close to the data.
    // E.g., min 12 MB -> lower tick 10, max 350 MB -> upper tick 500
    const minPower = Math.floor(Math.log10(minValue)) - 1;
    const maxPower = Math.ceil(Math.log10(maxValue));

    const steps: number[] = [];
    for (let power = minPower; power <= maxPower; power++) {
      for (const multiplier of [1, 2, 5]) {
        steps.push(Number((multiplier * Math.pow(10, power)).toPrecision(12)));
      }
    }

    // Start one tick below the smallest value so its mark or bar stays visible
    const lowerTick = Math.max(...steps.filter((step) => step < minValue));
    const upperTick = Math.min(...steps.filter((step) => step >= maxValue));

    return {
      ticks: steps.filter((step) => step >= lowerTick && step <= upperTick),
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
