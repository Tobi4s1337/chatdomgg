import { describe, expect, it } from 'vitest';
import { AVATAR_LOOK_LIMITS } from '@chatdom/shared';
import { buildCitizen, slotColours } from './build';
import { meshCitizen } from './mesh';
import { SKULL, FACE_Z } from './head';
import { HAIR_SLOTS } from './hair-kit';
import { PORTRAIT_FIXTURES } from './fixtures';
import { MOTIF_GLYPHS, capeCut, ribbonMarks } from './earned-draw';
import {
  NO_ENTITLEMENTS, checkEarned, earnedOffers, isWorn, monthMark, takeOffPiece, tenureGarb, wearPiece, wornIn, type CitizenEntitlements,
} from './earned';
import { SIMULATED_ENTITLEMENTS, SIMULATED_KINGDOM } from './earned-fixtures';
import { favouriteDye, twitchDefaultLook, withFavouriteDye } from './defaults';
import { NEAR_DUPLICATE, lookDistance, nearest, randomLook, settleLook } from './variety';
import { DYES } from './palette';
import { FORGED_MOTIFS, HAIR_STYLE_IDS, NO_EARNED, parseLook, seedLook, seededRandom, type CitizenLook } from './recipe';

const veteran: CitizenEntitlements = SIMULATED_ENTITLEMENTS.veteran;
const base = PORTRAIT_FIXTURES[4]!.look;
/** A look wearing every unlocked piece the veteran has, the last offer of each family winning its slot. */
const everything = (look: CitizenLook = base) => earnedOffers(veteran).filter(o => o.unlocked).reduce((l, o) => wearPiece(l, o.piece), look);

describe('earned pieces in the recipe', () => {
  it('round-trips earned pieces and reads an older look as wearing none', () => {
    const look = everything();
    expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    const { earned, ...older } = look;
    expect(earned.pins.length).toBe(2);
    expect(parseLook(older).earned).toEqual(NO_EARNED);
  });

  it('refuses malformed earned pieces', () => {
    const look = everything();
    const bad = (patch: Record<string, unknown>) => () => parseLook({ ...look, earned: { ...look.earned, ...patch } });
    expect(bad({ crown: true })).toThrow(/Unknown earned field/);
    expect(bad({ ribbons: { months: 5 } })).toThrow(/month mark/);
    expect(bad({ pins: [...look.earned.pins, { kind: 'founder', id: 'founder.x' }] })).toThrow(/At most 2/);
    expect(bad({ pins: [{ kind: 'founder', id: 'a' }, { kind: 'founder', id: 'a' }] })).toThrow(/same pin/);
    expect(bad({ pins: [{ kind: 'keepsake', id: 'k', shape: 'heater', colours: ['#000000'] }] })).toThrow(/two colours/);
    expect(bad({ cape: { kind: 'bits', id: 'x', cloth: '#000000', lining: '#000000', trim: '#000000' } })).toThrow(/Unknown cape/);
    expect(() => parseLook({ ...look, hat: { style: 'cap', colour: '#000000', trim: '#000000' } })).toThrow(/hat or a forged hat/);
    expect(() => parseLook({ ...look, neckwear: { style: 'tie', dye: '#000000', accent: '#ffffff' } })).toThrow(/raid scarf/);
  });
});

