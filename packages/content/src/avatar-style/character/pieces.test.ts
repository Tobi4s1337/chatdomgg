import { describe, expect, it } from 'vitest';
import { AVATAR_LOOK_LIMITS } from '@chatdom/shared';
import { buildCitizen, slotColours } from './build';
import { HELD_SLOTS, SLOTS, type Slot, type VoxelGrid } from './grid';
import { FACE_Z, SKULL, eyeCells, faceX, faceY } from './head';
import { HAND_ZONE, heldCells } from './held';
import { meshCitizen } from './mesh';
import { FACE_PAINTS, FEY_TINTS, SKIN_TONES } from './palette';
import { PORTRAIT_FIXTURES } from './fixtures';
import { PIECE_CARDS, PIECE_IDS, PIECE_KINDS, pieceCard, type PieceKind } from './pieces';
import { checkHarmful } from './safety';
import { earnedOffers, wearPiece } from './earned';
import { SIMULATED_ENTITLEMENTS } from './earned-fixtures';
import {
  BOTTOM_STYLE_IDS, EAR_STYLE_IDS, EARRING_STYLE_IDS, FACE_PAINT_STYLE_IDS, GLASSES_STYLE_IDS, HAIR_STYLE_IDS, HAT_STYLE_IDS,
  HELD_STYLE_IDS, NECKWEAR_STYLE_IDS, OUTER_STYLE_IDS, SHOE_STYLE_IDS, TOP_STYLE_IDS, parseLook, seedLook, type CitizenLook,
} from './recipe';

const fresh = (kind: PieceKind) => PIECE_IDS[kind].filter(id => pieceCard(kind, id)!.isNew);
const garment = <S extends string>(style: S, dye = '#d3202a', accent = '#f6d23c') => ({ style, dye: dye as `#${string}`, pattern: 'plain' as const, accent: accent as `#${string}` });
const hat = (style: (typeof HAT_STYLE_IDS)[number]) => ({ style, colour: '#2d5fd8' as const, trim: '#f6d23c' as const });

/** Varied bodies to dress: the fixtures span skins, hair, eyes and outfits. */
const BODIES: readonly CitizenLook[] = PORTRAIT_FIXTURES.filter((_, i) => i % 3 === 0).map(f => ({ ...f.look, hat: null, earned: { ...f.look.earned, forgedHat: null } }));

/** Puts one piece of a kind on a look. */
function wear(look: CitizenLook, kind: PieceKind, id: string): CitizenLook {
  switch (kind) {
    case 'hat': return { ...look, hat: hat(id as never), earned: { ...look.earned, forgedHat: null } };
    case 'glasses': return { ...look, glasses: { style: id as never, colour: '#1f1d22', lens: '#e9f2ff' } };
    case 'earrings': return { ...look, earrings: { style: id as never, colour: '#e8b54a' } };
    case 'ears': return { ...look, ears: { style: id as never, tint: null } };
    case 'face-paint': return { ...look, facePaint: { style: id as never, colour: FACE_PAINTS[1].hex } };
    case 'held': return { ...look, held: { style: id as never, colour: '#ff6fae' } };
    case 'top': return { ...look, top: garment(id as never, '#43b6ec') };
    case 'outer': return { ...look, outer: garment(id as never, '#5e3a22') };
    case 'bottom': return { ...look, bottom: garment(id as never, '#3a3a40') };
    case 'neckwear': return { ...look, neckwear: { style: id as never, dye: '#d3202a', accent: '#f6d23c' }, earned: { ...look.earned, scarf: null } };
    case 'shoes': return { ...look, shoes: { style: id as never, dye: '#5e3a22' } };
    default: return look;
  }
}

