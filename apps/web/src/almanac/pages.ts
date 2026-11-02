import { kingdomHoldsFish, type FishSpecies, type PierAlmanac, type PierAlmanacEntry, type PierAlmanacMark, type PierAlmanacStatus } from '@chatdom/shared';
import {
  asOfLine, biggestLine, bookTitle, catchesLine, countLine, firstLine, gradeWords, markWords, marksSummary, mountsLine, placeName,
  sizeLine, statusWords, summaryLine, unknownHint, waterLine, whereWhen, type MarkWords,
} from './words';

/** The book's three chapters, in the order they are bound. */
export type Chapter = 'fresh' | 'sea' | 'legends';
export const CHAPTER_TITLES: Readonly<Record<Chapter, string>> = { fresh: 'Lakes and rivers', sea: 'The sea', legends: 'The four legends' };

export interface Plate {
  readonly species: FishSpecies;
  readonly chapter: Chapter;
  /** 1-based plate number, the same in every kingdom's copy. */
  readonly plate: number;
}

export function chapterOf(species: Pick<FishSpecies, 'legend' | 'waters'>): Chapter {
  if (species.legend) return 'legends';
  return species.waters.includes('lake') || species.waters.includes('river') ? 'fresh' : 'sea';
}

/** Every species in binding order: lakes and rivers, then the sea, then the legends; authored order inside each. */
export function bookOrder(species: readonly FishSpecies[]): Plate[] {
  const chapters: readonly Chapter[] = ['fresh', 'sea', 'legends'];
  const seen = new Set<string>();
  const unique = species.filter(fish => !seen.has(fish.id) && seen.add(fish.id));
  return chapters.flatMap(chapter => unique.filter(fish => chapterOf(fish) === chapter))
    .map((fish, i) => ({ species: fish, chapter: chapterOf(fish), plate: i + 1 }));
}

const ROMAN: readonly (readonly [number, string])[] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(value: number): string {
  let n = Number.isInteger(value) && value > 0 && value < 4000 ? value : 0, out = '';
  for (const [size, mark] of ROMAN) while (n >= size) { out += mark; n -= size; }
  return out;
}

/** The two folios of a plate's spread: the contents is pages 1 and 2, plate I is 3 and 4. */
export function folios(plate: number): readonly [number, number] {
  return [plate * 2 + 1, plate * 2 + 2];
}

/** One normalised page of the kingdom's record, clean of anything the realm sent that cannot be printed. */
export interface Leaf {
  readonly kind: 'species';
  readonly plate: Plate;
  readonly status: PierAlmanacStatus;
  readonly entry: PierAlmanacEntry;
  readonly mark: PierAlmanacMark | null;
}
export interface ContentsLeaf { readonly kind: 'contents' }
export type AnyLeaf = ContentsLeaf | Leaf;

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const STATUSES: readonly PierAlmanacStatus[] = ['caught', 'waiting', 'elsewhere'];

function normalise(entry: PierAlmanacEntry | undefined, species: FishSpecies, almanac: PierAlmanac): PierAlmanacEntry {
  if (!entry || !STATUSES.includes(entry.status)) {
    // The realm left this species out: say what the water itself says, never that it was caught.
    const holds = almanac.water !== null && species.waters.includes(almanac.water) && kingdomHoldsFish(almanac.kingdomId, species);
    return { speciesId: species.id, status: holds ? 'waiting' : 'elsewhere', count: 0, first: null, biggest: null, mounts: 0 };
  }
  const caught = entry.status === 'caught';
  return {
    speciesId: species.id, status: entry.status, count: caught ? Math.max(1, count(entry.count)) : 0,
    first: caught ? entry.first : null, biggest: caught ? entry.biggest : null, mounts: caught ? count(entry.mounts) : 0,
  };
}

/** The book's leaves: the contents first, then one per species in binding order. */
export function buildLeaves(almanac: PierAlmanac, species: readonly FishSpecies[], marks: readonly PierAlmanacMark[] | null | undefined): AnyLeaf[] {
  const entries = new Map(almanac.entries.map(entry => [entry.speciesId, entry]));
  const mine = new Map((marks ?? []).filter(mark => count(mark.count) > 0).map(mark => [mark.speciesId, mark]));
  return [{ kind: 'contents' }, ...bookOrder(species).map(plate => {
    const entry = normalise(entries.get(plate.species.id), plate.species, almanac);
    return { kind: 'species' as const, plate, status: entry.status, entry, mark: mine.get(plate.species.id) ?? null };
  })];
}

