import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAME_FALLBACK, NAME_FAMILIES } from './names';

type Span = [number, number];
type Face = { family: string; style: string; weight: string; url: string; range: Span[] | undefined; descriptors: Record<string, string> };

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SRC, '../../..');
const CSS = readFileSync(join(SRC, 'fonts.css'), 'utf8');

function spans(text: string): Span[] {
  return text.split(',').map((token) => {
    const value = token.trim().replace(/^U\+/i, '');
    if (value.includes('?')) return [parseInt(value.replace(/\?/g, '0'), 16), parseInt(value.replace(/\?/g, 'F'), 16)] as Span;
    const [lo, hi = lo] = value.split('-');
    return [parseInt(lo!, 16), parseInt(hi!, 16)] as Span;
  });
}

function parseFaces(css: string): Face[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => {
    const descriptors: Record<string, string> = {};
    for (const part of body!.split(';')) {
      const at = part.indexOf(':');
      if (at > 0) descriptors[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    const url = descriptors.src?.match(/url\('([^']+)'\)/)?.[1];
    if (!url) throw new Error(`face without url: ${body}`);
    return {
      family: descriptors['font-family']!.replace(/'/g, ''),
      style: descriptors['font-style']!,
      weight: descriptors['font-weight']!,
      url,
      range: descriptors['unicode-range'] ? spans(descriptors['unicode-range']) : undefined,
      descriptors,
    };
  });
}

const FACES = parseFaces(CSS);
const WORLD = FACES.filter((face) => face.family.startsWith('Chatdom '));
const ALEGREYA_LATIN = FACES.filter((face) => /alegreya-(roman|italic)-latin\.woff2$/.test(face.url));
const ALEGREYA_EXTRA = FACES.filter((face) => /alegreya-[\w-]+-wght-(normal|italic)\.woff2$/.test(face.url));
const NON_LATIN = [...WORLD, ...ALEGREYA_EXTRA];

const inRange = (range: Span[] | undefined, point: number) => range === undefined || range.some(([lo, hi]) => point >= lo && point <= hi);
const overlaps = (a: Span[], b: Span[]) => a.some(([alo, ahi]) => b.some(([blo, bhi]) => alo <= bhi && blo <= ahi));
const hex = (point: number) => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;

// Everything a Latin-only page may contain: Basic Latin to Latin Extended-B, combining marks, general punctuation,
// currency, letterlike symbols, arrows and geometric shapes.
const LATIN_PAGE: Span[] = [
  [0x0000, 0x024f], [0x0300, 0x036f], [0x2000, 0x206f], [0x20a0, 0x20cf], [0x2100, 0x214f], [0x2190, 0x21ff], [0x25a0, 0x25ff],
];
const KANA: Span[] = [[0x3040, 0x30ff], [0x31f0, 0x31ff], [0x1b000, 0x1b16f]];
const HANGUL: Span[] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xa960, 0xa97f], [0xac00, 0xd7ff]];

