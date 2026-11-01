/**
 * Search keys for channel names in every script (Spec 01 R17). The key is only ever compared, never shown: results
 * keep the original spelling. Both sides go through the same steps, so a lossy step matches symmetrically:
 *
 * 1. NFKD, so compatibility forms (full-width Latin, ligatures, circled letters) and accents come apart;
 * 2. combining marks dropped (é → e, が → か), so a reader without the accent still finds the name;
 * 3. format characters dropped (zero-width joiners, bidi controls), which would otherwise hide a match;
 * 4. lower case, without a locale, then NFC again;
 * 5. runs of spaces, underscores, hyphens and dots read as one space, trimmed.
 */
const MARKS = /\p{M}+/gu;
const FORMAT = /\p{Cf}+/gu;
const SEPARATORS = /[\s_\-.·]+/gu;

export function searchKey(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').replace(FORMAT, '').toLowerCase().normalize('NFC').replace(SEPARATORS, ' ').trim();
}

/** Longest query the register answers, in code points of its key. Longer names exist; their first fifty find them. */
export const MAX_QUERY_CODE_POINTS = 50;

export type QueryKey = { ok: true; key: string; length: number } | { ok: false; reason: 'empty' | 'too-long' };

export function queryKey(raw: string): QueryKey {
  const key = searchKey(raw);
  const length = [...key].length;
  if (length === 0) return { ok: false, reason: 'empty' };
  if (length > MAX_QUERY_CODE_POINTS) return { ok: false, reason: 'too-long' };
  return { ok: true, key, length };
}

/** Scripts written without spaces, where one character is already a word worth finding inside a name. */
const IDEOGRAPHIC = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;

/**
 * How well a name key matches a query key: 0 the same, 1 it begins with it, 2 one of its words begins with it,
 * 3 it contains it, or -1. A single letter inside a word would find everyone, so a one-code-point query matches
 * inside a name only in scripts written without spaces (中, 町, 한).
 */
export function matchRank(name: string, query: string, queryLength: number): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.indexOf(query) < 0) return -1;
  if (name.indexOf(` ${query}`) >= 0) return 2;
  return queryLength >= 2 || IDEOGRAPHIC.test(query) ? 3 : -1;
}
