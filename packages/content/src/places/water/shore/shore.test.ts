import { describe, expect, it } from 'vitest';
import { MAT, type StyleKey } from '../../../materials';
import { pieceFailures, voxels } from '../piece-checks';
import type { WalkStrip, WaterPiece } from '../place-piece';
import {
  SHORE_BLUEPRINTS, SHORE_PIECES, SHORE_VARIANTS, createFishingRock, createLilies, createPebbles, createReeds,
  createSteppingStones, fishingRockTop, steppingStoneHops,
} from './index';

const STYLES: readonly StyleKey[] = ['hearth', 'tide', 'grove'];
const each = (make: (style: StyleKey, variant: number) => WaterPiece) =>
  STYLES.flatMap(style => SHORE_VARIANTS.map(variant => ({ style, variant, piece: make(style, variant) })));

/** Highest walking height of each column, read through the production rasterizer. */
function heights(piece: WaterPiece) {
  const { at, size: [sx, sy, sz] } = voxels(piece.blueprint);
  const top = (x: number, z: number) => { for (let y = sy - 1; y >= 0; y--) if (at(x, y, z)) return y + 1; return 0; };
  let max = 0;
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) max = Math.max(max, top(x, z));
  return { at, top, max, size: [sx, sy, sz] as const };
}

/** Every occupied cell above the bed rests on another cell, except the materials named (blades that lean). */
function hanging(piece: WaterPiece, leaning: ReadonlySet<number>): number {
  const { at, size: [sx, sy, sz] } = voxels(piece.blueprint);
  let n = 0;
  for (let z = 0; z < sz; z++) for (let y = 1; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = at(x, y, z);
    if (m && !leaning.has(m) && !at(x, y - 1, z)) n++;
  }
  return n;
}

const rect = (w: WalkStrip) => (w.axis === 'z' ? { x: w.across, z: w.along } : { x: w.along, z: w.across });
const centre = (w: WalkStrip) => { const r = rect(w); return { x: (r.x[0] + r.x[1]) / 2, z: (r.z[0] + r.z[1]) / 2 }; };

describe('shore catalogue', () => {
  it('builds every kit and variant of each form with unique ids', () => {
    expect(SHORE_PIECES).toHaveLength(STYLES.length * SHORE_VARIANTS.length * 5);
    const ids = SHORE_BLUEPRINTS.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHORE_BLUEPRINTS).toEqual(SHORE_PIECES.map(p => p.blueprint));
  });

  it('passes the common honesty checks in its own kit palette', () => {
    for (const piece of SHORE_PIECES) {
      const style = STYLES.find(s => piece.blueprint.styleId === s)!;
      expect(pieceFailures(piece, style), piece.blueprint.id).toEqual([]);
      expect(piece.blueprint.windows).toEqual([]);
      expect(Math.max(...piece.blueprint.size)).toBeLessThanOrEqual(256);
    }
  });

  it('is deterministic and gives each variant its own shape', () => {
    const forms = [createReeds, createLilies, createPebbles, (s: StyleKey, v: number) => createFishingRock(s, v, 4),
      (s: StyleKey, v: number) => createSteppingStones(s, v, 4)];
    for (const make of forms) for (const style of STYLES) {
      const shapes = SHORE_VARIANTS.map(v => make(style, v).blueprint);
      expect(make(style, 1).blueprint).toEqual(shapes[1]);
      const plans = shapes.map(b => JSON.stringify([b.size, b.boxes.map(box => [box.from, box.to])]));
      expect(new Set(plans).size, shapes[0]!.id).toBe(3);
    }
  });

  it('refuses unknown kits, variants and depths', () => {
    const bad = 'marble' as StyleKey;
    for (const make of [createReeds, createLilies, createPebbles]) {
      expect(() => make(bad, 0)).toThrow(RangeError);
      for (const v of [-1, 3, 0.5, Number.NaN]) expect(() => make('tide', v)).toThrow(RangeError);
    }
    for (const make of [createFishingRock, createSteppingStones]) {
      expect(() => make(bad, 0, 4)).toThrow(RangeError);
      expect(() => make('tide', 3, 4)).toThrow(RangeError);
      for (const w of [0, 17, 2.5, -4]) expect(() => make('tide', 0, w)).toThrow(RangeError);
    }
    expect(() => fishingRockTop(0, 0)).toThrow(RangeError);
  });
});

describe('reeds', () => {
  it('stand below 1.6 m on crowns that are really there', () => {
    for (const { piece } of each(createReeds)) {
      expect(heights(piece).max * 0.125).toBeLessThan(1.6);
      expect(piece.footings.length).toBeGreaterThanOrEqual(3);
      const { at } = voxels(piece.blueprint);
      for (const { box } of piece.footings) {
        expect(box.from[1]).toBe(0);
        for (let z = box.from[2]; z < box.to[2]; z++) for (let x = box.from[0]; x < box.to[0]; x++) expect(at(x, 0, z)).toBe(MAT.leaf);
      }
      expect(piece.sounds.map(s => s.kind)).toEqual(['reeds']);
    }
  });

  it('carry blue flowers', () => {
    for (const { piece } of each(createReeds)) expect(piece.blueprint.boxes.some(b => b.material === MAT.blueFlower)).toBe(true);
  });
});

