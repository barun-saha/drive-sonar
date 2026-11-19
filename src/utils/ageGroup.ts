import i18n from '../i18n';

export type AgeGroup = 'recent' | 'aging' | 'old';

/** Age thresholds in months: recent is up to 6, aging is 6 to 24, old is above 24 */
export const RECENT_MAX_MONTHS = 6;
export const AGING_MAX_MONTHS = 24;

export const AGE_GROUPS: { group: AgeGroup }[] = [{ group: 'recent' }, { group: 'aging' }, { group: 'old' }];

/** Label in the active language, e.g. "Recent (≤ 6 mo)" */
export function ageGroupLabel(group: AgeGroup): string {
  return i18n.t(`age.${group}`, { recent: RECENT_MAX_MONTHS, aging: AGING_MAX_MONTHS });
}

export function getAgeGroup(ageMonths: number): AgeGroup {
  if (ageMonths <= RECENT_MAX_MONTHS) return 'recent';
  if (ageMonths <= AGING_MAX_MONTHS) return 'aging';
  return 'old';
}

/** CSS variable defined by the theme, so it follows the light/dark scheme */
export function ageColor(group: AgeGroup): string {
  return `var(--age-${group})`;
}
