import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS } from '@chatdom/content';
import {
  FIRE_FLAME_BASE, PROP_LATTICE_METRES as M, createClearingGround, createFireRing, createGameLantern, createMagistrateSeat, createRock,
  createSeatLog, createTree, createUndergrowth, type CampfireProp,
} from './props';

const registered = new Set(MATERIALS.materials.map(m => m.id));
const at = ({ asset }: CampfireProp, x: number, y: number, z: number) => {
  const [sx, sy, sz] = asset.size;
  return x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? MAT.air : asset.voxels[x + sx * (y + sy * z)]!;
};
/** The top face of the highest solid cell in a column, or -1 for an empty column. */
const topOf = (p: CampfireProp, x: number, z: number) => { for (let y = p.asset.size[1] - 1; y >= 0; y--) if (at(p, x, y, z) !== MAT.air) return y + 1; return -1; };
const solid = (p: CampfireProp) => p.asset.voxels.reduce((n, m) => n + (m === MAT.air ? 0 : 1), 0);
const same = (a: CampfireProp, b: CampfireProp) => a.asset.id === b.asset.id && a.asset.size.join() === b.asset.size.join() && a.asset.voxels.every((m, i) => m === b.asset.voxels[i]);

const FACTORIES: Record<string, (seed: number) => CampfireProp> = {
  'log short': seed => createSeatLog({ length: .6, seatTop: .1, seed }),
  'log long': seed => createSeatLog({ length: 2.6, seatTop: .3, seed }),
  'log mid': seed => createSeatLog({ length: 1.7, seatTop: .22, seed }),
  magistrate: seed => createMagistrateSeat({ seatTop: .42, seed }),
  hearth: createFireRing,
  lantern: createGameLantern,
  ...Object.fromEntries(([0, 1, 2, 3, 4] as const).map(v => [`tree ${v}`, (seed: number) => createTree(v, seed)])),
  ...Object.fromEntries(([0, 1, 2] as const).map(v => [`rock ${v}`, (seed: number) => createRock(v, seed)])),
  ...Object.fromEntries((['fern', 'grass', 'flowers', 'mushrooms'] as const).map(k => [k, (seed: number) => createUndergrowth(k, seed)])),
  ground: seed => createClearingGround({ radius: 10.5, path: { direction: .7, width: 1.1 }, hearthRadius: 1.2, seed }),
};

