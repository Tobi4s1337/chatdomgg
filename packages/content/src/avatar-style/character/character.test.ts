import { describe, expect, it } from 'vitest';
import { AVATAR_LOOK_LIMITS, AVATAR_RIG, AVATAR_SOCKETS } from '@chatdom/shared';
import { luma, rgb } from './colour';
import { VoxelGrid } from './grid';
import { EYE_ROW, FACE_Z, SKULL, eyeCells, faceX, faceY, freckleCells } from './head';
import { buildCitizen, slotColours } from './build';
import { hatBrim } from './accessories';
import { HAIR_SLOTS } from './hair-kit';
import { meshCitizen, OCCLUSION_LEVELS } from './mesh';
import { SKIN_TONES } from './palette';
import { PORTRAIT, portraitEye } from './portrait';
import { PORTRAIT_FIXTURES } from './fixtures';
import { ARM, CHEST_Z, LEG, PROUD_Z, TORSO, armX, legX } from './body';
import {
  BEARD_STYLE_IDS, EARRING_STYLE_IDS, EYE_SHAPES, EYE_SPACINGS, FRECKLES, GLASSES_STYLE_IDS, HAIR_STYLE_IDS, HAT_STYLE_IDS,
  BOTTOM_STYLE_IDS, DEFAULT_BOTTOM, DEFAULT_SHOES, MOUSTACHE_STYLE_IDS, NECKWEAR_STYLE_IDS, OUTER_STYLE_IDS, PATTERN_IDS, SHOE_STYLE_IDS,
  TOP_STYLE_IDS, NO_EARNED, parseLook, seedLook, type CitizenLook,
} from './recipe';

/** A plain citizen: short black hair, a sky tee, nothing worn. */
const base: CitizenLook = {
  version: 1, skin: '#b57d4c', eyes: { shape: 'dot', spacing: 'set' }, freckles: 'none', blush: false,
  hair: { style: 'short-crop', colour: '#1c191c' }, beard: null, moustache: null, hat: null, glasses: null, earrings: null, flower: null,
  top: { style: 'tee', dye: '#43b6ec', pattern: 'plain', accent: '#1e1d22' }, outer: null, bottom: DEFAULT_BOTTOM, neckwear: null, shoes: DEFAULT_SHOES, earned: NO_EARNED,
};
const variant = (patch: Partial<CitizenLook>): CitizenLook => ({ ...base, ...patch });
const rest = (id: string): number => {
  let y = 0, at: string | null = id;
  while (at) { const bone = AVATAR_RIG.find(b => b.id === at)!; y += bone.offset[1]; at = bone.parent; }
  return y;
};