/** Where `page` lives in the book; an unknown page opens the contents. */
export function leafIndex(leaves: readonly AnyLeaf[], page: string | null | undefined): number {
  if (!page || page === 'contents') return 0;
  const index = leaves.findIndex(leaf => leaf.kind === 'species' && leaf.plate.species.id === page);
  return index < 0 ? 0 : index;
}

export function leafId(leaf: AnyLeaf): string {
  return leaf.kind === 'contents' ? 'contents' : leaf.plate.species.id;
}

/** The page `delta` leaves away, held inside the covers. */
export function stepIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  const from = Number.isInteger(current) ? current : 0;
  return Math.min(total - 1, Math.max(0, from + Math.trunc(delta)));
}

export type NavAction = 'next' | 'prev' | 'close' | 'contents' | 'last';

/** The keys a reader turns pages with. */
export function navKey(key: string): NavAction | null {
  switch (key) {
    case 'ArrowRight': case 'PageDown': return 'next';
    case 'ArrowLeft': case 'PageUp': return 'prev';
    case 'Escape': return 'close';
    case 'Home': return 'contents';
    case 'End': return 'last';
    default: return null;
  }
}

/** A finger drawn across the page: leftwards turns forward. Short, slow or mostly vertical strokes do nothing. */
export function swipeAction(dx: number, dy: number, ms: number): 'next' | 'prev' | null {
  if (![dx, dy, ms].every(Number.isFinite)) return null;
  const distance = Math.abs(dx);
  if (distance < 42 || distance < Math.abs(dy) * 1.4 || ms > 900) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** One open spread, or a single page that turns. */
export function bookLayout(width: number, height: number): 'spread' | 'single' {
  if (!(width > 0) || !(height > 0)) return 'spread';
  return width < 820 || width < height * 1.05 ? 'single' : 'spread';
}

/* ---------- The words on each page, built once and shared by the book and its checks ---------- */

export interface SpeciesWords {
  readonly kind: 'species';
  readonly id: string;
  readonly status: PierAlmanacStatus;
  readonly legend: boolean;
  readonly plateLabel: string;
  readonly folios: readonly [string, string];
  readonly runningHead: string;
  readonly eyebrow: string;
  /** The display name; for an unknown page, the riddle stands as its heading. */
  readonly title: string;
  readonly caption: string;
  readonly lore: string;
  readonly riddle: string;
  readonly hint: string;
  readonly whereWhen: string;
  readonly size: string;
  readonly first: string;
  readonly biggest: string;
  readonly count: string;
  readonly mounts: string;
  readonly mark: MarkWords | null;
  /** A screen reader's one line for the turn. */
  readonly announce: string;
}

export interface ContentsRow {
  readonly id: string; readonly plate: string; readonly folio: string; readonly name: string; readonly state: string;
  readonly status: PierAlmanacStatus; readonly legend: boolean; readonly mine: boolean; readonly label: string;
}
export interface ContentsWords {
  readonly kind: 'contents';
  readonly title: string;
  readonly sub: string;
  readonly summary: string;
  readonly known: number;
  readonly total: number;
  readonly catches: string;
  readonly water: string;
  readonly asOf: string;
  readonly marks: string;
  readonly chapters: readonly { readonly chapter: Chapter; readonly title: string; readonly rows: readonly ContentsRow[] }[];
  readonly key: readonly { readonly mark: 'seal' | 'ink' | 'pencil' | 'tick'; readonly words: string }[];
  readonly announce: string;
}

export interface WordsContext {
  readonly kingdom: string;
  readonly asOf: number;
  readonly watcher: boolean;
}

export function speciesWords(leaf: Leaf, context: WordsContext): SpeciesWords {
  const { species } = leaf.plate, known = leaf.status === 'caught', kingdom = placeName(context.kingdom);
  const [left, right] = folios(leaf.plate.plate);
  const plateLabel = `Plate ${toRoman(leaf.plate.plate)}`;
  const chapter = CHAPTER_TITLES[leaf.plate.chapter];
  const title = known ? species.name : species.riddle;
  const eyebrow = known ? `${gradeWords(species)} · ${chapter}` : species.legend ? `A legend · not yet known` : `Not yet known · ${chapter}`;
  const entry = leaf.entry;
  return {
    kind: 'species', id: species.id, status: leaf.status, legend: species.legend === true, plateLabel,
    folios: [String(left), String(right)],
    runningHead: bookTitle(kingdom).title + (kingdom ? ` of ${kingdom}` : ''),
    eyebrow, title,
    caption: known ? species.name : leaf.status === 'waiting' ? 'Somewhere in these waters' : 'Seen only in other waters',
    lore: known ? species.lore : '', riddle: known ? '' : species.riddle,
    hint: known ? '' : unknownHint(leaf.status as 'waiting' | 'elsewhere', kingdom),
    whereWhen: whereWhen(species),
    size: known ? sizeLine(species) : sizeLine(species).replace(/^Grows/, 'Said to grow'),
    first: known ? firstLine(entry.first, kingdom, context.asOf) : '',
    biggest: known ? biggestLine(entry.biggest, entry.first, context.asOf, entry.count) : '',
    count: known ? countLine(entry.count, kingdom) : '',
    mounts: known ? mountsLine(entry.mounts, kingdom) : '',
    mark: context.watcher ? null : markWords(leaf.mark, kingdom, context.asOf),
    announce: `${plateLabel}, ${known ? species.name : 'an unknown fish'}.`,
  };
}

export function contentsWords(leaves: readonly AnyLeaf[], almanac: PierAlmanac, context: WordsContext & { readonly marks: readonly PierAlmanacMark[] | null }): ContentsWords {
  const kingdom = placeName(context.kingdom);
  const species = leaves.filter((leaf): leaf is Leaf => leaf.kind === 'species');
  const known = species.filter(leaf => leaf.status === 'caught').length;
  const chapters = (['fresh', 'sea', 'legends'] as const).map(chapter => ({
    chapter, title: CHAPTER_TITLES[chapter],
    rows: species.filter(leaf => leaf.plate.chapter === chapter).map((leaf): ContentsRow => {
      const caught = leaf.status === 'caught', name = caught ? leaf.plate.species.name : 'Unknown';
      const state = statusWords(leaf.status, leaf.entry.count), folio = String(folios(leaf.plate.plate)[0]);
      const plate = toRoman(leaf.plate.plate);
      return {
        id: leaf.plate.species.id, plate, folio, name, state, status: leaf.status, legend: leaf.plate.species.legend === true,
        mine: !context.watcher && leaf.mark !== null,
        label: `Plate ${plate}, ${caught ? name : 'an unknown fish'}, ${state}. Page ${folio}.`,
      };
    }),
  })).filter(chapter => chapter.rows.length > 0);
  const { title, sub } = bookTitle(kingdom);
  const key: ContentsWords['key'][number][] = [
    { mark: 'seal', words: kingdom ? `First caught in ${kingdom}` : 'First caught here' },
    { mark: 'ink', words: 'Lives here, not yet caught' },
    { mark: 'pencil', words: 'Only in other waters' },
  ];
  if (!context.watcher && context.marks) key.push({ mark: 'tick', words: 'Caught by your hand' });
  return {
    kind: 'contents', title, sub, summary: summaryLine(known, species.length, kingdom), known, total: species.length,
    catches: catchesLine(almanac.catches), water: waterLine(almanac.water, kingdom), asOf: asOfLine(almanac.asOf),
    marks: context.watcher ? '' : marksSummary(context.marks), chapters, key,
    announce: `Contents. ${summaryLine(known, species.length, kingdom)}.`,
  };
}

/** Every printed string of a page's words, for checks. */
export function printedStrings(words: SpeciesWords | ContentsWords): string[] {
  if (words.kind === 'contents') {
    return [words.title, words.sub, words.summary, words.catches, words.water, words.asOf, words.marks, words.announce,
      ...words.key.map(item => item.words),
      ...words.chapters.flatMap(chapter => [chapter.title, ...chapter.rows.flatMap(row => [row.plate, row.folio, row.name, row.state, row.label])])].filter(Boolean);
  }
  return [words.plateLabel, ...words.folios, words.runningHead, words.eyebrow, words.title, words.caption, words.lore, words.riddle, words.hint,
    words.whereWhen, words.size, words.first, words.biggest, words.count, words.mounts, words.announce,
    ...(words.mark ? [words.mark.head, ...words.mark.lines] : [])].filter(Boolean);
}