// Trees and the floor sweep a few hundred thousand cells each; leave room on a busy host.
describe('campfire clearing props', { timeout: 60_000 }, () => {
  for (const [name, make] of Object.entries(FACTORIES)) it(`${name}: a sound, registered, deterministic build-lattice asset`, () => {
    const a = make(7), b = make(7), c = make(8);
    const [sx, sy, sz] = a.asset.size;
    expect(a.asset.lattice).toBe('build');
    expect(a.asset.voxels.length).toBe(sx * sy * sz);
    expect(Math.max(sx, sy, sz)).toBeLessThanOrEqual(1000);
    expect([...new Set(a.asset.voxels)].filter(m => !registered.has(m))).toEqual([]);
    expect(solid(a)).toBeGreaterThan(0);
    expect(same(a, b)).toBe(true);
    expect(same(a, c)).toBe(false);
    for (const o of a.occluders) for (let i = 0; i < 3; i++) expect(o.max[i]!).toBeGreaterThan(o.min[i]!);
  });

  it('honours the seat height of every log exactly, at every length', () => {
    for (const length of [.6, 1.1, 1.75, 2.6]) for (const seatTop of [.1, .17, .25, .3]) for (const seed of [1, 2, 3]) {
      const log = createSeatLog({ length, seatTop, seed });
      expect(log.seatTop).toBe(seatTop);
      const cx = Math.floor(log.anchor[0]), cz = Math.floor(log.anchor[2]);
      for (const x of [cx - 1, cx]) for (const z of [cz - 1, cz]) expect(Math.abs((topOf(log, x, z) - log.anchor[1]) * M - seatTop)).toBeLessThan(1e-9);
      expect(Math.abs(log.asset.size[0] * M - length)).toBeLessThanOrEqual(.2);
      expect(log.anchor[0]).toBeCloseTo(log.asset.size[0] / 2);
    }
  });

  it('honours the magistrate seat height on the front of the seat, clear of the backrest and drape', () => {
    for (const seatTop of [.155, .3, .375, .42, .5]) for (const seed of [1, 4]) {
      const seat = createMagistrateSeat({ seatTop, seed });
      expect(seat.seatTop).toBe(seatTop);
      const cx = Math.floor(seat.anchor[0]), cz = Math.floor(seat.anchor[2]);
      for (const x of [cx - 1, cx]) for (const z of [cz, cz + 1]) expect(Math.abs((topOf(seat, x, z) - seat.anchor[1]) * M - seatTop)).toBeLessThan(1e-9);
      // The backrest rises behind the sitter (−Z), not in front.
      expect(topOf(seat, cx, cz - 2) - seat.anchor[1]).toBeGreaterThan(seatTop / M + 2);
      expect(seat.asset.size[0] * M).toBeLessThan(1.3);
    }
  });

  it('grounds logs, stones and trees below ground level', () => {
    const sunk = (p: CampfireProp) => p.asset.voxels.some((m, i) => m !== MAT.air && Math.floor(i / p.asset.size[0]) % p.asset.size[1] < p.anchor[1]);
    for (const p of [createSeatLog({ length: 1.4, seatTop: .3, seed: 2 }), createMagistrateSeat({ seatTop: .4, seed: 2 }), createFireRing(2),
      ...([0, 1, 2, 3, 4] as const).map(v => createTree(v, 2)), ...([0, 1, 2] as const).map(v => createRock(v, 2))]) expect(sunk(p), p.asset.id).toBe(true);
  });

  it('keeps the crib open above 0.15 m where the flame is drawn, over a glowing bed', () => {
    for (const seed of [1, 2, 3, 9]) {
      const ring = createFireRing(seed), [ax, ay, az] = ring.anchor, [sx, sy, sz] = ring.asset.size;
      let checked = 0;
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        if (Math.hypot(x + .5 - ax, z + .5 - az) * M > .1) continue;
        for (let y = 0; y < sy; y++) if ((y + .5 - ay) * M > .15) { expect(at(ring, x, y, z)).toBe(MAT.air); checked++; }
        expect([MAT.forgeCopper, MAT.fabricOrange, MAT.darkStone]).toContain(at(ring, x, Math.round(ay + FIRE_FLAME_BASE[1] / M) - 1, z));
      }
      expect(checked).toBeGreaterThan(0);
      expect((sy - ay) * M).toBeLessThanOrEqual(.45 + 1e-9);
      expect(Math.max(sx, sz) * M / 2).toBeLessThanOrEqual(.9);
    }
  });

  it('puts the lantern flame in air between four brass posts, open for its pane, low at the feet', () => {
    for (const seed of [1, 2, 5]) {
      const lantern = createGameLantern(seed), c = lantern.anchor.map((v, i) => Math.floor(v + lantern.flame[i]! / M)) as [number, number, number];
      expect(at(lantern, ...c)).toBe(MAT.air);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(at(lantern, c[0] + dx, c[1], c[2] + dz)).toBe(MAT.air);
      for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) expect(at(lantern, c[0] + dx, c[1], c[2] + dz)).toBe(MAT.brass);
      expect(at(lantern, c[0], c[1] - 2, c[2])).toBe(MAT.brass);
      expect(at(lantern, c[0], c[1] + 1, c[2])).toBe(MAT.brass);
      // Below a seated face: the whole lantern stands under 0.65 m.
      expect((lantern.asset.size[1] - lantern.anchor[1]) * M).toBeLessThanOrEqual(.65);
      // The pane fills the open courses inside the posts' outer faces.
      expect(lantern.pane.size[0]).toBeLessThan(3 * M); expect(lantern.pane.size[1]).toBeCloseTo(2 * M);
    }
  });

  it('keeps the clearing floor exactly at ground level inside four metres', () => {
    for (const seed of [1, 2]) {
      const ground = createClearingGround({ radius: 10.5, path: { direction: seed, width: 1.2 }, hearthRadius: 1.3, seed }), [ax, ay, az] = ground.anchor;
      let columns = 0;
      for (let z = 0; z < ground.asset.size[2]; z++) for (let x = 0; x < ground.asset.size[0]; x++) {
        if (Math.hypot(x + .5 - ax, z + .5 - az) * M >= 4) continue;
        expect(topOf(ground, x, z)).toBe(ay);
        expect(at(ground, x, ay - 3, z)).not.toBe(MAT.air);
        columns++;
      }
      expect(columns).toBeGreaterThan(3000);
      expect(ground.asset.size[0] * M).toBeGreaterThan(20);
    }
  });

  it('keeps every tree within its solid budget and casts a trunk and a canopy', () => {
    for (const v of [0, 1, 2, 3, 4] as const) {
      const tree = createTree(v, 3), height = (tree.asset.size[1] - tree.anchor[1]) * M;
      expect(solid(tree)).toBeLessThan(60_000);
      expect(height).toBeGreaterThan(([4.5, 4.5, 6, 3.2, 1.6] as const)[v]);
      expect(height).toBeLessThan(([6.2, 6.6, 7.2, 4, 2.4] as const)[v]);
      expect(tree.occluders.length).toBeGreaterThan(0);
    }
  });
});
