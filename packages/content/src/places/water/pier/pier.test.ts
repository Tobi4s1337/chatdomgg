import { describe, expect, it } from 'vitest';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { meshCost, occupiedIn, pieceFailures, unsupported, voxels, walkFailures } from '../piece-checks';
import { PIER, PIER_BLUEPRINTS, PIER_PIECES, PIER_REVIEW_SITE, createPier, type Pier, type PierSite } from './index';

const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];
const SLOW = 120_000;
const site = PIER_REVIEW_SITE;
const pier = createPier('tide', site);
const head = pier.modules.find(m => m.role === 'head')!;

/** Walking tops of every strip along the walk, in pier-local cells relative to the deck top, by pier-local z. */
function deckProfile(p: Pier): Map<number, number> {
  const tops = new Map<number, number>();
  for (const m of p.modules) for (const walk of m.piece.walks) {
    if (walk.axis !== 'z') continue;
    walk.tops.forEach((top, i) => tops.set(m.offset[2] + walk.along[0] + i, top + m.offset[1]));
  }
  return tops;
}

describe('the lake pier', () => {
  it('every module of every kit is an honest supported piece within its budgets', () => {
    expect(PIER_PIECES).toHaveLength(STYLE_KEYS.length * pier.modules.length);
    expect(new Set(PIER_BLUEPRINTS.map(b => b.id)).size).toBe(PIER_BLUEPRINTS.length);
    for (const style of STYLE_KEYS) for (const module of createPier(style, site).modules) {
      const b = module.piece.blueprint;
      expect(pieceFailures(module.piece, style), b.id).toEqual([]);
      expect(b.size.every(v => v <= 256), b.id).toBe(true);
      expect(b.boxes.length, b.id).toBeLessThanOrEqual(1000);
      expect(b.kind).toBe('civic');
      expect(b.windows).toEqual([]);
      // Support also holds from the declared footings alone: nothing leans on the y = 0 datum that is not a footing.
      expect(unsupported(b, module.piece.footings.map(f => f.box.from)), b.id).toBe(0);
    }
  }, SLOW);

  it('is the land site: a 24 m walk 2.5 m wide to an 8×4 m T-head, the deck 0.7 m over the water', () => {
    const [root, ...rest] = pier.modules;
    expect(root!.role).toBe('root');
    expect(rest.at(-1)!.role).toBe('head');
    expect(pier.modules.filter(m => m.role === 'bay')).toHaveLength(5);
    for (const m of pier.modules.filter(m => m.role !== 'head')) {
      expect(m.offset[0]).toBe(0);
      expect(m.piece.blueprint.size[0]).toBe(PIER.walkWidth);
    }
    expect(head.offset[0]).toBe(PIER.head.x[0]);
    expect(head.offset[2]).toBe(site.walk);
    expect(head.piece.blueprint.size[0]).toBe(PIER.head.x[1] - PIER.head.x[0]);
    expect(head.offset[2] + head.piece.blueprint.size[2]).toBe(site.walk + PIER.head.depth);
    // Modules tile the walk end to end without gaps or overlaps.
    let z = 0;
    for (const m of pier.modules) { expect(m.offset[2]).toBe(z); z += m.piece.blueprint.size[2]; }
  });

  it('walks continuously from the bank onto the head: one strip per module, steps of one cell, level at the head', () => {
    const profile = deckProfile(pier);
    for (let z = 0; z < site.walk + PIER.head.depth - 2; z++) expect(profile.has(z), `column ${z}`).toBe(true);
    for (let z = 1; z < site.walk + PIER.head.depth - 2; z++) expect(Math.abs(profile.get(z)! - profile.get(z - 1)!), `step at ${z}`).toBeLessThanOrEqual(1);
    for (let z = site.walk; z < site.walk + PIER.head.depth - 2; z++) expect(profile.get(z)).toBe(0);
    for (const m of pier.modules) for (const walk of m.piece.walks) expect(walkFailures(m.piece.blueprint, walk, PIER.headroom), `${m.id}/${walk.id}`).toEqual([]);
  });

  it('sags a cell between some bents but never at one', () => {
    const profile = deckProfile(pier);
    const sagged = [...profile].filter(([, top]) => top === -1).map(([z]) => z);
    expect(sagged.length).toBeGreaterThan(0);
    for (const bent of pier.bents) for (const z of [bent, bent + 1]) if (profile.has(z)) expect(profile.get(z), `bent ${bent}`).toBe(0);
  });

  it('meets a bank below or above the deck with one short ramp, and refuses a step the land does not allow', () => {
    const below = deckProfile(createPier('tide', { ...site, depth: (x, z) => z < 8 ? 3 : site.depth(x, z) }));
    expect(below.get(0)).toBe(-3);
    const above = deckProfile(createPier('tide', { ...site, depth: (x, z) => z < 8 ? -3 : site.depth(x, z) }));
    expect(above.get(0)).toBe(3);
    expect(above.get(9)).toBe(0);
    expect(() => createPier('tide', { ...site, depth: (x, z) => z < 8 ? -6 : site.depth(x, z) })).toThrow(RangeError);
  });

  it('stands its piles on the sampled bed, sunk at most a cell, weeded at the waterline', () => {
    let piles = 0;
    for (const m of pier.modules) for (const f of m.piece.footings) {
      if (!f.id.startsWith('pile') && !f.id.startsWith('bollard')) continue;
      piles++;
      const cx = m.offset[0] + (f.box.from[0] + f.box.to[0]) / 2, cz = m.offset[2] + (f.box.from[2] + f.box.to[2]) / 2;
      const bottom = m.offset[1] + f.box.from[1], bed = -site.depth(cx, cz);
      expect(bottom, `${m.id}/${f.id}`).toBeLessThanOrEqual(bed);
      expect(bottom, `${m.id}/${f.id}`).toBeGreaterThan(bed - 1);
      // Waterweed: moss on the pile where the lake's surface meets it.
      const line = Math.floor(-site.freeboard) - m.offset[1];
      if (line > f.box.from[1]) expect(occupiedIn(m.piece.blueprint, { from: [f.box.from[0], line - 1, f.box.from[2]], to: [f.box.to[0], line + 1, f.box.to[2]] })
        .some(([, , , mat]) => mat === MAT.moss), `${m.id}/${f.id}`).toBe(true);
    }
    expect(piles).toBeGreaterThanOrEqual(24);
    expect(pier.piles.length).toBe(piles);
  });

  it('has one missing plank on the head, open to the water below and outside every walk strip', () => {
    const { at } = voxels(head.piece.blueprint), deck = -head.offset[1] - 1;
    const gaps: [number, number][] = [];
    for (let x = 1; x < head.piece.blueprint.size[0] - 1; x++) for (let z = 0; z < head.piece.blueprint.size[2]; z++) if (!at(x, deck, z)) gaps.push([x, z]);
    expect(gaps.length).toBeGreaterThan(8);
    for (const [x, z] of gaps) {
      for (const walk of head.piece.walks) {
        const [a, c] = walk.axis === 'z' ? [z, x] : [x, z];
        const inside = a >= walk.along[0] && a < walk.along[1] && c >= walk.across[0] && c < walk.across[1];
        expect(inside, `gap ${x},${z} in ${walk.id}`).toBe(false);
      }
    }
    // Each walk-length strip's planks are whole: the only gap in the deck is that one board.
    expect(new Set(gaps.map(([, z]) => Math.floor((z + head.offset[2]) / 2))).size).toBe(1);
  });

  it('ends in a seat edge over open water, a six-metre bell post and a lantern lit only by the host', () => {
    const b = head.piece.blueprint, { at, size } = voxels(b);
    const [seat] = head.piece.seats;
    expect(seat!.facing).toBe('south');
    expect(seat!.box.to[2]).toBe(size[2]);
    // The sitter's legs hang clear: nothing in front of the edge, and the seat's top is the deck.
    expect(seat!.box.to[1]).toBe(-head.offset[1]);
    for (let x = seat!.box.from[0]; x < seat!.box.to[0]; x++) for (let y = seat!.box.to[1]; y < seat!.box.to[1] + 12; y++) expect(at(x, y, size[2] - 1)).toBe(MAT.air);
    // The post rises six metres over the deck and carries the gilded finial and brass bell.
    expect(size[1] + head.offset[1]).toBeGreaterThanOrEqual(PIER.pole);
    const tops = occupiedIn(b, { from: [0, -head.offset[1] + PIER.pole, 0], to: [size[0], size[1], size[2]] });
    expect(tops.some(([, , , m]) => m === MAT.goldLeaf)).toBe(true);
    const [lamp] = head.piece.emitters;
    expect(lamp!.reach).toBe(32);
    expect(at(Math.floor(lamp!.position[0]), Math.floor(lamp!.position[1]), Math.floor(lamp!.position[2]))).toBe(MAT.glass);
    expect(lamp!.position[1] + head.offset[1]).toBeGreaterThan(PIER.headroom);
    // Mooring rings stand above the water at both wing ends.
    for (const mount of head.piece.mounts) expect(mount.position[1] + head.offset[1]).toBeGreaterThan(-site.freeboard);
    expect(head.piece.mounts.map(m => m.id).sort()).toEqual(['mooring-east', 'mooring-west']);
  });

  it('hangs a name board over its foot for the caller, facing the landing and clear of the walk', () => {
    const root = pier.modules[0]!, [text] = root.piece.texts;
    expect(text!.facing).toBe('north');
    expect(text!.width).toBeGreaterThanOrEqual(12);
    const { at } = voxels(root.piece.blueprint);
    const [cx, cy, cz] = text!.centre;
    for (let dx = -text!.width / 2; dx < text!.width / 2; dx++) for (let dy = -text!.height / 2; dy < text!.height / 2; dy++) {
      expect(at(Math.floor(cx + dx), Math.floor(cy + dy), cz)).toBe(STYLES.tide.wall);
      expect(at(Math.floor(cx + dx), Math.floor(cy + dy), cz - 1)).toBe(MAT.air);
    }
  });

  it('rises and dips along its rail rather than running ruler-straight', () => {
    const heights = new Set<number>();
    for (const m of pier.modules.filter(m => m.role !== 'head')) {
      const { at, size } = voxels(m.piece.blueprint);
      for (let z = 0; z < size[2]; z++) {
        let top = -1;
        for (let y = size[1] - 1; y >= 0 && top < 0; y--) if (at(PIER.walkWidth - 1, y, z)) top = y;
        if (top >= 0) heights.add(top + m.offset[1]);
      }
    }
    expect(heights.size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic and refuses impossible sites', () => {
    expect(JSON.stringify(createPier('grove', site))).toBe(JSON.stringify(createPier('grove', site)));
    const bad: Partial<PierSite>[] = [{ walk: 191 }, { walk: 64 }, { freeboard: 3 }, { freeboard: 9 }, { seed: 0.5 }];
    for (const change of bad) expect(() => createPier('tide', { ...site, ...change })).toThrow(RangeError);
    expect(() => createPier('marble' as StyleKey, site)).toThrow(RangeError);
  });

  it('records its production mesher cost', () => {
    const rows = pier.modules.map(m => ({ id: m.id, boxes: m.piece.blueprint.boxes.length, ...meshCost(m.piece.blueprint) }));
    const total = rows.reduce((sum, r) => ({ boxes: sum.boxes + r.boxes, occupied: sum.occupied + r.occupied, triangles: sum.triangles + r.triangles }), { boxes: 0, occupied: 0, triangles: 0 });
    console.log(JSON.stringify({ modules: rows.length, total, rows }));
    expect(total.triangles).toBeLessThan(40_000);
  }, SLOW);
});
