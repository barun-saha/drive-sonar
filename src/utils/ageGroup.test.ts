import { describe, it, expect } from 'vitest';
import { ageColor, getAgeGroup } from './ageGroup';

describe('getAgeGroup', () => {
  it.each([
    [0, 'recent'],
    [6, 'recent'],
    [6.1, 'aging'],
    [24, 'aging'],
    [24.1, 'old'],
    [120, 'old'],
  ])('puts %d months into %s', (months, group) => {
    expect(getAgeGroup(months)).toBe(group);
  });
});

describe('ageColor', () => {
  it('points at the theme variable for the group', () => {
    expect(ageColor('old')).toBe('var(--age-old)');
  });
});
