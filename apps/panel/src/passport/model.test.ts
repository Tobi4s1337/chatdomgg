import { describe, expect, it } from 'vitest';
import { buildLeaves, buildViews, sectionTabs, shelfOf, simulatedPassport } from '../../../../packages/ui/src/passport/craft';
import { PANEL_DENSITY, simulatedOrigin } from './model';

describe('the passport in the panel', () => {
  it('keeps one stamp to a leaf, so a long history becomes more leaves, never smaller words', () => {
    const book = simulatedPassport('many');
    if (book.visibility !== 'visible') throw new Error('the many fixture is visible');
    const leaves = buildLeaves(book, shelfOf(book), PANEL_DENSITY);
    const stamps = leaves.filter(leaf => leaf.page.kind === 'stamps');
    expect(stamps).toHaveLength(book.stamps.items.length);
    expect(stamps.every(leaf => leaf.page.kind === 'stamps' && leaf.page.stamps.length === 1)).toBe(true);
    // Records stay in the authority's order, one after another.
    expect(stamps.map(leaf => leaf.page.kind === 'stamps' ? leaf.page.stamps[0]!.id : '')).toEqual(book.stamps.items.map(stamp => stamp.id));
    for (const leaf of leaves) {
      if (leaf.page.kind === 'kingdoms') expect(leaf.page.visits.length).toBeLessThanOrEqual(3);
      if (leaf.page.kind === 'bonds') expect(leaf.page.bonds.length).toBeLessThanOrEqual(3);
      if (leaf.page.kind === 'keepsakes') expect(leaf.page.keepsakes.length).toBeLessThanOrEqual(3);
    }
    // Every section can be reached by its thumb tab; the loaded journeys end on a leaf that says more are further back.
    expect(sectionTabs(buildViews(leaves, 'page')).map(tab => tab.id)).toEqual(['flyleaf', 'stamps', 'kingdoms', 'bonds', 'keepsakes']);
    expect(leaves.some(leaf => leaf.page.kind === 'more' && leaf.page.collection === 'stamps')).toBe(true);
  });

  it('opens an empty book on its flyleaf and room for the first journey, with nothing to jump to', () => {
    const book = simulatedPassport('none');
    if (book.visibility !== 'visible') throw new Error('the none fixture is visible');
    const leaves = buildLeaves(book, shelfOf(book), PANEL_DENSITY);
    expect(leaves.map(leaf => leaf.page.kind)).toEqual(['flyleaf', 'invitation', 'blank', 'endpaper']);
    expect(sectionTabs(buildViews(leaves, 'page')).map(tab => tab.id)).toEqual(['flyleaf']);
  });

  it('marks the view SIMULATED whenever the surface or the book says so, and only then', () => {
    const many = simulatedPassport('many');
    if (many.visibility !== 'visible') throw new Error('the many fixture is visible');
    const visible = { kind: 'visible', book: many, shelf: shelfOf(many) } as const;
    expect(simulatedOrigin(visible, false)).toBe(true);
    expect(simulatedOrigin({ ...visible, book: { ...many, origin: 'live' } }, false)).toBe(false);
    expect(simulatedOrigin({ kind: 'hidden', origin: 'simulated' }, false)).toBe(true);
    expect(simulatedOrigin({ kind: 'hidden', origin: 'live' }, false)).toBe(false);
    expect(simulatedOrigin({ kind: 'pending' }, false)).toBe(false);
    expect(simulatedOrigin({ kind: 'unavailable', cause: 'malformed' }, true)).toBe(true);
  });
});