describe('earned pieces on the lattice', () => {
  it('stays inside the look limits with everything earned on, on every fixture', () => {
    for (const { name, look } of PORTRAIT_FIXTURES) {
      const worn = everything({ ...look, hat: null, neckwear: null });
      const g = buildCitizen(worn), colours = slotColours(worn);
      expect(g.size, name).toBeLessThan(AVATAR_LOOK_LIMITS.maxOccupiedCells);
      expect(meshCitizen(g, colours).faces * 2 + meshCitizen(g, colours, 'glass').faces * 2, name).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
    }
  });

  it('keeps every body piece below the head and off the face', () => {
    for (const offer of earnedOffers(veteran)) {
      if (offer.piece.family === 'forgedHat' || offer.piece.family === 'cape') continue;
      const before = buildCitizen(base), after = buildCitizen(wearPiece(base, offer.piece));
      for (const [[x, y, z], slot] of after.entries()) {
        if (before.get(x, y, z) === slot) continue;
        expect(y, `${offer.key} at ${x},${y},${z}`).toBeLessThan(SKULL.y[0]);
      }
    }
  });

  it('puts two pins side by side without overlapping, both standing proud of the clothes', () => {
    const look = everything();
    const g = buildCitizen(look);
    const cells = (prefix: string) => [...g.entries()].filter(([, s]) => s.startsWith(prefix)).map(([c]) => c);
    const [one, two] = [cells('pin1'), cells('pin2')];
    expect(one.length).toBeGreaterThan(3);
    expect(two.length).toBeGreaterThan(3);
    const xs = (c: readonly (readonly number[])[]) => c.map(p => p[0]!);
    expect(Math.max(...xs(one))).toBeLessThan(Math.min(...xs(two)));
  });

  it('draws the month ribbons from the marks reached, the newest last', () => {
    expect(ribbonMarks(1)).toEqual([1]);
    expect(ribbonMarks(12)).toEqual([9, 12]);
    expect(monthMark(0)).toBeNull();
    expect(monthMark(38)).toBe(36);
    const one = slotColours(wearPiece(base, { family: 'ribbons', value: { months: 1 } }));
    expect(one.ribbon1).toEqual(one.ribbon2);
    const look = wearPiece(base, { family: 'ribbons', value: { months: 3 } });
    const colours = slotColours(look);
    expect(colours.ribbon1).not.toEqual(colours.ribbon2);
    const cells = [...buildCitizen(look).entries()].filter(([, s]) => s.startsWith('ribbon')).map(([c]) => c);
    expect(cells).toHaveLength(2);
    // On the left lapel, clear of an open layer's middle columns.
    expect(cells.every(([x]) => x >= 1)).toBe(true);
  });

  it('wears a forged hat like a hat: hair flattened under it, the motif on the front, every motif different', () => {
    const glyphs = new Set(FORGED_MOTIFS.map(m => MOTIF_GLYPHS[m].join('/')));
    expect(glyphs.size).toBe(FORGED_MOTIFS.length);
    for (const style of HAIR_STYLE_IDS) {
      const look = wearPiece({ ...base, hair: { ...base.hair, style } }, { family: 'forgedHat', value: { id: 'f', motif: 'sleeping-fox', colours: ['#f58a1f', '#f3f1ee'] } });
      const g = buildCitizen(look);
      const top = Math.max(...[...g.entries()].filter(([, s]) => s.startsWith('hat')).map(([c]) => c[1]));
      for (const [[, y], slot] of g.entries()) if (HAIR_SLOTS.includes(slot)) expect(y, style).toBeLessThanOrEqual(top);
      expect([...g.entries()].some(([c, s]) => s === 'forgeMetal' && c[2] > FACE_Z), style).toBe(true);
    }
  });

  it('cuts capes within the frozen cloth limits, the rainbow shimmering and dimmed when lapsed', () => {
    for (const offer of earnedOffers(veteran)) {
      if (offer.piece.family !== 'cape') continue;
      const cut = capeCut(offer.piece.value);
      expect(cut.width).toBeGreaterThanOrEqual(.32);
      expect(cut.width).toBeLessThanOrEqual(.95);
      expect(cut.length).toBeLessThanOrEqual(.95);
      expect(!!cut.shimmer).toBe(offer.piece.value.kind === 'rainbow');
    }
    const rainbow = earnedOffers(veteran).find(o => o.key === 'cape:rainbow')!.piece.value as NonNullable<CitizenLook['earned']['cape']>;
    expect(capeCut(rainbow, true).shimmer!.strength).toBeLessThan(capeCut(rainbow).shimmer!.strength);
  });

  it('dims sub pieces after a lapse without taking them away', () => {
    const look = wearPiece(base, { family: 'ribbons', value: { months: 12 } });
    expect(slotColours(look, { subLapsed: true }).ribbon2).not.toEqual(slotColours(look).ribbon2);
  });
});

