import { describe, expect, it } from 'vitest';
import { PassportBondSchema, PassportBookSchema, PassportKeepsakeSchema, PassportStampSchema, PassportVisitSchema } from '@chatdom/shared/passport';
// The craft entry has no JSX or CSS, so Vitest can read it without the Solid compiler. `@chatdom/ui/passport` re-exports
// all of it; until the package exposes `./passport/craft` (needs: in progress), the test reaches it by path.
import { PASSPORT_FIXTURE_NAMES, simulatedPassport, simulatedPassportPage, simulatedRevision, type PassportCollection } from '../../../../packages/ui/src/passport/craft';

const ITEM = { stamps: PassportStampSchema, kingdoms: PassportVisitSchema, bonds: PassportBondSchema, keepsakes: PassportKeepsakeSchema } as const;
const COLLECTIONS: readonly PassportCollection[] = ['stamps', 'kingdoms', 'bonds', 'keepsakes'];

/** Every record of one collection, reached only by following its own cursors. */
function readAll(name: (typeof PASSPORT_FIXTURE_NAMES)[number], collection: PassportCollection) {
  const book = simulatedPassport(name);
  const items: unknown[] = [...book[collection].items];
  let cursor = book[collection].nextCursor, pages = 1;
  while (cursor) {
    const page = simulatedPassportPage(name, collection, cursor);
    expect(page, `${name}/${collection} at ${cursor}`).not.toBeNull();
    expect(page!.items.length).toBeGreaterThan(0);
    expect(page!.items.length).toBeLessThanOrEqual(50);
    for (const item of page!.items) expect(ITEM[collection].safeParse(item).success).toBe(true);
    items.push(...page!.items);
    cursor = page!.nextCursor; pages++;
  }
  return { items, pages };
}

describe('the three SIMULATED books', () => {
  it('pass the frozen passport schema as visible, simulated books and never claim to be live', () => {
    for (const name of PASSPORT_FIXTURE_NAMES) {
      const parsed = PassportBookSchema.parse(simulatedPassport(name));
      expect(parsed).toMatchObject({ version: 1, origin: 'simulated', visibility: 'visible', revision: simulatedRevision(name) });
    }
  });

  it('hold no raids, three raids and eighty-four raids across several kingdoms', () => {
    const raids = (name: (typeof PASSPORT_FIXTURE_NAMES)[number]) => (readAll(name, 'stamps').items as { kind: string; kingdom: { kingdomId: string } }[]).filter(stamp => stamp.kind === 'raid');
    expect(raids('none')).toHaveLength(0);
    expect(raids('few')).toHaveLength(3);
    const many = raids('many');
    expect(many).toHaveLength(84);
    expect(new Set(many.map(stamp => stamp.kingdom.kingdomId)).size).toBeGreaterThanOrEqual(8);
  });

  it('page each collection independently, at most 50 records a page, with stable unique IDs', () => {
    const pages = Object.fromEntries(COLLECTIONS.map(collection => [collection, readAll('many', collection).pages]));
    expect(pages).toEqual({ stamps: 2, kingdoms: 1, bonds: 2, keepsakes: expect.any(Number) });
    expect(pages.keepsakes).toBeGreaterThanOrEqual(2);
    const stamps = readAll('many', 'stamps').items as { id: string }[];
    expect(new Set(stamps.map(stamp => stamp.id)).size).toBe(stamps.length);
    expect(readAll('many', 'stamps')).toEqual(readAll('many', 'stamps'));
  });

  it('refuses a cursor it never issued instead of inventing a page', () => {
    expect(simulatedPassportPage('many', 'stamps', 'sim:bonds:8')).toBeNull();
    expect(simulatedPassportPage('many', 'stamps', 'sim:stamps:9999')).toBeNull();
    expect(simulatedPassportPage('many', 'stamps', 'live:stamps:50')).toBeNull();
    expect(simulatedPassportPage('none', 'stamps', 'sim:stamps:0')).toBeNull();
    // In range, but never issued: issued cursors sit on page boundaries only.
    expect(simulatedPassportPage('many', 'stamps', 'sim:stamps:7')).toBeNull();
    expect(simulatedPassportPage('many', 'bonds', 'sim:bonds:9')).toBeNull();
    expect(simulatedPassportPage('many', 'stamps', 'sim:stamps:050')).toBeNull();
    expect(simulatedPassportPage('many', 'stamps', 'sim:stamps:50')).not.toBeNull();
  });

  it('draw roads that end at the stamped kingdom and leave leaders unknown when the fixture has none', () => {
    const stamps = readAll('many', 'stamps').items as { kind: string; road?: { to: string }; kingdom: { kingdomId: string }; leader?: unknown }[];
    for (const stamp of stamps.filter(stamp => stamp.kind === 'raid')) expect(stamp.road!.to).toBe(stamp.kingdom.kingdomId);
    expect(stamps.some(stamp => stamp.kind === 'raid' && stamp.leader === null)).toBe(true);
  });
});