describe('lilies', () => {
  it('lay pads that touch but never overlap', () => {
    for (const { piece } of each(createLilies)) {
      const pads = piece.blueprint.boxes.filter(b => b.material !== MAT.air && b.from[1] === 0);
      expect(pads.length).toBeGreaterThan(0);
      for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
        const a = pads[i]!, c = pads[j]!;
        const overlap = a.from[0] < c.to[0] && c.from[0] < a.to[0] && a.from[2] < c.to[2] && c.from[2] < a.to[2];
        expect(overlap, `${piece.blueprint.id}: pads ${i} and ${j}`).toBe(false);
      }
    }
  });

  it('hold their blooms at most two cells proud, standing on a pad', () => {
    for (const { piece } of each(createLilies)) {
      expect(heights(piece).max).toBeLessThanOrEqual(3);
      expect(hanging(piece, new Set())).toBe(0);
      expect(piece.blueprint.boxes.some(b => b.material === MAT.goldLeaf)).toBe(true);
      expect(piece.footings).toEqual([]);
    }
  });
});

describe('pebbles', () => {
  it('lie every stone on the bed, at most three cells tall, with waterweed among them', () => {
    for (const { piece } of each(createPebbles)) {
      // Only the waterweed blades lean; stones, flecks and earth are stacked from y = 0.
      expect(hanging(piece, new Set([MAT.leaf])), piece.blueprint.id).toBe(0);
      const { at, size: [sx, sy, sz] } = voxels(piece.blueprint);
      let stoneTop = 0, weed = false;
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const m = at(x, y, z);
        if (m === MAT.leaf) weed = true;
        else if (m) stoneTop = Math.max(stoneTop, y + 1);
      }
      expect(stoneTop).toBeLessThanOrEqual(3);
      expect(weed).toBe(true);
      expect(piece.footings.every(f => f.box.from[1] === 0)).toBe(true);
    }
  });

  it('mix several tones and sizes with earth between', () => {
    for (const { piece } of each(createPebbles)) {
      const mats = new Set(piece.blueprint.boxes.map(b => b.material));
      expect(mats.has(MAT.earth)).toBe(true);
      expect(mats.has(MAT.cream)).toBe(true);
      expect(mats.has(MAT.darkStone)).toBe(true);
      const bed = piece.blueprint.boxes.filter(b => b.from[1] === 0 && b.material !== MAT.leaf && b.material !== MAT.earth);
      expect(bed.length).toBeGreaterThan(20);
      const tall = new Set(piece.blueprint.boxes.map(b => b.to[1]));
      expect([1, 2, 3].every(h => tall.has(h))).toBe(true);
    }
  });
});

describe('fishing rock', () => {
  const rocks = STYLES.flatMap(style => SHORE_VARIANTS.flatMap(variant => [1, 4, 9, 16].map(water =>
    ({ style, variant, water, piece: createFishingRock(style, variant, water) }))));

  it('passes the honesty checks at every depth', () => {
    for (const { style, piece } of rocks) expect(pieceFailures(piece, style), piece.blueprint.id).toEqual([]);
  });

  it('rises to a flat top three or four cells above the water', () => {
    for (const { variant, water, piece } of rocks) {
      const { max } = heights(piece);
      expect(max - water).toBeGreaterThanOrEqual(3);
      expect(max - water).toBeLessThanOrEqual(4);
      expect(max).toBe(fishingRockTop(variant, water));
      const [walk] = piece.walks;
      expect(piece.walks).toHaveLength(1);
      expect(Math.max(...walk!.tops) - Math.min(...walk!.tops)).toBeLessThanOrEqual(1);
      expect(Math.min(...walk!.tops)).toBeGreaterThanOrEqual(water + 3);
      // A real standing place: at least 0.75 m by 0.75 m.
      expect(walk!.across[1] - walk!.across[0]).toBeGreaterThanOrEqual(6);
      expect(walk!.along[1] - walk!.along[0]).toBeGreaterThanOrEqual(6);
    }
  });

  it('seats its rim over open water, on real top cells', () => {
    for (const { water, piece } of rocks) {
      const { at, top } = heights(piece);
      expect(piece.seats).toHaveLength(1);
      const { box, facing } = piece.seats[0]!;
      expect(facing).toBe('south');
      expect(box.to[0] - box.from[0]).toBeGreaterThanOrEqual(4);
      for (let x = box.from[0]; x < box.to[0]; x++) {
        expect(top(x, box.from[2])).toBe(box.to[1]);
        // The legs hang clear down to the surface in front of the rim.
        for (let y = water; y < box.to[1]; y++) expect(at(x, y, box.to[2])).toBe(0);
      }
      expect(box.to[1] - water).toBeGreaterThanOrEqual(3);
    }
  });

  it('is a boulder, not a box: rounded courses that step in, wet at the foot and mossed in shade', () => {
    for (const { style, water, piece } of rocks) {
      const { at, top, max, size: [sx, , sz] } = heights(piece);
      let bed = 0, crown = 0, x0 = sx, x1 = 0, z0 = sz, z1 = 0;
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        if (at(x, 0, z)) bed++;
        if (top(x, z) >= max - 1) { crown++; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1); }
      }
      expect(crown).toBeLessThan(bed);
      expect(crown / ((x1 - x0) * (z1 - z0))).toBeLessThan(0.92);
      const mats = new Set(piece.blueprint.boxes.map(b => b.material));
      expect(mats.has(MAT.moss)).toBe(true);
      const wet = style === 'grove' ? MAT.bark : MAT.darkStone;
      // The wet tone reaches a cell above the surface somewhere on the rock.
      let wetAbove = false;
      for (let z = 0; z < sz && !wetAbove; z++) for (let x = 0; x < sx; x++) if (at(x, water, z) === wet) { wetAbove = true; break; }
      expect(wetAbove).toBe(true);
    }
  });
});

