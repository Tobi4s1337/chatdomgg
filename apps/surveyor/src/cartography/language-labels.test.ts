import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import catalogue from './language-names-1.json';
import { LANGUAGE_NAMES, languageMapLabel, languageName, languageNames } from './language-labels';
import { regionTitle } from '../preview/build';

describe('reviewable language labels', () => {
  it('records its proposed review and covers ISO codes and Twitch extras', () => {
    expect(catalogue.review).toEqual({ status: 'proposed', proposedAt: '2026-11-01', reviewedBy: null, reviewedAt: null });
    expect(catalogue.basis.iso6391Count).toBe(184);
    const codes = Object.keys(LANGUAGE_NAMES.names);
    expect(codes).toHaveLength(187);
    expect(codes.filter(code => /^[a-z]{2}$/.test(code))).toHaveLength(184);
    expect(codes.filter(code => !/^[a-z]{2}$/.test(code)).sort()).toEqual(['asl', 'other', 'zh-hk']);
    const twitch = 'ar bg ca cs da de el en es fi fr he hi hu id it ja ko ms nl no pl pt ro ru sk sv th tl tr uk vi zh zh-hk asl other'.split(' ');
    expect(twitch).toHaveLength(36);
    for (const code of twitch) expect(languageName(code).label, code).not.toBe('Unlisted language');
    for (const code of twitch.filter(code => code !== 'zh-hk')) expect(LANGUAGE_NAMES.names[code], code).toBeDefined();
  });
  it('names special and unknown languages honestly', () => {
    expect(languageName('zh-hk').label).toBe('Cantonese');
    expect(languageName('asl').label).toBe('American Sign Language');
    expect(languageName('other').label).toBe('Other languages');
    expect(languageName('xx-bogus').label).toBe('Unlisted language');
    expect(languageMapLabel('ru')).toBe('Streams in\nRussian');
    expect(languageMapLabel('uk')).toBe('Streams in\nUkrainian');
  });
  it('resolves service names and raw region titles without runtime locale data', () => {
    const broken = vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => { throw new Error('locale data unavailable'); });
    try {
      expect(languageNames('UK')).toEqual({ name: 'Ukrainian', englishName: 'Ukrainian' });
      expect(regionTitle({ language: 'uk' } as Parameters<typeof regionTitle>[0])).toEqual({ name: 'uk', englishName: 'uk' });
    } finally { broken.mockRestore(); }
  });
  it('keeps locale lookups out of production Atlas and Surveyor source', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.includes('.test.') ? [join(dir, entry.name)] : []);
    for (const file of [...files(fileURLToPath(new URL('../', import.meta.url))), ...files(fileURLToPath(new URL('../../../web/src/atlas/', import.meta.url)))]) expect(readFileSync(file, 'utf8'), file).not.toMatch(/Intl\.DisplayNames/);
  });
});
