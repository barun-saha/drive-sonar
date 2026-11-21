import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_STORAGE_KEY, isLanguageCode, parseLanguageSetting, readStoredLanguageSetting, resolveLanguage,
  resolveSystemLanguage,
} from './languages';

describe('isLanguageCode', () => {
  it('accepts supported languages only', () => {
    expect(isLanguageCode('bn')).toBe(true);
    expect(isLanguageCode('system')).toBe(false);
    expect(isLanguageCode('fr')).toBe(false);
    expect(isLanguageCode(undefined)).toBe(false);
  });
});

describe('resolveSystemLanguage', () => {
  it('matches the base language of a regional locale', () => {
    expect(resolveSystemLanguage(['bn-IN'])).toBe('bn');
    expect(resolveSystemLanguage(['de-AT'])).toBe('de');
    expect(resolveSystemLanguage(['ES'])).toBe('es');
  });

  it('uses the first supported language in the preference list', () => {
    expect(resolveSystemLanguage(['fr-FR', 'hi-IN', 'en-US'])).toBe('hi');
  });

  it('falls back to English when nothing matches or the list is empty', () => {
    expect(resolveSystemLanguage(['fr-FR', 'ja'])).toBe('en');
    expect(resolveSystemLanguage([])).toBe('en');
  });

  it('reads the webview languages by default', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['hi-IN']);
    expect(resolveSystemLanguage()).toBe('hi');
    vi.restoreAllMocks();
  });

  it('falls back to navigator.language when languages is unavailable', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(undefined as unknown as readonly string[]);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-MX');
    expect(resolveSystemLanguage()).toBe('es');
    vi.restoreAllMocks();
  });
});

describe('resolveLanguage', () => {
  it('returns an explicit choice unchanged and resolves "system" from the OS', () => {
    expect(resolveLanguage('de')).toBe('de');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['bn']);
    expect(resolveLanguage('system')).toBe('bn');
    vi.restoreAllMocks();
  });
});

describe('parseLanguageSetting', () => {
  it('parses stored JSON for a language or "system"', () => {
    expect(parseLanguageSetting('"bn"')).toBe('bn');
    expect(parseLanguageSetting('"system"')).toBe('system');
  });

  it.each([undefined, null, '', 'bn', '"fr"', '42', '{'])('treats %j as "system"', (stored) => {
    expect(parseLanguageSetting(stored as string | null | undefined)).toBe('system');
  });
});

describe('readStoredLanguageSetting', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads the saved choice', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, '"hi"');
    expect(readStoredLanguageSetting()).toBe('hi');
  });

  it('defaults to "system" when nothing is saved', () => {
    expect(readStoredLanguageSetting()).toBe('system');
  });

  it('defaults to "system" when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredLanguageSetting()).toBe('system');
  });
});