describe('earning', () => {
  it('shows a newcomer every earned item, all locked, each saying how it is earned', () => {
    const offers = earnedOffers(SIMULATED_ENTITLEMENTS.newcomer);
    expect(offers.every(o => !o.unlocked && o.earnedBy.length > 20)).toBe(true);
    const families = new Set(offers.map(o => o.piece.family));
    expect([...families].sort()).toEqual(['cape', 'forgedHat', 'hood', 'pin', 'ribbons', 'scarf']);
    expect(offers.map(o => o.key)).toEqual(expect.arrayContaining(['ribbons', 'hood', 'pin:keepsake', 'pin:forged', 'forgedHat', 'scarf', 'cape:cheer', 'cape:tier-cloak', 'cape:rainbow', 'pin:founder']));
    expect(offers.find(o => o.key === 'hood')!.progress).toEqual({ have: 0, need: 12, unit: 'months' });
  });

  it('never lets a locked preview be saved', () => {
    const preview = earnedOffers(SIMULATED_ENTITLEMENTS.newcomer).reduce((l, o) => wearPiece(l, o.piece), base);
    expect(checkEarned(preview, SIMULATED_ENTITLEMENTS.newcomer).length).toBeGreaterThan(4);
    expect(wornIn(preview, SIMULATED_ENTITLEMENTS.newcomer).earned).toEqual(NO_EARNED);
  });

  it('accepts exactly what the records allow and refuses a recoloured keepsake', () => {
    const look = everything();
    expect(checkEarned(look, veteran)).toEqual([]);
    const pin = look.earned.pins.find((p): p is Exclude<typeof p, { kind: 'founder' }> => p.kind !== 'founder');
    if (!pin) throw new Error('The veteran wears a keepsake or forged pin.');
    const recoloured = { ...look, earned: { ...look.earned, pins: look.earned.pins.map(p => (p === pin ? { ...pin, colours: ['#ff00ff', '#00ff00'] as const } : p)) } };
    expect(checkEarned(recoloured, veteran)).toHaveLength(1);
  });

  it('leaves Bound sub and tenure pieces at home and lets keepsakes and moment drops travel', () => {
    const look = everything();
    const abroad: CitizenEntitlements = { ...veteran, kingdom: { id: 'elsewhere', name: 'Elsewhere', colours: ['#3fae4a', '#f3f1ee'] }, followedMonths: 0, sub: null, founder: false };
    const worn = wornIn(look, abroad);
    expect(worn.earned.ribbons).toBeNull();
    expect(worn.earned.hood).toBeNull();
    expect(worn.earned.pins.every(p => p.kind !== 'founder')).toBe(true);
    expect(worn.earned.scarf).toEqual(look.earned.scarf);
    expect(worn.earned.forgedHat).toEqual(look.earned.forgedHat);
  });

  it('wears and takes off pieces, keeping slots exclusive and at most two pins', () => {
    const offers = earnedOffers(veteran).filter(o => o.unlocked);
    const hatted = { ...base, hat: { style: 'cap' as const, colour: '#d3202a' as const, trim: '#f3f1ee' as const } };
    const forged = offers.find(o => o.piece.family === 'forgedHat')!;
    expect(wearPiece(hatted, forged.piece).hat).toBeNull();
    const pins = offers.filter(o => o.piece.family === 'pin');
    expect(pins.length).toBeGreaterThan(3);
    const pinned = pins.reduce((l, o) => wearPiece(l, o.piece), base);
    expect(pinned.earned.pins).toHaveLength(2);
    expect(isWorn(pinned, pins[pins.length - 1]!)).toBe(true);
    expect(isWorn(pinned, pins[0]!)).toBe(false);
    expect(takeOffPiece(pinned, pins[pins.length - 1]!.piece).earned.pins).toHaveLength(1);
  });

  it('marks lapsed sub pieces dim and says so', () => {
    const offers = earnedOffers(SIMULATED_ENTITLEMENTS.lapsed);
    const rainbow = offers.find(o => o.key === 'cape:rainbow')!;
    expect(rainbow.unlocked && rainbow.dim).toBe(true);
    expect(rainbow.story).toMatch(/lapsed/);
  });
});

