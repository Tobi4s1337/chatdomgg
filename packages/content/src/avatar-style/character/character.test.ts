import { describe, expect, it } from 'vitest';
import { AVATAR_LOOK_LIMITS, AVATAR_RIG, AVATAR_SOCKETS } from '@chatdom/shared';
import { luma, rgb } from './colour';
import { VoxelGrid } from './grid';
import { EYE_ROW, FACE_Z, SKULL, eyeCells, faceX, faceY, freckleCells } from './head';
import { buildCitizen, slotColours } from './build';
import { meshCitizen, OCCLUSION_LEVELS } from './mesh';
import { SKIN_TONES } from './palette';
import { PORTRAIT, portraitEye } from './portrait';
import { PORTRAIT_FIXTURES } from './fixtures';
import { TORSO } from './bust';
import {
  BEARD_STYLE_IDS, EYE_SHAPES, EYE_SPACINGS, FRECKLES, HAIR_STYLE_IDS, parseLook, seedLook, type CitizenLook,
} from './recipe';

const base: CitizenLook = PORTRAIT_FIXTURES[2]!.look;
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
  });

  it('seeds a stable, varied default from a person id, beards only with short hair', () => {
    expect(seedLook('person-42')).toEqual(seedLook('person-42'));
    const looks = Array.from({ length: 400 }, (_, i) => seedLook(`viewer-${i}`));
    // Exact repeats are rare; keeping a town free of near-duplicates is the randomiser's job (AS07).
    expect(new Set(looks.map(l => JSON.stringify(l))).size).toBeGreaterThanOrEqual(395);
    for (const style of HAIR_STYLE_IDS) expect(looks.some(l => l.hair.style === style)).toBe(true);
    for (const shape of EYE_SHAPES) expect(looks.some(l => l.eyes.shape === shape)).toBe(true);
    expect(new Set(looks.map(l => l.skin)).size).toBe(SKIN_TONES.length);
    for (const l of looks) if (l.beard) expect(['short-crop', 'quiff', 'bald']).toContain(l.hair.style);
    expect(looks.filter(l => l.beard).length).toBeGreaterThan(20);
  });
});

describe('the head and face', () => {
  it('is an 8-cell cube on the frozen rig: head bone at its base, hat socket on top, face socket on the front', () => {
    const head = rest('head');
    expect(SKULL.y).toEqual([head, head + AVATAR_SOCKETS.hat.offset[1]]);
    expect(SKULL.z[1]).toBe(AVATAR_SOCKETS.face.offset[2]);
    expect(SKULL.x[1] - SKULL.x[0]).toBe(8);
    const g = buildCitizen(variant({ hair: { style: 'bald', colour: '#000000' }, beard: null }));
    for (let x = -4; x < 4; x++) for (let y = 16; y < 24; y++) for (let z = -4; z < 4; z++) expect(g.has(x, y, z)).toBe(true);
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

  it('never covers an eye, and nothing stands in front of the face below the hairline', () => {
    for (const look of every) {
      const g = buildCitizen(look);
      for (const [c, r] of eyeCells(look.eyes.shape, look.eyes.spacing)) expect(g.get(faceX(c), faceY(r), FACE_Z), `${look.hair.style} ${look.eyes.shape}`).toBe('eye');
      for (let x = SKULL.x[0]; x < SKULL.x[1]; x++) for (let y = SKULL.y[0]; y < 21; y++) for (let z = FACE_Z + 1; z < FACE_Z + 5; z++) expect(g.has(x, y, z), `${look.hair.style} ${x},${y},${z}`).toBe(false);
      // The face rows between the eyes stay skin: no hair paint across the face.
      for (let y = faceY(EYE_ROW); y < 21; y++) for (const x of [faceX(3), faceX(4)]) expect(g.get(x, y, FACE_Z)).toBe('skin');
    }
  });

  it('keeps close styles within a cell of the skull', () => {
    for (const style of ['short-crop', 'bob'] as const) {
      const { min, max } = buildCitizen(variant({ hair: { style, colour: '#1c191c' }, beard: null })).bounds();
      expect(min[0]).toBeGreaterThanOrEqual(SKULL.x[0] - 1);
      expect(max[0]).toBeLessThanOrEqual(SKULL.x[1] + 1);
      expect(min[2]).toBeGreaterThanOrEqual(SKULL.z[0] - 1);
      expect(max[2]).toBeLessThanOrEqual(SKULL.z[1] + 1);
      expect(max[1]).toBeLessThanOrEqual(SKULL.y[1] + 2);
    }
  });

  it('gives every style its own silhouette', () => {
    const shapes = HAIR_STYLE_IDS.map(style => {
      const g = buildCitizen(variant({ hair: { style, colour: '#1c191c' }, beard: null }));
      return [...g.entries()].map(([c]) => c.join(',')).join(';');
    });
    expect(new Set(shapes).size).toBe(HAIR_STYLE_IDS.length);
  });

  it('stays inside the avatar look limits, the biggest style with a beard included', () => {
    for (const look of every) {
      const g = buildCitizen(look);
      expect(g.size).toBeLessThan(AVATAR_LOOK_LIMITS.maxOccupiedCells);
      expect(meshCitizen(g, slotColours(look)).faces * 2).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
    }
  });
});

describe('the bust', () => {
  it('has a torso narrower than the head, as in the reference', () => {
    expect(TORSO.x[1] - TORSO.x[0]).toBeLessThan(SKULL.x[1] - SKULL.x[0]);
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

  it('has twenty fixtures covering every style, beard, eye variant, freckles, blush and both ends of the skin range', () => {
    const looks = PORTRAIT_FIXTURES.map(f => f.look);
    expect(looks).toHaveLength(20);
    for (const style of HAIR_STYLE_IDS) expect(looks.some(l => l.hair.style === style)).toBe(true);
    for (const beard of BEARD_STYLE_IDS) expect(looks.some(l => l.beard?.style === beard)).toBe(true);
    for (const shape of EYE_SHAPES) expect(looks.some(l => l.eyes.shape === shape)).toBe(true);
    for (const spacing of EYE_SPACINGS) expect(looks.some(l => l.eyes.spacing === spacing)).toBe(true);
    for (const freckles of FRECKLES) expect(looks.some(l => l.freckles === freckles)).toBe(true);
    expect(looks.some(l => l.blush)).toBe(true);
    expect(looks.some(l => l.skin === SKIN_TONES[0].hex)).toBe(true);
    expect(looks.some(l => l.skin === SKIN_TONES[SKIN_TONES.length - 1]!.hex)).toBe(true);
    expect(PORTRAIT_FIXTURES.every(f => f.name.startsWith('Simulated'))).toBe(true);
  });
});
