// Display names in any script. fonts.css declares the faces (one family per script, split by unicode-range so a
// page downloads only what it shows); this module tells a DOM element or a canvas which of them a name needs.
//
//   import '@chatdom/ui/fonts.css';
//   applyName(element, user.displayName, channel.broadcasterLanguage);
//   await loadNameFaces(names, { px: 18 });  ctx.font = nameFont(18, { text: name });

/** The name families in their default order, without generic fallbacks. Mirrors `--cd-face-name` in fonts.css. */
export const NAME_FAMILIES: readonly string[] = Object.freeze([
  'Alegreya',
  'Chatdom Arabic',
  'Chatdom Hebrew',
  'Chatdom Devanagari',
  'Chatdom Thai',
  'Chatdom JP',
  'Chatdom KR',
  'Chatdom TC',
  'Chatdom SC',
]);

/** What a name falls back to when none of our faces has a character. */
export const NAME_FALLBACK: readonly string[] = Object.freeze(['Georgia', 'Times New Roman', 'serif']);

const CJK_FAMILIES = ['Chatdom JP', 'Chatdom KR', 'Chatdom TC', 'Chatdom SC'] as const;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

const KANA = /[぀-ヿㇰ-ㇿ\u{1b000}-\u{1b16f}]/u;
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-퟿]/u;
const HAN = /\p{Script=Han}/u;

/** Scripts a broadcast language is written in, for checking that a hint agrees with the name. */
const SCRIPT_OF: Readonly<Record<string, RegExp>> = {
  ar: /\p{Script=Arabic}/u, fa: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u, ps: /\p{Script=Arabic}/u,
  ckb: /\p{Script=Arabic}/u, sd: /\p{Script=Arabic}/u, ug: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u, iw: /\p{Script=Hebrew}/u, yi: /\p{Script=Hebrew}/u,
  hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u, ne: /\p{Script=Devanagari}/u, sa: /\p{Script=Devanagari}/u,
  th: /\p{Script=Thai}/u,
  ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, bg: /\p{Script=Cyrillic}/u, sr: /\p{Script=Cyrillic}/u,
  mk: /\p{Script=Cyrillic}/u, be: /\p{Script=Cyrillic}/u, kk: /\p{Script=Cyrillic}/u,
  el: /\p{Script=Greek}/u,
};

/** Normalises a language hint (`zh-hk`, `ZH_tw`, `ja`) to BCP 47 casing, or undefined if it is not a tag. */
function normaliseTag(hint: string | undefined): string | undefined {
  const parts = hint?.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (!parts?.length || !/^[a-z]{2,3}$/i.test(parts[0]!)) return undefined;
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4) return part[0]!.toUpperCase() + part.slice(1).toLowerCase(); // script: Hant
      if (part.length === 2) return part.toUpperCase(); // region: TW
      return part.toLowerCase();
    })
    .join('-');
}

/**
 * The BCP 47 tag for a name's element `lang`, so CJK draws the right regional glyph forms (and screen readers pick
 * a voice that can read it). `hint` is a channel's broadcast language (`ja`, `ko`, `zh`, `zh-hk`, `zh-tw`) and wins
 * when it agrees with the name's script. Otherwise kana means `ja`, hangul `ko`, and Han alone `ja`. A name with
 * no CJK takes an agreeing hint (`ar`, `fa`, `he`, `hi`, `th`, `ru`, `el`), and is otherwise left to the page's
 * lang: undefined.
 */
export function nameLang(text: string, hint?: string): string | undefined {
  const tag = normaliseTag(hint);
  const base = tag?.split('-')[0];
  const kana = KANA.test(text);
  const hangul = HANGUL.test(text);
  const han = HAN.test(text);
  if (kana) return base === 'ja' ? tag : 'ja';
  if (hangul) return base === 'ko' ? tag : 'ko';
  if (han) return base === 'ja' || base === 'ko' || base === 'zh' ? tag : 'ja';
  if (base && SCRIPT_OF[base]?.test(text)) return tag;
  return undefined;
}

const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}\p{Script=Mende_Kikakui}]/u;
const LETTER = /\p{L}/u;

/**
 * The direction of a name from its first strong character, as `dir="auto"` would decide: a right-to-left letter
 * (or a right-to-left mark) makes it `rtl`; any other letter, an LRM or no letter at all makes it `ltr`.
 */