describe('defaults from Twitch', () => {
  it('turns Twitch name colours into strong dyes, never a grey for a coloured name', () => {
    const greys = new Set(['#f3f1ee', '#3a3a40', '#1e1d22', '#8d8e94', '#d9c49b']);
    for (const name of ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F']) {
      const dye = favouriteDye(name)!;
      expect(DYES.some(d => d.hex === dye), name).toBe(true);
      expect(greys.has(dye), `${name} → ${dye}`).toBe(false);
    }
    expect(favouriteDye('#0000FF')).toBe('#2d5fd8');
    expect(favouriteDye(null)).toBeNull();
    expect(favouriteDye('blue')).toBeNull();
  });

  it('wears the favourite dye on what is seen first', () => {
    const layered: CitizenLook = { ...base, outer: { style: 'jacket', dye: '#3fae4a', pattern: 'plain', accent: '#f3f1ee' } };
    expect(withFavouriteDye(layered, '#d3202a').outer!.dye).toBe('#d3202a');
    expect(withFavouriteDye({ ...base, outer: null }, '#d3202a').top.dye).toBe('#d3202a');
  });

  it('gives a newcomer a seeded look in their colour, and a veteran their tenure garb', () => {
    const fresh = twitchDefaultLook({ personId: 'twitch:1234', nameColour: '#1E90FF', entitlements: SIMULATED_ENTITLEMENTS.newcomer });
    expect(fresh).toEqual(twitchDefaultLook({ personId: 'twitch:1234', nameColour: '#1E90FF', entitlements: SIMULATED_ENTITLEMENTS.newcomer }));
    expect((fresh.outer ?? fresh.top).dye).toBe(favouriteDye('#1E90FF'));
    expect(fresh.earned).toEqual(NO_EARNED);
    const garbed = twitchDefaultLook({ personId: 'twitch:99', nameColour: null, entitlements: veteran });
    expect(garbed.earned.ribbons).toEqual({ months: 36 });
    expect(garbed.earned.hood).not.toBeNull();
    expect(garbed.earned.cape?.kind).toBe('rainbow');
    expect(checkEarned(garbed, veteran)).toEqual([]);
    expect(parseLook(JSON.parse(JSON.stringify(garbed)))).toEqual(garbed);
    expect(tenureGarb(base, NO_ENTITLEMENTS(SIMULATED_KINGDOM)).earned).toEqual(NO_EARNED);
  });
});

describe('a town without near-twins', () => {
  it('settles two hundred people with no two reading as the same person', () => {
    const town: CitizenLook[] = [];
    for (let i = 0; i < 200; i++) town.push(settleLook(`person-${i}`, town));
    let closest = Infinity;
    for (let i = 0; i < town.length; i++) for (let j = i + 1; j < town.length; j++) closest = Math.min(closest, lookDistance(town[i]!, town[j]!));
    expect(closest).toBeGreaterThanOrEqual(NEAR_DUPLICATE);
    // Settling is stable: the same person in the same town gets the same look.
    expect(settleLook('person-7', town.slice(0, 7))).toEqual(town[7]);
  });

  it('scores a recolour as closer than a new haircut, and a look as identical to itself', () => {
    const a = base;
    expect(lookDistance(a, a)).toBe(0);
    const recoloured: CitizenLook = { ...a, top: { ...a.top, dye: '#f58a1f' } };
    const recut = { ...a, hair: { ...a.hair, style: a.hair.style === 'afro' ? 'bob' as const : 'afro' as const } };
    expect(lookDistance(a, recut)).toBeGreaterThan(lookDistance(a, { ...a, top: { ...a.top, dye: a.top.dye } }));
    expect(nearest(a, [recoloured, recut])).toBeLessThan(lookDistance(a, recut) + 3);
  });

  it('rolls a fresh look that keeps what was earned and stands apart', () => {
    const current = everything();
    const town = Array.from({ length: 40 }, (_, i) => seedLook(`n-${i}`));
    const rolled = randomLook(seededRandom('dice'), current, town);
    expect(rolled.earned).toEqual(current.earned);
    expect(rolled.hat).toBeNull();
    expect(nearest(rolled, [...town, current])).toBeGreaterThanOrEqual(NEAR_DUPLICATE);
    expect(() => parseLook(rolled)).not.toThrow();
  });
});
