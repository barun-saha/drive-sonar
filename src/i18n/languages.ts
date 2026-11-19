/** Languages the UI is translated into. Each is listed under its own name so it can be found in any UI language. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

/** What the user picks in the menu: a language, or "follow the operating system" */
export type LanguageSetting = LanguageCode | 'system';

export const DEFAULT_LANGUAGE: LanguageCode = 'en';
export const LANGUAGE_STORAGE_KEY = 'drive-sonar-language';

export function isLanguageCode(value: unknown): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

/** Picks the supported language that matches the OS/webview locale (e.g. "bn-IN" -> "bn"), else English. */
export function resolveSystemLanguage(locales: readonly string[] = navigator.languages ?? [navigator.language]): LanguageCode {
  for (const locale of locales) {
    const base = locale.toLowerCase().split('-')[0];
    if (isLanguageCode(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export function resolveLanguage(setting: LanguageSetting): LanguageCode {
  return setting === 'system' ? resolveSystemLanguage() : setting;
}

/** Parses a stored choice (written as JSON by useLocalStorage); anything unrecognised means "system". */
export function parseLanguageSetting(stored?: string | null): LanguageSetting {
  try {
    const parsed = JSON.parse(stored ?? '');
    if (parsed === 'system' || isLanguageCode(parsed)) return parsed;
  } catch {
    // Missing or malformed
  }
  return 'system';
}

export function readStoredLanguageSetting(): LanguageSetting {
  try {
    return parseLanguageSetting(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return 'system'; // Storage unavailable
  }
}