describe('stepping stones', () => {
  const runs = STYLES.flatMap(style => SHORE_VARIANTS.flatMap(variant => [1, 2, 4, 9, 16].map(water =>
    ({ style, variant, water, piece: createSteppingStones(style, variant, water) }))));

  it('passes the honesty checks at every depth', () => {
    for (const { style, piece } of runs) expect(pieceFailures(piece, style), piece.blueprint.id).toEqual([]);
  });

  it('lays four to six stones, tops one or two cells above the water, hand-sized treads', () => {
    for (const { water, piece } of runs) {
      expect(piece.walks.length).toBeGreaterThanOrEqual(4);
      expect(piece.walks.length).toBeLessThanOrEqual(6);
      for (const w of piece.walks) {
        expect(new Set(w.tops).size).toBe(1);
        expect(w.tops[0]! - water).toBeGreaterThanOrEqual(1);
        expect(w.tops[0]! - water).toBeLessThanOrEqual(2);
        for (const span of [w.across, w.along]) {
          expect(span[1] - span[0]).toBeGreaterThanOrEqual(3);
          expect(span[1] - span[0]).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it('hops over one or two cells of water, rising at most a cell, from the shore out', () => {
    for (const { piece } of runs) {
      for (const hop of steppingStoneHops(piece)) {
        expect(hop.gap).toBeGreaterThanOrEqual(1);
        expect(hop.gap).toBeLessThanOrEqual(2);
        expect(Math.abs(hop.rise)).toBeLessThanOrEqual(1);
      }
      const zs = piece.walks.map(w => centre(w).z);
      expect(zs).toEqual([...zs].sort((a, c) => a - c));
      expect(rect(piece.walks[0]!).z[0]).toBeLessThanOrEqual(3);
    }
  });

  it('curves gently instead of running straight', () => {
    for (const { piece } of runs) {
      const cs = piece.walks.map(centre), first = cs[0]!, last = cs[cs.length - 1]!;
      const off = cs.map(c => Math.abs((c.x - first.x) - (last.x - first.x) * (c.z - first.z) / (last.z - first.z)));
      expect(Math.max(...off), piece.blueprint.id).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < cs.length; i++) expect(Math.abs(cs[i]!.x - cs[i - 1]!.x)).toBeLessThanOrEqual(3);
    }
  });

  it('wets every stone at the waterline and stands it on one submerged ledge', () => {
    for (const { style, water, piece } of runs) {
      const { at, size: [sx, , sz] } = heights(piece);
      const wet = style === 'grove' ? MAT.bark : MAT.darkStone;
      for (const w of piece.walks) {
        const r = rect(w);
        let wetFoot = false;
        for (let z = r.z[0]; z < r.z[1]; z++) for (let x = r.x[0]; x < r.x[1]; x++) if (at(x, water - 1, z) === wet) wetFoot = true;
        expect(wetFoot, `${piece.blueprint.id}/${w.id}`).toBe(true);
      }
      // The bed course is one face-connected ledge under the whole run.
      const seen = new Set<number>(), key = (x: number, z: number) => x + sx * z;
      let start: [number, number] | undefined, total = 0;
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (at(x, 0, z)) { total++; start ??= [x, z]; }
      const queue = [start!];
      seen.add(key(...start!));
      while (queue.length) {
        const [x, z] = queue.pop()!;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          if (at(x + u, 0, z + v) && !seen.has(key(x + u, z + v))) { seen.add(key(x + u, z + v)); queue.push([x + u, z + v]); }
        }
      }
      expect(seen.size).toBe(total);
    }
  });
});