describe('fonts.css files', () => {
  it('declares the expected families', () => {
    const families = [...new Set(FACES.map((face) => face.family))].sort();
    expect(families).toEqual(['Alegreya', 'Chatdom Arabic', 'Chatdom Devanagari', 'Chatdom Hebrew', 'Chatdom JP', 'Chatdom KR', 'Chatdom SC', 'Chatdom TC', 'Chatdom Thai', 'IM Fell English', 'IM Fell English SC']);
  });

  it('points every url() at a file that exists', () => {
    const missing = FACES.map((face) => face.url).filter((url) => !existsSync(join(SRC, url)));
    expect(missing).toEqual([]);
  });

  it('ships no world file that fonts.css does not use', () => {
    const used = new Set(FACES.map((face) => resolve(SRC, face.url)));
    const shipped = readdirSync(join(SRC, 'fonts/world'), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.woff2'))
      .map((file) => resolve(SRC, 'fonts/world', file));
    expect(shipped.filter((file) => !used.has(file)).map((file) => relative(SRC, file))).toEqual([]);
  });

  it('keeps the OFL 1.1 beside every folder of files', () => {
    const folders = readdirSync(join(SRC, 'fonts/world'));
    expect(folders.sort()).toEqual(['arabic', 'devanagari', 'hebrew', 'jp', 'kr', 'sc', 'tc', 'thai']);
    for (const folder of folders) {
      expect(readFileSync(join(SRC, 'fonts/world', folder, 'OFL.txt'), 'utf8'), folder).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
    expect(readFileSync(join(SRC, 'fonts/OFL-Alegreya-fontsource.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('repeats the Latin faces exactly as kit.css declares them', () => {
    const kit = parseFaces(readFileSync(join(SRC, 'kit.css'), 'utf8'));
    const latin = FACES.filter((face) => !face.family.startsWith('Chatdom ') && !ALEGREYA_EXTRA.includes(face));
    expect(latin).toEqual(kit);
  });
});

describe('world faces', () => {
  it('are 400 normal, swap, and carry a unicode-range', () => {
    expect(WORLD.length).toBeGreaterThan(8);
    for (const face of WORLD) {
      expect(face.weight, face.url).toBe('400');
      expect(face.style, face.url).toBe('normal');
      expect(face.descriptors['font-display'], face.url).toBe('swap');
      expect(face.range?.length, face.url).toBeGreaterThan(0);
    }
  });

  it('never cover a code point a Latin-only page uses', () => {
    const offenders = WORLD.filter((face) => overlaps(face.range!, LATIN_PAGE)).map((face) => face.url);
    expect(offenders).toEqual([]);
    // Nothing at all below Hebrew.
    expect(WORLD.filter((face) => face.range!.some(([lo]) => lo < 0x0590)).map((face) => face.url)).toEqual([]);
  });

  it('keep kana to JP and hangul to KR', () => {
    for (const face of WORLD) {
      if (face.family !== 'Chatdom JP') expect(overlaps(face.range!, KANA), `${face.url} has kana`).toBe(false);
      if (face.family !== 'Chatdom KR') expect(overlaps(face.range!, HANGUL), `${face.url} has hangul`).toBe(false);
    }
    expect(WORLD.some((face) => face.family === 'Chatdom JP' && overlaps(face.range!, KANA))).toBe(true);
    expect(WORLD.some((face) => face.family === 'Chatdom KR' && overlaps(face.range!, HANGUL))).toBe(true);
  });

  it('carry Alegreya\'s line box, scaled through their size-adjust', () => {
    const pct = (value: string | undefined) => parseFloat(value ?? 'NaN') / 100;
    for (const face of WORLD) {
      const size = pct(face.descriptors['size-adjust']);
      expect(size, face.url).toBeGreaterThan(0.8);
      expect(size, face.url).toBeLessThanOrEqual(1.05);
      expect(pct(face.descriptors['ascent-override']) * size, face.url).toBeCloseTo(1.016, 3);
      expect(pct(face.descriptors['descent-override']) * size, face.url).toBeCloseTo(0.345, 3);
      expect(face.descriptors['line-gap-override'], face.url).toBe('0%');
    }
  });
});

describe('Alegreya', () => {
  it('keeps every extra subset in the Alegreya family, both styles, clear of the Latin file', () => {
    const subsets = ['latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'];
    expect(ALEGREYA_EXTRA.map((face) => face.url.replace(/^.*alegreya-/, '')).sort()).toEqual(
      subsets.flatMap((subset) => [`${subset}-wght-italic.woff2`, `${subset}-wght-normal.woff2`]).sort(),
    );
    const latin = ALEGREYA_LATIN[0]!.range!;
    for (const face of ALEGREYA_EXTRA) {
      expect(face.family, face.url).toBe('Alegreya');
      expect(face.weight, face.url).toBe('400 900');
      expect(face.style, face.url).toBe(face.url.includes('italic') ? 'italic' : 'normal');
      expect(overlaps(face.range!, latin), face.url).toBe(false);
    }
  });
});

describe('the name stack', () => {
  it('matches names.ts', () => {
    const quoted = (family: string) => (family === 'serif' || family === 'Alegreya' || family === 'Georgia' ? family : `'${family}'`);
    expect(CSS).toContain(`:root { --cd-face-name: ${[...NAME_FAMILIES, ...NAME_FALLBACK].map(quoted).join(', ')}; }`);
  });

  it('reorders CJK by lang', () => {
    const rule = (selector: string) => CSS.match(new RegExp(`${selector.replace(/[()]/g, '\\$&')}[^{]*{ --cd-face-name: ([^;]+);`))?.[1];
    const firstCjk = (selector: string) => rule(selector)?.match(/'Chatdom (JP|KR|TC|SC)'/)?.[1];
    expect(firstCjk(':lang(ja)')).toBe('JP');
    expect(firstCjk(':lang(ko)')).toBe('KR');
    expect(firstCjk(':lang(zh)')).toBe('TC');
    expect(firstCjk(':lang(zh-CN)')).toBe('SC');
    expect(firstCjk(':lang(zh-Hant)')).toBe('TC');
    expect(firstCjk(':lang(zh-Hans)')).toBe('SC');
    expect(CSS).toMatch(/:lang\(zh\), :lang\(zh-TW\), :lang\(zh-HK\)/);
    expect(CSS).toMatch(/:lang\(zh-CN\), :lang\(zh-SG\)/);
  });

  it('gives .cd-name and .cd-name-line what names need', () => {
    expect(CSS).toMatch(/\.cd-name \{[^}]*font-family: var\(--cd-face-name\)[^}]*unicode-bidi: isolate[^}]*overflow-wrap: anywhere/);
    expect(CSS).toMatch(/\.cd-name-line \{[^}]*overflow-x: clip; overflow-y: visible/);
  });
});

describe('the Latin site pages', () => {
  const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', copy: '©', sect: '§', euro: '€' };
  const textOf = (html: string) => {
    const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
    const attributes = [...body.matchAll(/\b(?:alt|title|aria-label|placeholder|content|value)="([^"]*)"/g)].map((match) => match[1]);
    const text = [body.replace(/<[^>]*>/g, ' '), ...attributes].join(' ');
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
      const decoded = NAMED[name];
      if (decoded === undefined) throw new Error(`unknown entity ${entity}`);
      return decoded;
    });
  };
  const site = join(ROOT, 'apps/web/src/site');
  const pages = existsSync(site)
    ? readdirSync(site, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.html'))
    : [];

  it('exist', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s is drawn by Latin faces only', (page) => {
    const points = new Set([...textOf(readFileSync(join(site, page), 'utf8'))].map((char) => char.codePointAt(0)!));
    const uncovered = [...points].filter((point) => point > 0x20 && !ALEGREYA_LATIN.every((face) => inRange(face.range, point)));
    expect(uncovered.map(hex)).toEqual([]);
    const pulled = NON_LATIN.filter((face) => [...points].some((point) => inRange(face.range, point))).map((face) => face.url);
    expect(pulled).toEqual([]);
  });
});
