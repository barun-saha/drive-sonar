import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import { DEFAULT_LANGUAGE, resolveLanguage, type LanguageCode, type LanguageSetting } from './languages';

// English ships in the main bundle (source of truth and fallback); every other language and its font load on demand.
const localeLoaders = import.meta.glob<{ default: Record<string, unknown> }>(['./locales/*.json', '!./locales/en.json']);
const fontLoaders = import.meta.glob<unknown>('./fonts/*.css');

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  react: { useSuspense: false },
});

let latestRequest = 0;

/**
 * Loads the language's strings and font if needed, then switches the UI and `<html lang>` (CSS keys off it).
 * Resolves to the language now showing, or `null` when a newer request arrived while this one was loading: the newest
 * selection always wins, so a slow load can never switch the UI back after the user has picked something else.
 * Rejects if the language cannot be loaded (unless a newer request has replaced it, which resolves to `null`); the UI
 * is then left unchanged.
 */
export async function applyLanguage(setting: LanguageSetting): Promise<LanguageCode | null> {
  const request = ++latestRequest;
  const code = resolveLanguage(setting);

  if (code !== DEFAULT_LANGUAGE) {
    try {
      if (!i18n.hasResourceBundle(code, 'translation')) {
        const loadStrings = localeLoaders[`./locales/${code}.json`];
        if (loadStrings) i18n.addResourceBundle(code, 'translation', (await loadStrings()).default);
      }
      // A missing font file only means falling back to system fonts, so it must not block the switch
      await fontLoaders[`./fonts/${code}.css`]?.().catch(() => undefined);
    } catch (error) {
      // A failure belonging to a request the user has already replaced is not worth reporting
      if (request !== latestRequest) return null;
      throw error;
    }
  }

  if (request !== latestRequest) return null;

  await i18n.changeLanguage(code);
  document.documentElement.lang = code;
  return code;
}

/** Number formatting in the active language, always with Latin digits so numbers match the byte sizes. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(`${i18n.language}-u-nu-latn`, options);
}

/** A fixed number of decimals in the active language's separator (1.5 -> "1,50" in German), never grouped. */
export function formatDecimal(value: number, fractionDigits: number): string {
  return formatNumber(value, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits, useGrouping: false });
}

/**
 * Splits a translated sentence around a slot, so a value that must not be parsed (a file name) can be rendered as its
 * own element. Translators keep the placeholder wherever the word order needs it.
 */
const SLOT = '\u0001';
export function translateAroundSlot(key: string, options: Record<string, unknown> = {}): [before: string, after: string] {
  const [before = '', after = ''] = i18n.t(key, { ...options, name: SLOT }).split(SLOT);
  return [before, after];
}

export default i18n;
