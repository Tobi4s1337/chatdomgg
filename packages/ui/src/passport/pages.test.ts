import { describe, expect, it } from 'vitest';
import { simulatedPassport, simulatedPassportPage } from './fixtures';
import { DENSITY, buildLeaves, buildViews, sectionTabs, shelfOf, viewCaption, type PassportShelf } from './pages';

const leavesOf = (name: 'none' | 'few' | 'many', layout: 'spread' | 'page' = 'spread', shelf?: PassportShelf) => {
  const book = simulatedPassport(name);
  return buildLeaves(book, shelf ?? shelfOf(book), DENSITY[layout]);
};

describe('the empty book', () => {
  it('opens on a named flyleaf and room for the first journey, with no stamp, counter or empty section', () => {
    const leaves = leavesOf('none');
    expect(leaves.map(leaf => leaf.page.kind)).toEqual(['flyleaf', 'invitation', 'blank', 'endpaper']);
    expect(leaves[0]!.page).toMatchObject({ kind: 'flyleaf', empty: true, holder: { name: 'Juniper Ashdown' } });
    expect(sectionTabs(buildViews(leaves, 'spread')).map(tab => tab.id)).toEqual(['flyleaf']);
  });
});

describe('a few journeys', () => {
  it('keeps every supplied stamp, in the supplied order, with sections only for what exists', () => {
    const leaves = leavesOf('few');
    const stamps = leaves.flatMap(leaf => (leaf.page.kind === 'stamps' ? leaf.page.stamps : []));
    expect(stamps.map(stamp => stamp.id)).toEqual(simulatedPassport('few').stamps.items.map(stamp => stamp.id));
    expect(leaves.some(leaf => leaf.page.kind === 'invitation' || leaf.page.kind === 'more')).toBe(false);
    expect(leaves[0]!.page).toMatchObject({ kind: 'flyleaf', empty: false });
    expect(sectionTabs(buildViews(leaves, 'spread')).map(tab => tab.label)).toEqual(['Flyleaf', 'Journeys', 'Kingdoms', 'Bonds', 'Keepsakes']);
  });

  it('closes on a right-hand endpaper, padding with a blank leaf when needed', () => {
    for (const name of ['none', 'few', 'many'] as const) {
      const leaves = leavesOf(name);
      expect(leaves.length % 2).toBe(0);
      expect(leaves.at(-1)!.page.kind).toBe('endpaper');
    }
  });
});

describe('a well-travelled book', () => {
  it('spreads the first page of 50 stamps over generous pages and ends each paged collection on a leaf that says so', () => {
    const book = simulatedPassport('many');
    expect(book.stamps.items).toHaveLength(50);
    const leaves = leavesOf('many');
    const stampLeaves = leaves.filter(leaf => leaf.page.kind === 'stamps');
    expect(stampLeaves).toHaveLength(Math.ceil(50 / DENSITY.spread.stamps));
    for (const leaf of stampLeaves) expect((leaf.page.kind === 'stamps' ? leaf.page.stamps : []).length).toBeLessThanOrEqual(DENSITY.spread.stamps);
    const more = leaves.filter(leaf => leaf.page.kind === 'more').map(leaf => (leaf.page as { collection: string }).collection);
    expect(more).toEqual(['stamps', 'bonds', 'keepsakes']);
  });

  it('turns to older pages per collection without moving the leaves already read', () => {
    const book = simulatedPassport('many');
    const before = leavesOf('many');
    const next = simulatedPassportPage('many', 'stamps', book.stamps.nextCursor!)!;
    const shelf: PassportShelf = { ...shelfOf(book), stamps: { items: [...book.stamps.items, ...next.items], nextCursor: next.nextCursor } };
    const after = leavesOf('many', 'spread', shelf);
    // Every full page already read stays exactly as it was; only the last, partly filled page gains stamps.
    const fullPages = Math.floor(book.stamps.items.length / DENSITY.spread.stamps);
    const read = (leaves: typeof before) => leaves.filter(leaf => leaf.page.kind === 'stamps').slice(0, fullPages).map(leaf => [leaf.index, leaf.page]);
    expect(read(after)).toEqual(read(before));
    expect(after.filter(leaf => leaf.page.kind === 'stamps').flatMap(leaf => (leaf.page.kind === 'stamps' ? leaf.page.stamps : []))).toHaveLength(book.stamps.items.length + next.items.length);
    // Stamps are fully read now; bonds and keepsakes still page on their own.
    expect(after.filter(leaf => leaf.page.kind === 'more').map(leaf => (leaf.page as { collection: string }).collection)).toEqual(['bonds', 'keepsakes']);
  });

  it('shows a pending or failed read on the leaf, not a finished turn', () => {
    const book = simulatedPassport('many');
    const pending = leavesOf('many', 'spread', { ...shelfOf(book), bonds: { ...book.bonds, pending: true } });
    expect(pending.find(leaf => leaf.page.kind === 'more' && leaf.page.collection === 'bonds')!.page).toMatchObject({ pending: true, failed: false });
    const failed = leavesOf('many', 'spread', { ...shelfOf(book), bonds: { ...book.bonds, failed: true } });
    expect(failed.find(leaf => leaf.page.kind === 'more' && leaf.page.collection === 'bonds')!.page).toMatchObject({ pending: false, failed: true });
  });
});

describe('views and thumb tabs', () => {
  it('starts on the closed cover, pairs leaves in a spread and shows one in the panel', () => {
    const leaves = leavesOf('few');
    const spread = buildViews(leaves, 'spread'), page = buildViews(leaves, 'page');
    expect(spread[0]).toEqual({ kind: 'cover' });
    expect(spread).toHaveLength(1 + leaves.length / 2);
    expect(page).toHaveLength(1 + leaves.length);
    expect(spread.slice(1).every(view => view.kind === 'leaves' && view.leaves.length === 2)).toBe(true);
  });

  it('points every tab at the view where its section starts', () => {
    const views = buildViews(leavesOf('many', 'page'), 'page');
    for (const tab of sectionTabs(views)) {
      const view = views[tab.view]!;
      expect(view.kind === 'leaves' && view.leaves.some(leaf => leaf.section === tab.id)).toBe(true);
      const previous = views[tab.view - 1];
      expect(previous?.kind === 'leaves' && previous.leaves.some(leaf => leaf.section === tab.id)).toBe(false);
    }
  });

  it('tells a screen reader where it is in words, never a tally of records', () => {
    const leaves = leavesOf('few');
    const views = buildViews(leaves, 'spread');
    expect(viewCaption(views[0], leaves.length)).toBe('The closed passport, its cover');
    expect(viewCaption(views[1], leaves.length)).toBe(`Pages 1 and 2 of ${leaves.length}: Flyleaf and Journeys`);
  });
});
