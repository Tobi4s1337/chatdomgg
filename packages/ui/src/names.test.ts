import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyName, loadNameFaces, NAME_FALLBACK, NAME_FAMILIES, nameAttributes, nameDirection, nameFont, nameLang } from './names';

describe('nameLang', () => {
  it('reads kana as Japanese and hangul as Korean, whatever the hint', () => {
    expect(nameLang('さくら')).toBe('ja');
    expect(nameLang('サクラ_tv')).toBe('ja');
    expect(nameLang('東京のサクラ', 'zh')).toBe('ja');
    expect(nameLang('하늘')).toBe('ko');
    expect(nameLang('김하늘', 'ja')).toBe('ko');
    expect(nameLang('金하늘')).toBe('ko');
  });

  it('lets an agreeing hint pick the region for Han, and defaults Han to Japanese', () => {
    expect(nameLang('龍王')).toBe('ja');
    expect(nameLang('龍王', 'en')).toBe('ja');
    expect(nameLang('龍王', 'zh')).toBe('zh');
    expect(nameLang('龍王', 'zh-hk')).toBe('zh-HK');
    expect(nameLang('龍王', 'zh_tw')).toBe('zh-TW');
    expect(nameLang('龙王', 'zh-Hans')).toBe('zh-Hans');
    expect(nameLang('金龍', 'ko')).toBe('ko');
    expect(nameLang('さくら', 'ja-JP')).toBe('ja-JP');
  });

  it('keeps an agreeing hint for other scripts and otherwise leaves the page lang', () => {
    expect(nameLang('محمد')).toBeUndefined();
    expect(nameLang('محمد', 'ar')).toBe('ar');
    expect(nameLang('محمد', 'fa')).toBe('fa');
    expect(nameLang('محمد', 'ja')).toBeUndefined();
    expect(nameLang('שלום')).toBeUndefined();
    expect(nameLang('שלום', 'he')).toBe('he');
    expect(nameLang('สมชาย')).toBeUndefined();
    expect(nameLang('สมชาย', 'th')).toBe('th');
    expect(nameLang('Wanderer')).toBeUndefined();
    expect(nameLang('Wanderer', 'de')).toBeUndefined();
    expect(nameLang('Wanderer', 'ja')).toBeUndefined();
    expect(nameLang('Wanderer', 'not a tag')).toBeUndefined();
  });
});

describe('nameDirection', () => {
  it('follows the first strong character', () => {
    expect(nameDirection('Wanderer')).toBe('ltr');
    expect(nameDirection('محمد')).toBe('rtl');
    expect(nameDirection('שלום')).toBe('rtl');
    expect(nameDirection('123_محمد')).toBe('rtl');
    expect(nameDirection('Ali_محمد')).toBe('ltr');
    expect(nameDirection('محمد_Ali')).toBe('rtl');
    expect(nameDirection('さくら')).toBe('ltr');
    expect(nameDirection('‏x')).toBe('rtl');
    expect(nameDirection('٣٤٥')).toBe('ltr');
    expect(nameDirection('')).toBe('ltr');
  });
});