/** The lattice box every citizen stays in, pieces and all: what the portrait and the realm's bounds expect. */
const BOX = { x: [-14, 14], y: [0, 34], z: [-14, 12] } as const;
function expectSound(g: VoxelGrid, look: CitizenLook, label: string): void {
  for (const [[x, y, z], slot] of g.entries()) {
    expect((SLOTS as readonly Slot[]).includes(slot), label).toBe(true);
    const inside = x >= BOX.x[0] && x < BOX.x[1] && y >= BOX.y[0] && y < BOX.y[1] && z >= BOX.z[0] && z < BOX.z[1];
    expect(inside, `${label} at ${x},${y},${z}`).toBe(true);
  }
  expect(meshCitizen(g, slotColours(look)).faces * 2, label).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
}
/** The eyes are drawn and nothing opaque stands in front of them: glass at most. */
function expectEyes(g: VoxelGrid, look: CitizenLook, label: string): void {
  for (const [c, r] of eyeCells(look.eyes.shape, look.eyes.spacing)) {
    expect(g.get(faceX(c), faceY(r), FACE_Z), label).toBe('eye');
    const front = g.get(faceX(c), faceY(r), FACE_Z + 1);
    expect(front === undefined || front === 'lens', `${label}: ${front} in front of an eye`).toBe(true);
  }
}