export function nameDirection(text: string): 'ltr' | 'rtl' {
  for (const char of text) {
    if (char === '‏' || char === '؜') return 'rtl';
    if (char === '‎') return 'ltr';
    if (!LETTER.test(char)) continue;
    return RTL.test(char) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}

/** Which CJK family the lang puts first, mirroring the `:lang()` rules in fonts.css. */
function firstCjk(lang: string | undefined): (typeof CJK_FAMILIES)[number] | undefined {
  const tag = normaliseTag(lang);
  if (!tag) return undefined;
  const [base, ...rest] = tag.split('-');
  if (base === 'ja') return 'Chatdom JP';
  if (base === 'ko') return 'Chatdom KR';
  if (base !== 'zh') return undefined;
  if (rest.includes('Hans')) return 'Chatdom SC';
  if (rest.includes('Hant')) return 'Chatdom TC';
  if (rest.some((part) => part === 'CN' || part === 'SG' || part === 'MY')) return 'Chatdom SC';
  return 'Chatdom TC';
}

/** The name families for a lang: the default order with that lang's CJK family moved to the front of the CJK run. */
function familiesFor(lang: string | undefined): string[] {
  const first = firstCjk(lang);
  const rest = NAME_FAMILIES.filter((family) => !(CJK_FAMILIES as readonly string[]).includes(family));
  const cjk = first ? [first, ...CJK_FAMILIES.filter((family) => family !== first)] : [...CJK_FAMILIES];
  return [...rest, ...cjk];
}

function quote(family: string): string {
  return GENERIC.has(family) ? family : `"${family}"`;
}

/**
 * A canvas `font` shorthand for drawing a name at `px` pixels: the same stack as `--cd-face-name` (a canvas cannot
 * read CSS variables), with the CJK families ordered for `lang`, or for `nameLang(text)` when only text is given.
 * Draw only after `loadNameFaces` resolved, or the canvas paints the fallback.
 */
export function nameFont(
  px: number,
  options: { text?: string; lang?: string; weight?: number; style?: 'normal' | 'italic' } = {},
): string {
  const lang = options.lang ?? (options.text === undefined ? undefined : nameLang(options.text));
  const families = [...familiesFor(lang), ...NAME_FALLBACK].map(quote).join(', ');
  const style = options.style === 'italic' ? 'italic ' : '';
  return `${style}${options.weight ?? 400} ${px}px ${families}`;
}

/** Parsed `unicode-range` of each FontFace, cached because CJK faces carry long lists. */
const rangeCache = new WeakMap<FontFace, Array<[number, number]>>();

function rangesOf(face: FontFace): Array<[number, number]> {
  let spans = rangeCache.get(face);
  if (spans) return spans;
  spans = [];
  for (const token of face.unicodeRange.split(',')) {
    const value = token.trim().replace(/^U\+/i, '');
    if (!value) continue;
    if (value.includes('?')) {
      spans.push([parseInt(value.replace(/\?/g, '0'), 16), parseInt(value.replace(/\?/g, 'F'), 16)]);
    } else {
      const [lo, hi = lo] = value.split('-');
      spans.push([parseInt(lo!, 16), parseInt(hi!, 16)]);
    }
  }
  rangeCache.set(face, spans);
  return spans;
}

function unquote(family: string): string {
  return family.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Loads exactly the faces some names need, so a canvas can draw them in their real faces. For each character it
 * finds the first family in the name's stack (ordered by `options.lang`, or each name's own `nameLang`) that
 * declares a face covering it, then asks `document.fonts.load()` once per family for just those characters, so only
 * the matching unicode-range slices download. Resolves when they arrive, after `timeoutMs` (default 3000) if they
 * have not, and at once where there is no `document.fonts`. It never rejects: a name in a fallback face is better
 * than no name.
 */
export function loadNameFaces(
  texts: string | readonly string[],
  options: { px?: number; lang?: string; timeoutMs?: number } = {},
): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
  const list = typeof texts === 'string' ? [texts] : texts;
  const px = options.px ?? 16;
  const timeoutMs = options.timeoutMs ?? 3000;

  let wanted: Map<string, Set<string>>;
  try {
    // Faces by family name, read once from the live FontFaceSet (CSS @font-face rules included).
    const faces = new Map<string, FontFace[]>();
    fonts.forEach((face) => {
      const family = unquote(face.family);
      if (!NAME_FAMILIES.includes(family)) return;
      const known = faces.get(family);
      if (known) known.push(face);
      else faces.set(family, [face]);
    });
    const covers = (family: string, point: number) =>
      (faces.get(family) ?? []).some((face) => face.style !== 'italic' && rangesOf(face).some(([lo, hi]) => point >= lo && point <= hi));

    // Batched by lang: names that share a lang share one family order.
    const byLang = new Map<string | undefined, string[]>();
    for (const text of list) {
      const lang = options.lang ?? nameLang(text);
      const batch = byLang.get(lang);
      if (batch) batch.push(text);
      else byLang.set(lang, [text]);
    }
    wanted = new Map();
    for (const [lang, batch] of byLang) {
      const order = familiesFor(lang);
      for (const char of new Set(Array.from(batch.join('')))) {
        const point = char.codePointAt(0)!;
        if (point < 0x21) continue;
        const family = order.find((name) => covers(name, point));
        if (!family) continue;
        const chars = wanted.get(family);
        if (chars) chars.add(char);
        else wanted.set(family, new Set([char]));
      }
    }
  } catch {
    return Promise.resolve();
  }
  if (!wanted.size) return Promise.resolve();

  const loads = [...wanted].map(([family, chars]) =>
    Promise.resolve()
      .then(() => fonts.load(`${px}px ${quote(family)}`, [...chars].join('')))
      .catch(() => undefined),
  );
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void Promise.all(loads).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** The attributes a DOM owner puts on a name's element: `dir="auto"` always, and `lang` when `nameLang` has one. */
export function nameAttributes(text: string, hint?: string): { dir: 'auto'; lang?: string } {
  const lang = nameLang(text, hint);
  return lang === undefined ? { dir: 'auto' } : { dir: 'auto', lang };
}

/**
 * Puts a name into an element: its text, `dir="auto"`, its lang (removed when the name has none, so the page's
 * lang applies) and the `cd-name` class that gives it the name face.
 */
export function applyName(element: HTMLElement, text: string, hint?: string): void {
  const { dir, lang } = nameAttributes(text, hint);
  element.textContent = text;
  element.dir = dir;
  if (lang === undefined) element.removeAttribute('lang');
  else element.lang = lang;
  element.classList.add('cd-name');
}