describe('nameFont', () => {
  const stack = (font: string) => font.slice(font.indexOf('px ') + 3).split(', ').map((family) => family.replace(/"/g, ''));

  it('keeps the default order and the fallbacks', () => {
    const font = nameFont(16);
    expect(font.startsWith('400 16px ')).toBe(true);
    expect(stack(font)).toEqual([...NAME_FAMILIES, ...NAME_FALLBACK]);
    expect(font.endsWith(', serif')).toBe(true);
    expect(NAME_FAMILIES[0]).toBe('Alegreya');
  });

  it('puts the regional CJK family first for the lang', () => {
    const cjk = (font: string) => stack(font).filter((family) => family.startsWith('Chatdom ') && family.length === 10);
    expect(cjk(nameFont(16))).toEqual(['Chatdom JP', 'Chatdom KR', 'Chatdom TC', 'Chatdom SC']);
    expect(cjk(nameFont(16, { lang: 'ko' }))).toEqual(['Chatdom KR', 'Chatdom JP', 'Chatdom TC', 'Chatdom SC']);
    expect(cjk(nameFont(16, { lang: 'zh' }))).toEqual(['Chatdom TC', 'Chatdom JP', 'Chatdom KR', 'Chatdom SC']);
    expect(cjk(nameFont(16, { lang: 'zh-hk' }))).toEqual(['Chatdom TC', 'Chatdom JP', 'Chatdom KR', 'Chatdom SC']);
    expect(cjk(nameFont(16, { lang: 'zh-CN' }))).toEqual(['Chatdom SC', 'Chatdom JP', 'Chatdom KR', 'Chatdom TC']);
    expect(cjk(nameFont(16, { lang: 'zh-Hans-TW' }))).toEqual(['Chatdom SC', 'Chatdom JP', 'Chatdom KR', 'Chatdom TC']);
    expect(cjk(nameFont(16, { text: '하늘' }))).toEqual(['Chatdom KR', 'Chatdom JP', 'Chatdom TC', 'Chatdom SC']);
    expect(stack(nameFont(16, { lang: 'zh' })).slice(0, 5)).toEqual(['Alegreya', 'Chatdom Arabic', 'Chatdom Hebrew', 'Chatdom Devanagari', 'Chatdom Thai']);
  });

  it('writes weight, style and size as a valid shorthand', () => {
    expect(nameFont(13.5, { weight: 700, style: 'italic' }).startsWith('italic 700 13.5px "Alegreya", ')).toBe(true);
    expect(nameFont(20, { style: 'normal' }).startsWith('400 20px ')).toBe(true);
  });
});

describe('DOM helpers', () => {
  it('describes the attributes for a name', () => {
    expect(nameAttributes('Wanderer')).toEqual({ dir: 'auto' });
    expect(nameAttributes('龍王', 'zh-tw')).toEqual({ dir: 'auto', lang: 'zh-TW' });
  });

  it('applies text, direction, lang and class', () => {
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    const element = {
      textContent: '',
      dir: '',
      set lang(value: string) { attributes.set('lang', value); },
      removeAttribute: (name: string) => attributes.delete(name),
      classList: { add: (name: string) => classes.add(name) },
    } as unknown as HTMLElement;
    applyName(element, 'さくら');
    expect(element.textContent).toBe('さくら');
    expect(element.dir).toBe('auto');
    expect(attributes.get('lang')).toBe('ja');
    expect(classes.has('cd-name')).toBe(true);
    applyName(element, 'Wanderer');
    expect(attributes.has('lang')).toBe(false);
  });
});

describe('loadNameFaces', () => {
  const realDocument = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    vi.useRealTimers();
    if (realDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = realDocument;
  });

  const face = (family: string, unicodeRange: string, style = 'normal') => ({ family: `"${family}"`, unicodeRange, style });
  const install = (load: (font: string, text: string) => Promise<unknown>) => {
    const faces = [
      face('Alegreya', 'U+0000-00FF, U+0131'),
      face('Alegreya', 'U+0400-045F'),
      face('Chatdom Arabic', 'U+0600-06FF, U+FB50-FDFF'),
      face('Chatdom Thai', 'U+0E00-0E7F'),
      face('Chatdom JP', 'U+3040-30FF'),
      face('Chatdom JP', 'U+6771, U+4E??'),
      face('Chatdom KR', 'U+AC00-D7FF, U+6771'),
      face('Chatdom TC', 'U+9F8D, U+6771'),
      face('Chatdom SC', 'U+9F99, U+6771'),
      face('Somebody Else', 'U+0000-10FFFF'),
    ];
    (globalThis as { document?: unknown }).document = { fonts: { load, forEach: (fn: (f: unknown) => void) => faces.forEach(fn) } };
  };

  it('resolves without document.fonts', async () => {
    await expect(loadNameFaces(['Wanderer', 'さくら'])).resolves.toBeUndefined();
    (globalThis as { document?: unknown }).document = {};
    await expect(loadNameFaces('さくら')).resolves.toBeUndefined();
  });

  it('asks once per family for just the characters each family answers', async () => {
    const calls: Array<[string, string]> = [];
    install(async (font, text) => { calls.push([font, text]); return []; });
    await loadNameFaces(['Ivan Иван', 'محمد', '東さくら', '東하늘', '龍', '龙'], { px: 18 });
    const byFamily = Object.fromEntries(calls.map(([font, text]) => [font, [...text].sort().join('')]));
    expect(byFamily).toEqual({
      '18px "Alegreya"': [...'IvanИван'].sort().join(''),
      '18px "Chatdom Arabic"': [...'محمد'].filter((c, i, all) => all.indexOf(c) === i).sort().join(''),
      // 東 goes to JP for the Japanese name, to KR for the Korean one; 龍 and 龙 (Han only, so ja) fall through JP.
      '18px "Chatdom JP"': [...'東さくら'].sort().join(''),
      '18px "Chatdom KR"': [...'東하늘'].sort().join(''),
      '18px "Chatdom TC"': '龍',
      '18px "Chatdom SC"': '龙',
    });
  });

  it('orders by the lang it is given', async () => {
    const calls: string[] = [];
    install(async (font) => { calls.push(font); return []; });
    await loadNameFaces('東', { lang: 'zh-CN' });
    expect(calls).toEqual(['16px "Chatdom SC"']);
  });

  it('gives up quietly on the timeout and never rejects', async () => {
    vi.useFakeTimers();
    install(() => new Promise(() => undefined));
    let settled = false;
    const pending = loadNameFaces('さくら', { timeoutMs: 50 }).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(49);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);

    install(() => Promise.reject(new Error('network')));
    await expect(loadNameFaces('さくら')).resolves.toBeUndefined();
    install(() => { throw new Error('syntax'); });
    await expect(loadNameFaces('さくら')).resolves.toBeUndefined();
  });
});