describe('the look recipe', () => {
  it('round-trips every fixture and seeded look and refuses anything malformed', () => {
    for (const { look } of PORTRAIT_FIXTURES) expect(parseLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    for (let i = 0; i < 50; i++) expect(parseLook(seedLook(`p${i}`))).toEqual(seedLook(`p${i}`));
    expect(() => parseLook({ ...base, crown: true })).toThrow(/Unknown look field/);
    expect(() => parseLook({ ...base, skin: 'tan' })).toThrow(/colour/);
    expect(() => parseLook({ ...base, hair: { style: 'mullet', colour: '#000000' } })).toThrow(/hair style/);
    expect(() => parseLook({ ...base, version: 2 })).toThrow(/version/);
    expect(() => parseLook({ ...base, hair: { style: 'bob', colour: '#000000', shine: 1 } })).toThrow(/Unknown hair field shine/);
    expect(() => parseLook({ ...base, eyes: { ...base.eyes, lashes: true } })).toThrow(/Unknown eyes field/);
    expect(() => parseLook({ ...base, hat: { style: 'cap', colour: '#ffffff', trim: '#000000', feather: true } })).toThrow(/Unknown hat field/);
    expect(() => parseLook({ ...base, hat: { style: 'crown', colour: '#ffffff', trim: '#000000' } })).toThrow(/hat/);
  });

  it('accepts colours in either case and stores them lower-case', () => {
    const look = parseLook({ ...base, skin: '#C08A6A', hair: { style: 'bob', colour: '#ABCDEF' }, glasses: { style: 'round', colour: '#E8B54A', lens: '#FFB7C4' } });
    expect(look.skin).toBe('#c08a6a');
    expect(look.hair.colour).toBe('#abcdef');
    expect(look.glasses).toEqual({ style: 'round', colour: '#e8b54a', lens: '#ffb7c4' });
  });

  it('reads a look saved before accessories existed as wearing none', () => {
    const older = Object.fromEntries(Object.entries(base).filter(([key]) => !['moustache', 'hat', 'glasses', 'earrings', 'flower'].includes(key)));
    expect(parseLook(older)).toEqual({ ...base, moustache: null, hat: null, glasses: null, earrings: null, flower: null });
  });

  it('seeds a stable, varied default from a person id, beards only with short hair', () => {
    expect(seedLook('person-42')).toEqual(seedLook('person-42'));
    const looks = Array.from({ length: 400 }, (_, i) => seedLook(`viewer-${i}`));
    // Exact repeats are rare; keeping a town free of near-duplicates is the randomiser's job (AS07).
    expect(new Set(looks.map(l => JSON.stringify(l))).size).toBeGreaterThanOrEqual(395);
    for (const style of HAIR_STYLE_IDS) expect(looks.some(l => l.hair.style === style)).toBe(true);
    for (const shape of EYE_SHAPES) expect(looks.some(l => l.eyes.shape === shape)).toBe(true);
    expect(new Set(looks.map(l => l.skin)).size).toBe(SKIN_TONES.length);
    for (const l of looks) if (l.beard) expect(['short-crop', 'side-part', 'quiff', 'slicked', 'spiky', 'side-shave', 'mohawk', 'bald']).toContain(l.hair.style);
    expect(looks.filter(l => l.beard).length).toBeGreaterThan(20);
    for (const style of HAT_STYLE_IDS) expect(looks.some(l => l.hat?.style === style), style).toBe(true);
    for (const style of GLASSES_STYLE_IDS) expect(looks.some(l => l.glasses?.style === style), style).toBe(true);
    for (const style of MOUSTACHE_STYLE_IDS) expect(looks.some(l => l.moustache?.style === style), style).toBe(true);
    for (const style of EARRING_STYLE_IDS) expect(looks.some(l => l.earrings?.style === style), style).toBe(true);
    expect(looks.some(l => l.flower)).toBe(true);
    // A seeded full beard stands apart from the hair, so the two never close into a hood round the face.
    for (const l of looks) if (l.beard?.style === 'full') expect(Math.abs(luma(rgb(l.beard.colour)) - luma(rgb(l.hair.colour)))).toBeGreaterThan(.14);
    // Most of a town goes bare-headed and bare-faced; accessories are what people are remembered by.
    expect(looks.filter(l => l.hat).length / looks.length).toBeLessThan(.3);
  });
});

describe('the head and face', () => {
  it('is an 8-cell cube on the frozen rig: head bone at its base, hat socket on top, face socket on the front', () => {
    const head = rest('head');
    expect(SKULL.y).toEqual([head, head + AVATAR_SOCKETS.hat.offset[1]]);
    expect(SKULL.z[1]).toBe(AVATAR_SOCKETS.face.offset[2]);
    expect(SKULL.x[1] - SKULL.x[0]).toBe(8);
    const g = buildCitizen(variant({ hair: { style: 'bald', colour: '#000000' }, beard: null }));
    // Bald steps its crown in by a cell like a hair slab; below the top row the skull is a full cube.
    for (let x = -4; x < 4; x++) for (let y = 16; y < 23; y++) for (let z = -4; z < 4; z++) expect(g.has(x, y, z)).toBe(true);
    for (let x = -3; x < 3; x++) for (let z = -3; z < 3; z++) expect(g.has(x, 23, z)).toBe(true);
    expect(g.has(-5, 20, 0) || g.has(4, 20, 0) || g.has(0, 24, 0)).toBe(false);
  });

  it('draws two mirror-symmetric eye blocks, never a mouth', () => {
    for (const shape of EYE_SHAPES) for (const spacing of EYE_SPACINGS) {
      const cells = eyeCells(shape, spacing);
      const mirror = new Set(cells.map(([c, r]) => `${7 - c},${r}`));
      expect(cells.every(([c, r]) => mirror.has(`${c},${r}`))).toBe(true);
      expect(cells.every(([c]) => c !== 3 && c !== 4)).toBe(true);
      expect(Math.min(...cells.map(([, r]) => r))).toBe(EYE_ROW);
      for (const freckles of FRECKLES) for (const [c] of freckleCells(freckles, spacing)) expect([3, 4]).not.toContain(c);
    }
  });

  it('never puts a freckle right under an eye, where it would read as a taller eye', () => {
    for (const spacing of EYE_SPACINGS) {
      const under = new Set(eyeCells('dot', spacing).map(([c, r]) => `${c},${r - 1}`));
      for (const freckles of FRECKLES) for (const [c, r] of freckleCells(freckles, spacing)) expect(under.has(`${c},${r}`)).toBe(false);
    }
  });

  it('blinks: the blink frame closes any eye shape', () => {
    const open = buildCitizen(variant({ eyes: { shape: 'tall', spacing: 'set' } }));
    const shut = buildCitizen(variant({ eyes: { shape: 'tall', spacing: 'set' } }), { blink: true });
    expect(open.get(faceX(2), faceY(EYE_ROW + 1), FACE_Z)).toBe('eye');
    expect(shut.get(faceX(2), faceY(EYE_ROW + 1), FACE_Z)).toBe('skin');
    expect(shut.get(faceX(1), faceY(EYE_ROW), FACE_Z)).toBe('eye');
  });
});

describe('hair and beards', () => {
  const every = HAIR_STYLE_IDS.flatMap(style => [null, ...BEARD_STYLE_IDS].flatMap(beard => EYE_SPACINGS.flatMap(spacing => EYE_SHAPES.map(shape =>
    variant({ hair: { style, colour: '#5a3622' }, beard: beard && { style: beard, colour: '#5a3622' }, eyes: { shape, spacing }, freckles: 'full', blush: true })))));

  it('offers at least sixteen styles besides bald, in the spec’s list', () => {
    expect(HAIR_STYLE_IDS.filter(s => s !== 'bald').length).toBeGreaterThanOrEqual(16);
    for (const style of ['curls', 'buns', 'afro', 'ponytail', 'bob', 'long-waves', 'quiff', 'side-shave', 'mohawk', 'braids', 'spiky', 'slicked', 'short-crop', 'bald', 'pigtails', 'wild-tuft'] as const) {
      expect(HAIR_STYLE_IDS).toContain(style);
    }
  });

  it('never covers an eye, and no hair stands in front of the face below the hairline', () => {
    for (const look of every) {
      const g = buildCitizen(look);
      for (const [c, r] of eyeCells(look.eyes.shape, look.eyes.spacing)) expect(g.get(faceX(c), faceY(r), FACE_Z), `${look.hair.style} ${look.eyes.shape}`).toBe('eye');
      for (let x = SKULL.x[0]; x < SKULL.x[1]; x++) for (let y = SKULL.y[0]; y < 21; y++) for (let z = FACE_Z + 1; z < FACE_Z + 5; z++) {
        const at = g.get(x, y, z);
        expect(at && HAIR_SLOTS.includes(at), `${look.hair.style} ${x},${y},${z}`).toBeFalsy();
      }
      // The face rows between the eyes stay skin: no hair paint across the face.
      for (let y = faceY(EYE_ROW); y < 21; y++) for (const x of [faceX(3), faceX(4)]) expect(g.get(x, y, FACE_Z)).toBe('skin');
    }
  });

  it('keeps close styles within a cell of the skull', () => {
    for (const style of ['short-crop', 'bob', 'slicked', 'side-part'] as const) {
      const { min, max } = buildCitizen(variant({ hair: { style, colour: '#1c191c' }, beard: null })).bounds();
      expect(min[0], style).toBeGreaterThanOrEqual(SKULL.x[0] - 1);
      expect(max[0], style).toBeLessThanOrEqual(SKULL.x[1] + 1);
      expect(min[2], style).toBeGreaterThanOrEqual(SKULL.z[0] - 1);
      expect(max[2], style).toBeLessThanOrEqual(SKULL.z[1] + 1);
      expect(max[1], style).toBeLessThanOrEqual(SKULL.y[1] + 2);
    }
  });

  it('gives every style its own silhouette', () => {
    const shapes = HAIR_STYLE_IDS.map(style => {
      const g = buildCitizen(variant({ hair: { style, colour: '#1c191c' }, beard: null }));
      return [...g.entries()].map(([c]) => c.join(',')).join(';');
    });
    expect(new Set(shapes).size).toBe(HAIR_STYLE_IDS.length);
  });

  it('draws moustaches as their own part, proud of the face, never over an eye', () => {
    for (const style of MOUSTACHE_STYLE_IDS) for (const spacing of EYE_SPACINGS) {
      const look = variant({ moustache: { style, colour: '#e0561f' }, beard: { style: 'full', colour: '#1c191c' }, eyes: { shape: 'dot', spacing } });
      const g = buildCitizen(look);
      const cells = [...g.entries()].filter(([, s]) => s === 'stache' || s === 'stacheDeep');
      expect(cells.length, style).toBeGreaterThan(3);
      expect(cells.every(([[, , z]]) => z === FACE_Z + 1)).toBe(true);
      for (const [c, r] of eyeCells('dot', spacing)) expect(g.get(faceX(c), faceY(r), FACE_Z)).toBe('eye');
      expect(slotColours(look).stache).toEqual(rgb('#e0561f'));
    }
  });

  it('stays inside the avatar look limits, the biggest style with a beard, a hat and everything else on', () => {
    for (const look of every) {
      const g = buildCitizen(look);
      expect(g.size).toBeLessThan(AVATAR_LOOK_LIMITS.maxOccupiedCells);
      expect(meshCitizen(g, slotColours(look)).faces * 2).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
    }
    for (const style of HAIR_STYLE_IDS) for (const hat of HAT_STYLE_IDS) {
      const look = variant({
        hair: { style, colour: '#5a3622' }, beard: { style: 'full', colour: '#5a3622' }, moustache: { style: 'handlebar', colour: '#5a3622' },
        hat: { style: hat, colour: '#d3202a', trim: '#f3f1ee' }, glasses: { style: 'goggles', colour: '#55565e', lens: '#3b3546' },
        earrings: { style: 'hoop', colour: '#e8b54a' }, flower: { colour: '#ff4d4d' },
      });
      const g = buildCitizen(look), colours = slotColours(look);
      expect(meshCitizen(g, colours).faces * 2 + meshCitizen(g, colours, 'glass').faces * 2).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
    }
  }, 30000);
});

describe('hats', () => {
  const hatted = HAIR_STYLE_IDS.flatMap(style => HAT_STYLE_IDS.map(hat =>
    variant({ hair: { style, colour: '#5a3622' }, beard: null, hat: { style: hat, colour: '#d3202a', trim: '#f3f1ee' } })));

  it('flattens the hair under the crown: nothing pokes through or stands on top of a hat', () => {
    for (const look of hatted) {
      const g = buildCitizen(look);
      const hatCells = [...g.entries()].filter(([, s]) => s.startsWith('hat'));
      const top = Math.max(...hatCells.map(([[, y]]) => y));
      for (const [[x, y, z], slot] of g.entries()) {
        if (!HAIR_SLOTS.includes(slot)) continue;
        const label = `${look.hair.style} under ${look.hat!.style} at ${x},${y},${z}`;
        expect(y, label).toBeLessThan(top);
        // Over the skull, outside it and above the brim, there is only hat.
        if (x >= SKULL.x[0] && x < SKULL.x[1] && z >= SKULL.z[0] && z < SKULL.z[1]) expect(y < SKULL.y[1] || y < hatBrim(look.hat!.style), label).toBe(true);
      }
    }
  });

  it('sits on the hat socket and keeps the face clear', () => {
    for (const look of hatted) {
      const g = buildCitizen(look);
      for (const [c, r] of eyeCells(look.eyes.shape, look.eyes.spacing)) expect(g.get(faceX(c), faceY(r), FACE_Z)).toBe('eye');
      expect(g.get(0, SKULL.y[1], 0)?.startsWith('hat'), look.hat!.style).toBe(true);
      const lowest = Math.min(...[...g.entries()].filter(([, s]) => s.startsWith('hat')).map(([[, y]]) => y));
      expect(lowest).toBeGreaterThan(faceY(EYE_ROW + 1));
    }
  });

  it('lets tied hair come out from under the brim', () => {
    for (const style of ['ponytail', 'buns'] as const) for (const hat of HAT_STYLE_IDS) {
      const bare = buildCitizen(variant({ hair: { style, colour: '#5a3622' }, beard: null })).bounds();
      const g = buildCitizen(variant({ hair: { style, colour: '#5a3622' }, beard: null, hat: { style: hat, colour: '#d3202a', trim: '#f3f1ee' } }));
      const hair = [...g.entries()].filter(([, s]) => HAIR_SLOTS.includes(s)).map(([c]) => c);
      // Buns still reach past the sides of the head; a tail still hangs behind it.
      if (style === 'buns') expect(Math.min(...hair.map(c => c[0])), hat).toBeLessThan(SKULL.x[0] - 2);
      else expect(Math.min(...hair.map(c => c[2])), hat).toBeLessThan(SKULL.z[0] - 3);
      expect(bare.min[1]).toBeLessThanOrEqual(SKULL.y[0]);
    }
  });
});

describe('glasses, earrings and the flower', () => {
  it('puts see-through lenses in front of both eyes, so the eye blocks still show', () => {
    for (const style of GLASSES_STYLE_IDS) for (const spacing of EYE_SPACINGS) for (const shape of EYE_SHAPES) {
      const look = variant({ eyes: { shape, spacing }, glasses: { style, colour: '#1f1d22', lens: '#e9f2ff' } });
      const g = buildCitizen(look);
      for (const [c, r] of eyeCells(shape, spacing)) {
        expect(g.get(faceX(c), faceY(r), FACE_Z), `${style} ${spacing} ${shape}`).toBe('eye');
        if (shape !== 'closed') expect(g.get(faceX(c), faceY(r), FACE_Z + 1), `${style} ${spacing}`).toBe('lens');
      }
      expect([...g.entries()].some(([, s]) => s === 'frame')).toBe(true);
      // The eyes keep their front faces in the opaque mesh: the lens is not solid to it.
      const solid = meshCitizen(g, slotColours(look));
      const eyeFronts = [...Array(solid.faces).keys()].filter(f => solid.normals[f * 12 + 2] === 1 && solid.positions[f * 12 + 2] === FACE_Z + 1);
      expect(eyeFronts.length).toBeGreaterThan(0);
      const glass = meshCitizen(g, slotColours(look), 'glass');
      expect(glass.faces).toBeGreaterThan(0);
    }
  });

  it('gives each glasses style its own frame', () => {
    const frames = GLASSES_STYLE_IDS.map(style => [...buildCitizen(variant({ glasses: { style, colour: '#1f1d22', lens: '#e9f2ff' } })).entries()]
      .filter(([, s]) => s === 'frame' || s === 'lens').map(([c, s]) => `${c.join(',')}${s}`).join(';'));
    expect(new Set(frames).size).toBe(GLASSES_STYLE_IDS.length);
  });

  it('hangs earrings on both sides, over long hair too', () => {
    for (const style of EARRING_STYLE_IDS) for (const hair of ['short-crop', 'long-waves', 'braids'] as const) {
      const g = buildCitizen(variant({ hair: { style: hair, colour: '#1c191c' }, earrings: { style, colour: '#e8b54a' } }));
      const metal = [...g.entries()].filter(([, s]) => s === 'metal').map(([c]) => c);
      expect(metal.some(c => c[0] < SKULL.x[0]), `${style} ${hair}`).toBe(true);
      expect(metal.some(c => c[0] >= SKULL.x[1]), `${style} ${hair}`).toBe(true);
    }
  });

  it('tucks a flower on the outside of the hair or into a hat band, never inside anything', () => {
    for (const hair of HAIR_STYLE_IDS) for (const hat of [null, ...HAT_STYLE_IDS]) {
      const look = variant({ hair: { style: hair, colour: '#1c191c' }, flower: { colour: '#ff4d4d' }, hat: hat && { style: hat, colour: '#ecd9a6', trim: '#d3202a' } });
      const g = buildCitizen(look);
      const petals = [...g.entries()].filter(([, s]) => s === 'petal');
      expect(petals, `${hair} ${hat}`).toHaveLength(4);
      // Every petal faces open air on the outside (the person's right, toward the portrait camera).
      for (const [[x, y, z]] of petals) expect(g.has(x - 1, y, z), `${hair} ${hat}`).toBe(false);
    }
  });
});

describe('the body', () => {
  it('has a torso narrower than the head, as in the reference', () => {
    expect(TORSO.x[1] - TORSO.x[0]).toBeLessThan(SKULL.x[1] - SKULL.x[0]);
  });

  it('is 24 cells tall with the head a third of it, on the frozen rig’s joints', () => {
    const g = buildCitizen(base), { min, max } = g.bounds();
    expect(min[1]).toBe(0);
    expect(SKULL.y[0]).toBe(rest('head'));
    expect((SKULL.y[1] - SKULL.y[0]) / SKULL.y[1]).toBeCloseTo(1 / 3, 5);
    expect(max[1]).toBeLessThanOrEqual(SKULL.y[1] + 2);
    // Legs hang under the thigh joints, feet on the ground, hips at the pelvis.
    for (const side of [-1, 1] as const) {
      const thigh = AVATAR_RIG.find(b => b.id === (side < 0 ? 'thighLeft' : 'thighRight'))!.offset[0];
      expect(legX(side) + 1).toBe(thigh);
      expect(g.has(legX(side), 0, 0)).toBe(true);
      expect(g.has(armX(side), ARM.y[0], 0)).toBe(true);
    }
    expect(LEG.y[1]).toBeLessThanOrEqual(rest('pelvis'));
    // A gap between the legs and either side of the torso, so a walking stride reads.
    expect(g.has(0, 3, 0)).toBe(false);
    expect(g.has(-1, 3, 0)).toBe(false);
  });
});

describe('the wardrobe', () => {
  const dress = (patch: Partial<CitizenLook>) => variant(patch);
  const garment = <S extends string>(style: S, dye = '#d3202a', pattern: (typeof PATTERN_IDS)[number] = 'plain', accent = '#1e1d22') =>
    ({ style, dye: dye as `#${string}`, pattern, accent: accent as `#${string}` });

  it('reads a look saved before the wardrobe existed as a plain top, trousers and shoes', () => {
    const older = { ...base, top: { style: 'tee', dye: '#43b6ec' } } as Record<string, unknown>;
    for (const key of ['outer', 'bottom', 'neckwear', 'shoes']) delete older[key];
    const look = parseLook(older);
    expect(look.top).toEqual({ style: 'tee', dye: '#43b6ec', pattern: 'plain', accent: '#1e1d22' });
    expect(look.outer).toBeNull();
    expect(look.neckwear).toBeNull();
    expect(look.bottom).toEqual(DEFAULT_BOTTOM);
    expect(look.shoes).toEqual(DEFAULT_SHOES);
    expect(() => parseLook({ ...base, top: { ...base.top, pattern: 'paisley' } })).toThrow(/pattern/);
    expect(() => parseLook({ ...base, top: { ...base.top, sleeves: 'long' } })).toThrow(/Unknown top field sleeves/);
    expect(() => parseLook({ ...base, outer: { style: 'cape', dye: '#ffffff' } })).toThrow(/outer layer/);
    expect(() => parseLook({ ...base, shoes: { style: 'boots', dye: '#ffffff', laces: 1 } })).toThrow(/Unknown shoes field/);
  });

  it('dresses every combination within the look limits, and nothing it wears reaches the head', () => {
    for (const top of TOP_STYLE_IDS) for (const outer of [null, ...OUTER_STYLE_IDS]) for (const bottom of BOTTOM_STYLE_IDS) {
      for (const neckwear of [null, ...NECKWEAR_STYLE_IDS]) {
        const look = dress({
          top: garment(top, '#f3f1ee', 'plaid'), outer: outer && garment(outer, '#2d5fd8', 'dots', '#f6d23c'), bottom: garment(bottom, '#3a3a40', 'stripes'),
          neckwear: neckwear && { style: neckwear, dye: '#d3202a', accent: '#f6d23c' }, shoes: { style: 'boots', dye: '#5e3a22' },
        });
        const g = buildCitizen(look), label = `${top}/${outer}/${bottom}/${neckwear}`;
        expect(meshCitizen(g, slotColours(look)).faces * 2, label).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
        for (const [[, y], slot] of g.entries()) if (/^(top|outer|bottom|neck|shoe|sole|button)/.test(slot)) expect(y, `${label} ${slot}`).toBeLessThan(SKULL.y[0]);
      }
    }
  }, 30000);

  it('wears an outer layer open: proud front panels, and the top showing down the middle', () => {
    for (const outer of OUTER_STYLE_IDS) {
      const g = buildCitizen(dress({ top: garment('tee', '#f3f1ee'), outer: garment(outer, '#d3202a') }));
      for (const x of [-1, 0]) expect(g.get(x, 11, CHEST_Z), outer).toBe('top');
      for (const x of [TORSO.x[0], TORSO.x[1] - 1]) expect(g.get(x, 11, PROUD_Z), outer).toBe('outer');
      expect(g.get(TORSO.x[0], 11, TORSO.z[0]), outer).toBe('outer');
      // A vest leaves the tee's sleeves; the others cover them.
      expect(g.get(armX(-1), 13, 0), outer).toBe(outer === 'vest' ? 'top' : 'outer');
    }
  });

  it('paints patterns on the garment’s own cells only', () => {
    const count = (look: CitizenLook, slot: string) => [...buildCitizen(look).entries()].filter(([, s]) => s === slot).length;
    expect(count(dress({ top: garment('tee', '#f3f1ee', 'plain') }), 'topAccent')).toBe(0);
    expect(count(dress({ top: garment('tee', '#f3f1ee', 'stripes') }), 'topAccent')).toBeGreaterThan(20);
    const plaid = dress({ top: garment('shirt', '#d3202a', 'plaid') });
    expect(count(plaid, 'topAccent')).toBeGreaterThan(8);
    expect(count(plaid, 'topMix')).toBeGreaterThan(count(plaid, 'topAccent'));
    expect(count(dress({ top: garment('tee', '#f3f1ee', 'print') }), 'topAccent')).toBe(4);
    // A patterned top under a plain jacket: the jacket stays plain.
    expect(count(dress({ top: garment('tee', '#f3f1ee', 'stripes'), outer: garment('jacket', '#2d5fd8') }), 'outerAccent')).toBe(0);
  });

  it('gives every bottom and shoe its own shape', () => {
    const shapes = new Set<string>();
    for (const bottom of BOTTOM_STYLE_IDS) for (const shoes of SHOE_STYLE_IDS) {
      const g = buildCitizen(dress({ bottom: garment(bottom, '#2f4f86'), shoes: { style: shoes, dye: '#5e3a22' } }));
      shapes.add([...g.entries()].filter(([[, y]]) => y < SKULL.y[0]).map(([c, s]) => `${c.join(',')}:${s}`).join('|'));
    }
    expect(shapes.size).toBe(BOTTOM_STYLE_IDS.length * SHOE_STYLE_IDS.length);
    // Shorts and skirts show the legs; trousers cover them to the shoe.
    expect(buildCitizen(dress({ bottom: garment('shorts', '#2f4f86') })).get(legX(-1), 3, 0)).toBe('skin');
    expect(buildCitizen(dress({ bottom: garment('trousers', '#2f4f86') })).get(legX(-1), 3, 0)).toBe('bottom');
  });

  it('seeds outfits with layers, patterns and every piece somewhere in a town, layers apart from what they cover', () => {
    const looks = Array.from({ length: 400 }, (_, i) => seedLook(`viewer-${i}`));
    for (const style of TOP_STYLE_IDS) expect(looks.some(l => l.top.style === style), style).toBe(true);
    for (const style of OUTER_STYLE_IDS) expect(looks.some(l => l.outer?.style === style), style).toBe(true);
    for (const style of BOTTOM_STYLE_IDS) expect(looks.some(l => l.bottom.style === style), style).toBe(true);
    for (const style of NECKWEAR_STYLE_IDS) expect(looks.some(l => l.neckwear?.style === style), style).toBe(true);
    for (const style of SHOE_STYLE_IDS) expect(looks.some(l => l.shoes.style === style), style).toBe(true);
    for (const pattern of PATTERN_IDS) expect(looks.some(l => l.top.pattern === pattern || l.outer?.pattern === pattern), pattern).toBe(true);
    const layered = looks.filter(l => l.outer).length / looks.length;
    expect(layered).toBeGreaterThan(.2);
    expect(layered).toBeLessThan(.45);
    for (const l of looks) if (l.outer) expect(l.outer.dye).not.toBe(l.top.dye);
  });
});

describe('colours', () => {
  it('derives every slot from the look and keeps eyes readable on every skin', () => {
    for (const skin of SKIN_TONES) {
      const c = slotColours(variant({ skin: skin.hex }));
      for (const value of Object.values(c)) for (const n of value) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
      expect(luma(c.skin) - luma(c.eye), skin.id).toBeGreaterThan(.12);
      expect(c.blush).not.toEqual(c.skin);
    }
  });

  it('accepts any hair colour, including wild ones', () => {
    const c = slotColours(variant({ hair: { style: 'curls', colour: '#00ff88' } }));
    expect(c.hair).toEqual(rgb('#00ff88'));
    expect(luma(c.hairDeep)).toBeLessThan(luma(c.hair));
  });
});

describe('the mesher', () => {
  const colours = slotColours(base);

  it('bevels only true outer edges and occludes creases', () => {
    const one = meshCitizen(new VoxelGrid().set(0, 0, 0, 'skin'), colours);
    expect(one.faces).toBe(6);
    expect([...one.edges].every(e => e === 1)).toBe(true);
    expect([...one.occlusion].every(o => o === 1)).toBe(true);

    // Two cells side by side: the shared edge of their top faces is coplanar, so neither bevels it.
    const pair = meshCitizen(new VoxelGrid().set(0, 0, 0, 'skin').set(1, 0, 0, 'skin'), colours);
    expect(pair.faces).toBe(10);
    const tops = [...Array(pair.faces).keys()].filter(f => pair.normals[f * 12 + 1] === 1);
    expect(tops).toHaveLength(2);
    expect(tops.map(f => [...pair.edges.slice(f * 16, f * 16 + 4)])).toEqual([[1, 0, 1, 1], [0, 1, 1, 1]]);

    // A step: the lower cell's top face meets a wall, and its corners there are occluded.
    const step = meshCitizen(new VoxelGrid().set(0, 0, 0, 'skin').set(1, 0, 0, 'skin').set(1, 1, 0, 'skin'), colours);
    expect(Math.min(...step.occlusion)).toBeLessThan(1);
    expect(OCCLUSION_LEVELS.some(level => Math.abs(level - Math.min(...step.occlusion)) < 1e-6)).toBe(true);
  });

  it('produces matching attribute arrays', () => {
    const m = meshCitizen(buildCitizen(PORTRAIT_FIXTURES[13]!.look), slotColours(PORTRAIT_FIXTURES[13]!.look));
    const verts = m.faces * 4;
    expect(m.positions.length).toBe(verts * 3);
    expect(m.colours.length).toBe(verts * 3);
    expect(m.occlusion.length).toBe(verts);
    expect(m.faceUv.length).toBe(verts * 2);
    expect(m.edges.length).toBe(verts * 4);
    expect(m.indices.length).toBe(m.faces * 6);
    expect(Math.max(...m.indices)).toBe(verts - 1);
  });
});

describe('the portrait', () => {
  it('looks from the person’s right, a little above, at the face', () => {
    const [x, y, z] = portraitEye();
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(PORTRAIT.camera.target[1]);
    expect(z).toBeGreaterThan(SKULL.z[1]);
    expect(PORTRAIT.camera.target[1]).toBeGreaterThan(SKULL.y[0]);
    expect(PORTRAIT.camera.target[1]).toBeLessThan(SKULL.y[1]);
  });

  it('has twenty fixtures covering the part families, eye variants, freckles, blush and both ends of the skin range', () => {
    const looks = PORTRAIT_FIXTURES.map(f => f.look);
    expect(looks).toHaveLength(20);
    expect(new Set(looks.map(l => l.hair.style)).size).toBeGreaterThanOrEqual(16);
    for (const style of HAT_STYLE_IDS) expect(looks.some(l => l.hat?.style === style), style).toBe(true);
    for (const style of GLASSES_STYLE_IDS) expect(looks.some(l => l.glasses?.style === style), style).toBe(true);
    expect(looks.some(l => l.beard) && looks.some(l => l.moustache) && looks.some(l => l.earrings) && looks.some(l => l.flower)).toBe(true);
    for (const shape of EYE_SHAPES) expect(looks.some(l => l.eyes.shape === shape)).toBe(true);
    for (const spacing of EYE_SPACINGS) expect(looks.some(l => l.eyes.spacing === spacing)).toBe(true);
    for (const freckles of FRECKLES) expect(looks.some(l => l.freckles === freckles)).toBe(true);
    expect(looks.some(l => l.blush)).toBe(true);
    expect(looks.some(l => l.skin === SKIN_TONES[0].hex)).toBe(true);
    expect(looks.some(l => l.skin === SKIN_TONES[SKIN_TONES.length - 1]!.hex)).toBe(true);
    expect(PORTRAIT_FIXTURES.every(f => f.name.startsWith('Simulated'))).toBe(true);
    for (const { look } of PORTRAIT_FIXTURES) expect(parseLook(look)).toEqual(look);
  });
});