describe('the second wardrobe', () => {
  it('adds at least sixty new pieces across at least six kinds, and every piece has a card', () => {
    const fresh = PIECE_CARDS.filter(c => c.isNew);
    expect(fresh.length).toBeGreaterThanOrEqual(60);
    expect(new Set(fresh.map(c => c.kind)).size).toBeGreaterThanOrEqual(6);
    const lists: Record<string, readonly string[]> = {
      hat: HAT_STYLE_IDS, glasses: GLASSES_STYLE_IDS, earrings: EARRING_STYLE_IDS, ears: EAR_STYLE_IDS, 'face-paint': FACE_PAINT_STYLE_IDS,
      held: HELD_STYLE_IDS, top: TOP_STYLE_IDS, outer: OUTER_STYLE_IDS, bottom: BOTTOM_STYLE_IDS, neckwear: NECKWEAR_STYLE_IDS, shoes: SHOE_STYLE_IDS,
      hair: HAIR_STYLE_IDS.filter(s => s !== 'bald'),
    };
    for (const [kind, ids] of Object.entries(lists)) for (const id of ids) expect(pieceCard(kind as PieceKind, id), `${kind}:${id}`).toBeDefined();
    for (const kind of PIECE_KINDS) expect(PIECE_IDS[kind].length, kind).toBeGreaterThan(0);
    expect(new Set(PIECE_CARDS.map(c => `${c.kind}:${c.id}`)).size).toBe(PIECE_CARDS.length);
    for (const c of PIECE_CARDS) {
      expect(c.name[0], c.id).toBe(c.name[0]!.toUpperCase());
      // Sentence case: no capital after the first word (beyond a proper noun, of which there are none).
      expect(c.name.slice(1), c.id).toBe(c.name.slice(1).toLowerCase());
      expect(c.story.length, c.id).toBeGreaterThan(20);
      expect(c.story, c.id).not.toMatch(/\n/);
      expect(c.story.length, c.id).toBeLessThan(140);
      expect(['base', 'fun']).toContain(c.tier);
    }
    // The first shelf is the free base set, as it always was.
    expect(PIECE_CARDS.filter(c => !c.isNew).every(c => c.tier === 'base')).toBe(true);
  });

  it('reads every older look to exactly the recipe it had, with no new keys', () => {
    for (const { look } of PORTRAIT_FIXTURES) {
      const parsed = parseLook(JSON.parse(JSON.stringify(look)));
      expect(JSON.stringify(parsed)).toBe(JSON.stringify(look));
      for (const key of ['ears', 'facePaint', 'held']) expect(key in parsed, key).toBe(false);
    }
    // Explicit nulls are read as not worn, and still leave no key behind.
    const nulls = parseLook({ ...PORTRAIT_FIXTURES[0]!.look, ears: null, facePaint: null, held: null });
    expect(JSON.stringify(nulls)).toBe(JSON.stringify(PORTRAIT_FIXTURES[0]!.look));
  });

  it('round-trips the new parts and refuses unknown ones', () => {
    const look: CitizenLook = { ...BODIES[0]!, ears: { style: 'long-fey', tint: FEY_TINTS[1].hex }, facePaint: { style: 'heart', colour: FACE_PAINTS[2].hex }, held: { style: 'teddy', colour: '#a8693a' } };
    expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    expect(parseLook({ ...look, ears: { style: 'pointed' } }).ears).toEqual({ style: 'pointed', tint: null });
    expect(() => parseLook({ ...look, ears: { style: 'cat', tint: null } })).toThrow(/ears/);
    expect(() => parseLook({ ...look, held: { style: 'axe', colour: '#ffffff' } })).toThrow(/held/);
    expect(() => parseLook({ ...look, facePaint: { style: 'full-face', colour: '#ffffff' } })).toThrow(/face paint/);
    expect(() => parseLook({ ...look, held: { style: 'teddy', colour: '#ffffff', glow: 1 } })).toThrow(/Unknown/);
  });

  it('builds every new piece on varied bodies, inside the lattice, the eyes always showing', () => {
    for (const kind of PIECE_KINDS) for (const id of fresh(kind)) for (const body of BODIES) {
      const look = wear(body, kind, id), label = `${kind}:${id} on ${body.hair.style}`;
      const g = buildCitizen(look);
      expectSound(g, look, label);
      expectEyes(g, look, label);
    }
  }, 120000);

  it('wears every new hat over every hair, with fey ears through it', () => {
    for (const style of HAIR_STYLE_IDS) for (const [i, h] of fresh('hat').entries()) {
      const ears = EAR_STYLE_IDS[(i + style.length) % EAR_STYLE_IDS.length]!;
      const look: CitizenLook = { ...BODIES[1]!, hair: { style, colour: '#5a3622' }, beard: null, hat: hat(h as never), ears: { style: ears, tint: null } };
      const g = buildCitizen(look), label = `${style} under ${h} with ${ears} ears`;
      expectSound(g, look, label);
      expectEyes(g, look, label);
      expectEars(g, label);
    }
  }, 120000);

  it('puts every ear style through every hair and every hat, cleanly outside the head on both sides', () => {
    for (const ears of EAR_STYLE_IDS) {
      for (const style of HAIR_STYLE_IDS) {
        const g = buildCitizen({ ...BODIES[2]!, hair: { style, colour: '#1c191c' }, beard: null, hat: null, ears: { style: ears, tint: null } });
        expectEars(g, `${ears} through ${style}`, true);
      }
      for (const h of HAT_STYLE_IDS) for (const style of ['afro', 'long-waves', 'short-crop'] as const) {
        const g = buildCitizen({ ...BODIES[2]!, hair: { style, colour: '#1c191c' }, beard: null, hat: hat(h), ears: { style: ears, tint: FEY_TINTS[0].hex } });
        expectEars(g, `${ears} under ${h} over ${style}`);
      }
    }
  }, 120000);

  it('keeps every toy in the hand, clear of every top, layer, bottom, hair and earned piece', () => {
    const inHand = ([x, y, z]: readonly number[]) => x! >= HAND_ZONE.x[0] && x! <= HAND_ZONE.x[1] && y! >= HAND_ZONE.y[0] && y! <= HAND_ZONE.y[1] && z! >= HAND_ZONE.z[0] && z! <= HAND_ZONE.z[1];
    // A toy is drawn last, so each outfit is built once and every toy is laid against it.
    const check = (outfit: CitizenLook, label: string) => {
      const plain = buildCitizen(outfit);
      for (const toy of HELD_STYLE_IDS) for (const [[x, y, z]] of heldCells(toy)) {
        const under = plain.get(x, y, z);
        // A toy only ever takes the fist's own cells (and a robe's wide cuff), never anything else worn.
        if (under) expect(inHand([x, y, z]), `${toy} with ${label}: toy over ${under} at ${x},${y},${z}`).toBe(true);
      }
    };
    for (const top of TOP_STYLE_IDS) for (const outer of [null, ...OUTER_STYLE_IDS]) {
      check({ ...BODIES[0]!, top: garment(top, '#43b6ec'), outer: outer && garment(outer, '#5e3a22') }, `${top}/${outer}`);
    }
    for (const style of HAIR_STYLE_IDS) for (const bottom of BOTTOM_STYLE_IDS) for (const earrings of EARRING_STYLE_IDS) {
      if ((style.length + earrings.length) % 3) continue;
      check({
        ...BODIES[1]!, hair: { style, colour: '#5a3622' }, bottom: garment(bottom, '#3a3a40'), earrings: { style: earrings, colour: '#e8b54a' },
        neckwear: { style: 'beads', dye: '#d3202a', accent: '#f6d23c' }, earned: { ...BODIES[1]!.earned, scarf: null },
      }, `${style}/${bottom}/${earrings}`);
    }
    // Earned pieces: ribbons and pins on the chest, the raid scarf's tail, a cape and the tenure hood.
    let veteran: CitizenLook = { ...BODIES[0]!, neckwear: null };
    for (const offer of earnedOffers(SIMULATED_ENTITLEMENTS.veteran)) if (offer.piece.family !== 'forgedHat') veteran = wearPiece(veteran, offer.piece);
    expect(veteran.earned.scarf && veteran.earned.pins.length && veteran.earned.hood).toBeTruthy();
    for (const top of TOP_STYLE_IDS) check({ ...veteran, top: garment(top, '#43b6ec') }, `earned on ${top}`);
    for (const { look } of PORTRAIT_FIXTURES) check(look, 'a fixture');
    for (const toy of HELD_STYLE_IDS) {
      const look: CitizenLook = { ...BODIES[2]!, held: { style: toy, colour: '#ff6fae' } };
      const g = buildCitizen(look);
      for (const [[x, y, z], slot] of heldCells(toy)) expect(g.get(x, y, z), toy).toBe(slot);
      for (const [, slot] of heldCells(toy)) expect(HELD_SLOTS, toy).toContain(slot);
      expectSound(g, look, toy);
    }
  }, 120000);

  it('paints faces only on skin, small, never over the eyes or the mouth area, on every skin', () => {
    for (const style of FACE_PAINT_STYLE_IDS) for (const skin of SKIN_TONES) for (const spacing of ['set', 'wide'] as const) {
      const look: CitizenLook = { ...BODIES[0]!, skin: skin.hex, eyes: { shape: 'dot', spacing }, beard: null, moustache: null, facePaint: { style, colour: FACE_PAINTS[3].hex } };
      const g = buildCitizen(look), label = `${style} ${spacing} on ${skin.id}`;
      const paint = [...g.entries()].filter(([, s]) => s === 'paint');
      expect(paint.length, label).toBeGreaterThan(0);
      // Never the whole face: well under half of the face plane.
      expect(paint.length, label).toBeLessThan(24);
      // The mouth area (the middle of the chin row) stays bare.
      expect(paint.every(([[x, y]]) => !(y === faceY(0) && x >= faceX(3) && x <= faceX(4))), label).toBe(true);
      expectEyes(g, look, label);
      expect(checkHarmful(look), label).toEqual([]);
    }
  });
});

