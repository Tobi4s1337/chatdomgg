import type { BondView, KeepsakeView, PassportCollection, PersonView, StampView, VisiblePassportView, VisitView } from './types';

/**
 * How a book becomes pages. Records stay in the order the authority supplies them; the book only decides how many
 * sit on a page, so a long history becomes more spreads, never smaller type. Nothing is counted, ranked or inferred:
 * a collection with no records and no further page simply has no pages, and a collection with a further page ends
 * on a leaf that says so instead of pretending the loaded records are all of it.
 */
export interface Loaded<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  /** The next page is being read for this collection; the leaf shows the reading, not a finished turn. */
  readonly pending?: boolean;
  /** The last read of the next page failed; the leaf says so and offers to try again. */
  readonly failed?: boolean;
}

export interface PassportShelf {
  readonly stamps: Loaded<StampView>;
  readonly kingdoms: Loaded<VisitView>;
  readonly bonds: Loaded<BondView>;
  readonly keepsakes: Loaded<KeepsakeView>;
}

/** The first page of every collection exactly as the book arrived. */
export function shelfOf(book: VisiblePassportView): PassportShelf {
  return { stamps: book.stamps, kingdoms: book.kingdoms, bonds: book.bonds, keepsakes: book.keepsakes };
}

export type SectionId = 'flyleaf' | PassportCollection | 'end';

export type PassportPage =
  | { readonly kind: 'flyleaf'; readonly holder: PersonView; readonly empty: boolean }
  /** The empty book's open page: room for the first real journey, with nothing fabricated on it. */
  | { readonly kind: 'invitation' }
  | { readonly kind: 'stamps'; readonly stamps: readonly StampView[] }
  | { readonly kind: 'kingdoms'; readonly visits: readonly VisitView[] }
  | { readonly kind: 'bonds'; readonly bonds: readonly BondView[] }
  | { readonly kind: 'keepsakes'; readonly keepsakes: readonly KeepsakeView[] }
  /** A collection whose loaded records end before its history does. */
  | { readonly kind: 'more'; readonly collection: PassportCollection; readonly pending: boolean; readonly failed: boolean }
  | { readonly kind: 'endpaper'; readonly asOf: number }
  | { readonly kind: 'blank' };

export interface Leaf { readonly page: PassportPage; readonly section: SectionId; readonly index: number }

export type BookView = { readonly kind: 'cover' } | { readonly kind: 'leaves'; readonly leaves: readonly Leaf[] };

export interface PageDensity {
  /** Stamps on one page. Each keeps a full caption, so this stays small. */
  readonly stamps: number;
  /** Kingdom, bond or keepsake entries on one page. */
  readonly entries: number;
}

export const DENSITY = {
  /** Two facing pages on the card page and the bench at desktop widths. */
  spread: { stamps: 3, entries: 5 },
  /** One page at a time in the 318 px panel and on phones. */
  page: { stamps: 2, entries: 4 },
} as const satisfies Record<string, PageDensity>;

export type BookLayout = keyof typeof DENSITY;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildLeaves(book: Pick<VisiblePassportView, 'holder' | 'asOf'>, shelf: PassportShelf, density: PageDensity): Leaf[] {
  const pages: { page: PassportPage; section: SectionId }[] = [];
  const empty = (Object.keys(shelf) as PassportCollection[]).every(key => shelf[key].items.length === 0 && shelf[key].nextCursor === null);
  pages.push({ page: { kind: 'flyleaf', holder: book.holder, empty }, section: 'flyleaf' });
  if (empty) pages.push({ page: { kind: 'invitation' }, section: 'flyleaf' });
  const collection = <T>(key: PassportCollection, loaded: Loaded<T>, size: number, make: (items: T[]) => PassportPage) => {
    for (const items of chunk(loaded.items, size)) pages.push({ page: make(items), section: key });
    if (loaded.nextCursor !== null) {
      pages.push({ page: { kind: 'more', collection: key, pending: !!loaded.pending, failed: !!loaded.failed }, section: key });
    }
  };
  collection('stamps', shelf.stamps, Math.max(1, density.stamps), stamps => ({ kind: 'stamps', stamps }));
  collection('kingdoms', shelf.kingdoms, Math.max(1, density.entries), visits => ({ kind: 'kingdoms', visits }));
  collection('bonds', shelf.bonds, Math.max(1, density.entries), bonds => ({ kind: 'bonds', bonds }));
  collection('keepsakes', shelf.keepsakes, Math.max(1, density.entries), keepsakes => ({ kind: 'keepsakes', keepsakes }));
  // A printed book closes on a right-hand page: pad with a blank before the endpaper when the count is odd.
  if (pages.length % 2 === 0) pages.push({ page: { kind: 'blank' }, section: 'end' });
  pages.push({ page: { kind: 'endpaper', asOf: book.asOf }, section: 'end' });
  return pages.map((entry, index) => ({ ...entry, index }));
}

/** The closed cover, then two facing leaves per view (spread) or one (page). */
export function buildViews(leaves: readonly Leaf[], layout: BookLayout): BookView[] {
  const views: BookView[] = [{ kind: 'cover' }];
  const step = layout === 'spread' ? 2 : 1;
  for (let i = 0; i < leaves.length; i += step) views.push({ kind: 'leaves', leaves: leaves.slice(i, i + step) });
  return views;
}

export const SECTION_LABEL: Readonly<Record<SectionId, string>> = {
  flyleaf: 'Flyleaf', stamps: 'Journeys', kingdoms: 'Kingdoms', bonds: 'Bonds', keepsakes: 'Keepsakes', end: 'Endpaper',
};

export interface SectionTab { readonly id: SectionId; readonly label: string; readonly view: number }

/** Thumb tabs: one per section that has pages, pointing at the view where it starts. The endpaper has none. */
export function sectionTabs(views: readonly BookView[]): SectionTab[] {
  const tabs: SectionTab[] = [];
  views.forEach((view, index) => {
    if (view.kind !== 'leaves') return;
    for (const leaf of view.leaves) {
      if (leaf.section === 'end' || tabs.some(tab => tab.id === leaf.section)) continue;
      tabs.push({ id: leaf.section, label: SECTION_LABEL[leaf.section], view: index });
    }
  });
  return tabs;
}

/** The section a view belongs to for the thumb tab marked current: its first non-flyleaf leaf wins on a mixed spread. */
export function sectionOfView(view: BookView | undefined): SectionId | 'cover' {
  if (!view || view.kind === 'cover') return 'cover';
  return view.leaves.find(leaf => leaf.section !== 'flyleaf')?.section ?? view.leaves[0]?.section ?? 'flyleaf';
}

/** The words a screen reader hears after a turn: where the reader now is in the book, never a total of records. */
export function viewCaption(view: BookView | undefined, leaves: number): string {
  if (!view || view.kind === 'cover') return 'The closed passport, its cover';
  const numbers = view.leaves.map(leaf => leaf.index + 1);
  const pages = numbers.length > 1 ? `Pages ${numbers[0]} and ${numbers[numbers.length - 1]}` : `Page ${numbers[0]}`;
  const sections = [...new Set(view.leaves.map(leaf => SECTION_LABEL[leaf.section]))].join(' and ');
  return `${pages} of ${leaves}: ${sections}`;
}
