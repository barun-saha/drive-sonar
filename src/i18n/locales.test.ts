import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import { LANGUAGES } from './languages';

type Tree = { [key: string]: string | Tree };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((flat, [key, value]) => {
    if (typeof value === 'string') flat[prefix + key] = value;
    else Object.assign(flat, flatten(value, `${prefix}${key}.`));
    return flat;
  }, {});
}

const placeholders = (text: string) => [...new Set(text.match(/\{\{\w+\}\}|<\/?b>/g) ?? [])].sort();
const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, '');

const source = flatten(en as Tree);
const sourceBases = new Set(Object.keys(source).map(baseKey));

const localeFiles = import.meta.glob<{ default: Tree }>(['./locales/*.json', '!./locales/en.json'], { eager: true });

describe('locale files', () => {
  it('has a file for every listed language', () => {
    const expected = LANGUAGES.map(({ code }) => code)
      .filter((code) => code !== 'en')
      .sort();
    const found = Object.keys(localeFiles)
      .map((path) => path.match(/\/(\w+)\.json$/)![1])
      .sort();
    expect(found).toEqual(expected);
  });

  describe.each(Object.entries(localeFiles))('%s', (path, module) => {
    const strings = flatten(module.default);

    it('translates exactly the same keys as English', () => {
      const bases = new Set(Object.keys(strings).map(baseKey));
      expect([...sourceBases].filter((key) => !bases.has(key))).toEqual([]); // missing
      expect([...bases].filter((key) => !sourceBases.has(key))).toEqual([]); // stray
    });

    it('keeps the placeholders and markup of the English string', () => {
      const sourceFor = (key: string) => source[key] ?? source[`${baseKey(key)}_other`];
      for (const [key, value] of Object.entries(strings)) {
        expect(placeholders(value), `${path}: ${key}`).toEqual(placeholders(sourceFor(key)));
      }
    });

    it('uses Latin digits only, since numbers stay Latin in every language', () => {
      // Bengali (U+09E6-09EF) and Devanagari (U+0966-096F) digits, which number formatting cannot convert
      const nonLatin = Object.entries(strings).filter(([, value]) => /[\u09E6-\u09EF\u0966-\u096F]/.test(value));
      expect(nonLatin, path).toEqual([]);
    });

    it('provides the "other" plural form for every counted string', () => {
      const counted = new Set(
        Object.keys(source)
          .filter((key) => PLURAL_SUFFIX.test(key))
          .map(baseKey),
      );
      for (const key of counted) expect(strings[`${key}_other`], `${path}: ${key}_other`).toBeTruthy();
    });
  });
});
