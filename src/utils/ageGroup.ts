export type AgeGroup = 'recent' | 'aging' | 'old';

/** Age thresholds in months: recent is up to 6, aging is 6 to 24, old is above 24 */
export const RECENT_MAX_MONTHS = 6;
export const AGING_MAX_MONTHS = 24;

export const AGE_GROUPS: { group: AgeGroup; label: string }[] = [
  { group: 'recent', label: `Recent (≤ ${RECENT_MAX_MONTHS} mo)` },
  { group: 'aging', label: `Aging (${RECENT_MAX_MONTHS}–${AGING_MAX_MONTHS} mo)` },
  { group: 'old', label: `Old (> ${AGING_MAX_MONTHS} mo)` },
];

export function getAgeGroup(ageMonths: number): AgeGroup {
  if (ageMonths <= RECENT_MAX_MONTHS) return 'recent';
  if (ageMonths <= AGING_MAX_MONTHS) return 'aging';
  return 'old';
}

/** CSS variable defined by the theme, so it follows the light/dark scheme */
export function ageColor(group: AgeGroup): string {
  return `var(--age-${group})`;
}
