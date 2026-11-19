import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { applyLanguage, formatDecimal, formatNumber, translateAroundSlot } from './index';
import { formatBytes, formatPercent } from '../utils/format';
import { ageGroupLabel } from '../utils/ageGroup';

afterEach(async () => {
  await applyLanguage('en');
  vi.restoreAllMocks();
});

describe('applyLanguage', () => {
  it('loads a language on demand, switches the UI and sets <html lang>', async () => {
    expect(i18n.hasResourceBundle('bn', 'translation')).toBe(false);

    await expect(applyLanguage('bn')).resolves.toBe('bn');

    expect(i18n.language).toBe('bn');
    expect(document.documentElement.lang).toBe('bn');
    expect(i18n.t('toolbar.runScan')).toBe('স্ক্যান শুরু করুন');
  });

  it.each([['hi', 'स्कैन शुरू करें'], ['es', 'Iniciar escaneo'], ['de', 'Scan starten']] as const)(
    'switches to %s',
    async (code, runScan) => {
      await applyLanguage(code);
      expect(i18n.t('toolbar.runScan')).toBe(runScan);
    },
  );

  it('switches back to English without loading anything', async () => {
    await applyLanguage('de');
    await applyLanguage('en');
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('toolbar.runScan')).toBe('Run Scan');
  });

  it('resolves "system" from the OS language', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-ES']);
    await expect(applyLanguage('system')).resolves.toBe('es');
    expect(document.documentElement.lang).toBe('es');
  });

  it('does not reload a language that is already loaded', async () => {
    await applyLanguage('de');
    const add = vi.spyOn(i18n, 'addResourceBundle');
    await applyLanguage('de');
    expect(add).not.toHaveBeenCalled();
  });

  it('keeps English text for a language that has no translation file', async () => {
    await applyLanguage('fr' as never);
    expect(i18n.t('toolbar.runScan')).toBe('Run Scan');
  });

  it('falls back to English strings for a key a language lacks', async () => {
    await applyLanguage('bn');
    i18n.addResourceBundle('en', 'translation', { test: { onlyEnglish: 'English only' } }, true);
    expect(i18n.t('test.onlyEnglish')).toBe('English only');
  });
});

describe('plural forms', () => {
  it('picks singular and plural per language', async () => {
    expect(i18n.t('toolbar.fileCount', { count: 1, n: '1' })).toBe('1 file');
    expect(i18n.t('toolbar.fileCount', { count: 3, n: '3' })).toBe('3 files');
    await applyLanguage('es');
    expect(i18n.t('toolbar.fileCount', { count: 1, n: '1' })).toBe('1 archivo');
    expect(i18n.t('toolbar.fileCount', { count: 1_000_000, n: '1,000,000' })).toBe('1,000,000 archivos');
    await applyLanguage('de');
    expect(i18n.t('toolbar.fileCount', { count: 2, n: '2' })).toBe('2 Dateien');
  });
});

describe('formatNumber', () => {
  it('formats in the active language, always with Latin digits', async () => {
    expect(formatNumber(1374220)).toBe('1,374,220');
    await applyLanguage('de');
    expect(formatNumber(1374220)).toBe('1.374.220');
    await applyLanguage('bn');
    expect(formatNumber(1374220)).toBe('13,74,220');
  });
});

describe('decimal separators', () => {
  it('uses the language\'s separator for sizes and percentages, with Latin digits and no grouping', async () => {
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
    expect(formatPercent(39.84)).toBe('39.8%');
    expect(formatPercent(0.04)).toBe('<0.1%');

    await applyLanguage('de');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,50 GB');
    expect(formatPercent(39.84)).toBe('39,8%');

    await applyLanguage('es');
    expect(formatBytes(96 * 1024 ** 3)).toBe('96,00 GB');

    await applyLanguage('bn');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
    await applyLanguage('hi');
    expect(formatPercent(18.8)).toBe('18.8%');
  });

  it('does not group digits, so a size below 1024 never gains a separator', () => {
    expect(formatDecimal(1023.99, 2)).toBe('1023.99');
  });

  it('rounds to the requested number of decimals', () => {
    expect(formatDecimal(2, 1)).toBe('2.0');
    expect(formatDecimal(0.126, 2)).toBe('0.13');
  });
});

describe('translateAroundSlot', () => {
  it('returns the text before and after the slot', () => {
    expect(translateAroundSlot('list.confirmFile')).toEqual([
      'Are you sure you want to move the file ',
      ' to the Trash?',
    ]);
  });

  it('keeps the slot wherever the language puts it', async () => {
    await applyLanguage('de');
    const [before, after] = translateAroundSlot('list.confirmFolder');
    expect(before).toBe('Möchtest du das Verzeichnis ');
    expect(after).toContain('Papierkorb');
  });

  it('never interpolates the caller-supplied name', () => {
    expect(translateAroundSlot('list.confirmFile', { name: '<b>evil</b>' }).join('')).not.toContain('evil');
  });
});

describe('localized helpers', () => {
  it('localizes the byte unit', async () => {
    expect(formatBytes(512)).toBe('512 Bytes');
    expect(formatBytes(0)).toBe('0 Bytes');
    await applyLanguage('bn');
    expect(formatBytes(512)).toBe('512 বাইট');
    expect(formatBytes(0)).toBe('0 বাইট');
    expect(formatBytes(2048)).toBe('2.00 KB');
  });

  it('localizes age group labels', async () => {
    expect(ageGroupLabel('recent')).toBe('Recent (≤ 6 mo)');
    expect(ageGroupLabel('aging')).toBe('Aging (6–24 mo)');
    expect(ageGroupLabel('old')).toBe('Old (> 24 mo)');
    await applyLanguage('de');
    expect(ageGroupLabel('old')).toBe('Alt (> 24 Mon.)');
  });
});