/**
 * Ears show on both sides (unless a hat's brim covers them, when they tuck under it entirely), never inside the
 * skull or a hat, and every ear cell touches something, so none floats.
 */
function expectEars(g: VoxelGrid, label: string, mustShow = false): void {
  const ears = [...g.entries()].filter(([, s]) => s === 'ear' || s === 'earDeep' || s === 'earTuft');
  if (mustShow) {
    expect(ears.some(([[x]]) => x < SKULL.x[0] - 1), label).toBe(true);
    expect(ears.some(([[x]]) => x > SKULL.x[1]), label).toBe(true);
  }
  for (const [[x, y, z]] of ears) {
    const inSkull = x >= SKULL.x[0] && x < SKULL.x[1] && y >= SKULL.y[0] && y < SKULL.y[1] && z >= SKULL.z[0] && z < SKULL.z[1];
    expect(inSkull, `${label} at ${x},${y},${z}`).toBe(false);
    const touches = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => g.has(x + dx!, y + dy!, z + dz!));
    expect(touches, `${label}: floating ear cell at ${x},${y},${z}`).toBe(true);
  }
}

describe('checkHarmful', () => {
  const body = { ...BODIES[0]!, hat: null, outer: null };
  const whiteRobe = { ...body, top: garment('robe', '#f3f1ee') };

  it('refuses a white pointed hat with a long white robe or cloak, in a kind sentence', () => {
    for (const style of ['pointed-hat', 'party-cone', 'nightcap'] as const) {
      const look = { ...whiteRobe, hat: { style, colour: '#f3f1ee' as const, trim: '#f6f2e8' as const } };
      const said = checkHarmful(look);
      expect(said, style).toHaveLength(1);
      expect(said[0]).toMatch(/^A white pointed hat is not worn with a long white robe or cloak\./);
      expect(checkHarmful({ ...body, top: garment('tee', '#2d5fd8'), outer: garment('cloak', '#f3f1ee'), hat: look.hat }), style).toHaveLength(1);
      // Any other colour on either side is fine; so is a striped hat with one coloured stripe.
      expect(checkHarmful({ ...look, top: garment('robe', '#2d5fd8') })).toEqual([]);
      expect(checkHarmful({ ...look, hat: { ...look.hat, colour: '#a36bff' } })).toEqual([]);
    }
    expect(checkHarmful({ ...whiteRobe, hat: { style: 'nightcap', colour: '#f3f1ee', trim: '#d3202a' } })).toEqual([]);
    expect(checkHarmful({ ...whiteRobe, hat: { style: 'straw-hat', colour: '#f3f1ee', trim: '#f3f1ee' } })).toEqual([]);
  });

  it('keeps face paint bright, off skin tones and from the paint pot', () => {
    const paint = (colour: `#${string}`) => checkHarmful({ ...body, facePaint: { style: 'cheek-stripes', colour } });
    expect(paint('#1c191c')[0]).toMatch(/^Face paint is never dark/);
    for (const skin of SKIN_TONES) expect(paint(skin.hex)[0], skin.id).toMatch(/^Face paint (never takes a skin tone|is never dark)/);
    expect(paint('#7fffd4')[0]).toMatch(/^Face paint comes from the paint pot/);
    for (const c of FACE_PAINTS) expect(paint(c.hex), c.id).toEqual([]);
  });

  it('refuses coal-black skin, never a real tone', () => {
    expect(checkHarmful({ ...body, skin: '#141414' })[0]).toMatch(/^No one has skin this black/);
    for (const skin of SKIN_TONES) expect(checkHarmful({ ...body, skin: skin.hex }), skin.id).toEqual([]);
  });

  it('passes every piece of both tiers worn alone', () => {
    for (const c of PIECE_CARDS) {
      if (c.kind === 'hair' || c.kind === 'beard' || c.kind === 'moustache' || c.kind === 'flower') continue;
      expect(checkHarmful(wear(body, c.kind, c.id)), `${c.kind}:${c.id}`).toEqual([]);
    }
    for (const tint of FEY_TINTS) expect(checkHarmful({ ...body, ears: { style: 'leaf', tint: tint.hex } })).toEqual([]);
  });

  it('never seeds a look it refuses', () => {
    for (let i = 0; i < 2000; i++) expect(checkHarmful(seedLook(`viewer-${i}`)), `viewer-${i}`).toEqual([]);
  });
});
