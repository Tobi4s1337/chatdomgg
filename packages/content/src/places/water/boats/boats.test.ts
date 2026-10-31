import { describe, expect, it } from 'vitest';
import { MAT, type StyleKey } from '../../../materials';
import { meshCost, occupiedIn, pieceFailures, unsupported, voxels } from '../piece-checks';
import type { WaterPiece } from '../place-piece';
import { wood } from '../millrace/craft';
import { sheer, TAR } from './hull';
import {
  BOAT_BLUEPRINTS, BOAT_PIECES, BOAT_VARIANTS, HULL, HULL_PAINT, ROWING_BOAT, UPTURNED_BOAT, createRowingBoat,
  createUpturnedBoat, type BoatVariant,
} from './index';

const STYLE_KEYS = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];
const SLOW = 120_000;
const styleOf = (p: WaterPiece) => STYLE_KEYS.find(s => p.blueprint.styleId === s)!;
const ROWING = BOAT_PIECES.filter(p => !p.blueprint.id.includes('upturned'));
const UPTURNED = BOAT_PIECES.filter(p => p.blueprint.id.includes('upturned'));
const [W, , L] = ROWING_BOAT.size;
const MID = HULL.centre;

/** The outermost occupied column on each side of a station, over all heights: the plan's breadth there. */
function breadth(at: (x: number, y: number, z: number) => number, z: number, height: number, width: number): number {
  let x0 = Infinity, x1 = -Infinity;
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (at(x, y, z)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  return x1 >= x0 ? x1 - x0 + 1 : 0;
}

describe('boats', () => {
  it('every piece is honest and cheap: schema, palette, support, footings, budgets', () => {
    expect(BOAT_PIECES).toHaveLength(12);
    expect(new Set(BOAT_PIECES.map(p => p.blueprint.id)).size).toBe(12);
    expect(BOAT_BLUEPRINTS).toEqual(BOAT_PIECES.map(p => p.blueprint));
    const report: string[] = [];
    for (const piece of BOAT_PIECES) {
      const b = piece.blueprint;
      // A rowing boat's keel is its ground: every cell reaches the y = 0 keel through face neighbours.
      expect(pieceFailures(piece, styleOf(piece)), b.id).toEqual([]);
      expect(b.kind).toBe('prop');
      expect(b.lattice).toBe('build');
      expect(b.windows).toEqual([]);
      expect(b.boxes.length, b.id).toBeLessThan(400);
      const cost = meshCost(b);
      expect(cost.triangles, b.id).toBeLessThan(15_000);
      report.push(`${b.id}: ${b.boxes.length} boxes, ${cost.occupied} cells, ${cost.triangles} triangles`);
    }
    console.info(report.join('\n'));
    expect(ROWING.map(p => p.blueprint.id)).toEqual(STYLE_KEYS.flatMap(s => BOAT_VARIANTS.map(v => `water-boat-${s}-${v}`)));
    expect(UPTURNED.map(p => p.blueprint.id)).toEqual(['water-boat-upturned-hearth-0', 'water-boat-upturned-tide-1', 'water-boat-upturned-grove-2']);
  }, SLOW);

  it('is deterministic and refuses unknown kits and variants', () => {
    expect(JSON.stringify(createRowingBoat('tide', 2))).toBe(JSON.stringify(createRowingBoat('tide', 2)));
    expect(JSON.stringify(createUpturnedBoat('grove', 1))).toBe(JSON.stringify(createUpturnedBoat('grove', 1)));
    for (const create of [createRowingBoat, createUpturnedBoat]) {
      expect(() => create('ocean' as StyleKey, 0)).toThrow(RangeError);
      for (const v of [3, -1, 1.5, Number.NaN]) expect(() => create('hearth', v as BoatVariant)).toThrow(RangeError);
    }
  });

  describe.each(ROWING.map(p => [p.blueprint.id, p] as const))('%s', (_, piece) => {
    const style = styleOf(piece), variant = Number(piece.blueprint.id.at(-1)) as BoatVariant;
    const { at, size } = voxels(piece.blueprint);
    const paint = HULL_PAINT[style][variant];

    it('is 3.5 m from transom to stem and about 1.4 m in the beam, keel on y = 0', () => {
      expect(size).toEqual([...ROWING_BOAT.size]);
      expect(ROWING_BOAT.length * 0.125).toBe(3.5);
      expect(ROWING_BOAT.beam).toBe(W);
      expect([10, 11]).toContain(W);
      // The transom closes z = 0 and the stem fills z = 27: the hull uses its whole length and its whole beam.
      expect(breadth(at, 0, size[1], W)).toBeGreaterThan(4);
      expect(breadth(at, L - 1, size[1], W)).toBe(1);
      expect(Math.max(...Array.from({ length: L }, (_, z) => breadth(at, z, size[1], W)))).toBe(W);
      // The keel runs on the ground for most of the length and lifts clear at both ends: a rockered keel.
      const grounded = Array.from({ length: L }, (_, z) => at(MID, 0, z) !== 0);
      expect(grounded.filter(Boolean).length).toBeGreaterThan(L / 2);
      expect(grounded[0]).toBe(false);
      expect(grounded[L - 1]).toBe(false);
      expect(ROWING_BOAT.draft).toBe(2);
    });

    it('tapers to a pointed bow in plan and rises to bow and stern in its sheer', () => {
      const widths = Array.from({ length: L }, (_, z) => breadth(at, z, size[1], W));
      const forward = widths.slice(Math.floor((2 * L) / 3));
      // Through the forward third every station is no wider than the one behind it, ending in the one-cell stem.
      forward.forEach((w, i) => { if (i) expect(w, `station ${i}`).toBeLessThanOrEqual(forward[i - 1]!); });
      expect(forward[0]).toBeLessThan(W);
      expect(forward.at(-1)).toBe(1);
      expect(widths[L - 3]).toBeLessThanOrEqual(3);
      // The sheer, read along the outer planking: lowest amidships, higher at the transom, highest at the stem.
      const top = (z: number) => { for (let y = size[1] - 1; y >= 0; y--) if (at(MID - (widths[z]! >> 1), y, z)) return y; return -1; };
      const line = Array.from({ length: L }, (_, z) => top(z));
      const low = Math.min(...line), lowAt = line.indexOf(low);
      expect(lowAt).toBeGreaterThan(3);
      expect(lowAt).toBeLessThan(L - 8);
      expect(line[0]).toBeGreaterThan(low);
      expect(line[L - 1]).toBeGreaterThan(line[0]!);
      for (let z = lowAt; z > 0; z--) expect(line[z - 1]).toBeGreaterThanOrEqual(line[z]!);
      for (let z = lowAt; z < L - 1; z++) expect(line[z + 1]).toBeGreaterThanOrEqual(line[z]!);
    });

    it('is a hollow planked shell: open boat over the floorboards between the thwarts, clinker laps outside', () => {
      const [, z1] = HULL.thwarts[0], [z2] = HULL.thwarts[1], floorTop = HULL.floor + 1;
      // Between the stern and rowing thwarts, above the floorboards and below the gunwale, the boat is mostly air;
      // only the loose gear (oars, a bailer) takes any of it.
      const room = { from: [3, floorTop, z1] as const, to: [W - 3, sheer(8), z2] as const };
      const volume = (room.to[0] - room.from[0]) * (room.to[1] - room.from[1]) * (room.to[2] - room.from[2]);
      const filled = occupiedIn(piece.blueprint, { from: [...room.from], to: [...room.to] });
      expect(1 - filled.length / volume).toBeGreaterThan(0.75);
      expect(filled.every(([, , , m]) => m !== paint.top && m !== TAR)).toBe(true);
      for (let z = z1; z < z2; z++) {
        // Floorboards under it, planking one or two cells thick at the sides, and the open top.
        for (let x = 3; x < W - 3; x++) expect(at(x, HULL.floor, z), `floor ${x},${z}`).not.toBe(0);
        expect(at(1, 4, z)).not.toBe(0);
        expect(at(W - 2, 4, z)).not.toBe(0);
        expect(at(MID, sheer(z), z)).toBe(0);
      }
      // Everything seen inside is bare wood or gear: no paint or tar faces into the open boat.
      // (Tar is bark, which is also a kit wood, so only the paints that are never wood are looked for.)
      const bare = new Set<number>([wood(style).plank, wood(style).end]);
      const inside = new Set([paint.top, ...paint.strakes].filter(m => !bare.has(m)));
      for (let z = z1; z < z2; z++) for (let y = floorTop; y < sheer(z); y++) for (let x = 1; x < W - 1; x++) {
        if (at(x, y, z)) continue;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0]] as const) {
          expect(inside.has(at(x + dx, y + dy, z + dz)), `paint inside at ${x + dx},${y + dy},${z + dz}`).toBe(false);
        }
      }
      // Three thwarts span the boat at one seat height, two cells over the floor.
      for (const [t0] of HULL.thwarts) expect(at(MID, HULL.thwartRow, t0)).toBe(at(MID - 1, HULL.thwartRow, t0));
      expect(HULL.thwarts.every(([t0]) => at(MID, HULL.thwartRow, t0) !== 0 && at(MID, HULL.thwartRow - 1, t0) === 0)).toBe(true);
      // Amidships, each strake up to the topsides stands one cell outboard of the one below: the laps.
      const outer = (y: number) => { for (let x = 0; x < W; x++) if (at(x, y, 12)) return MID - x; return -1; };
      for (let y = 2; y <= 4; y++) expect(outer(y) - outer(y - 1), `lap at ${y}`).toBe(1);
    });

    it('is tarred to the waterline, painted above, and wears its own top strake', () => {
      for (let y = 0; y <= ROWING_BOAT.draft; y++) {
        const x = [...Array(W).keys()].find(x => at(x, y, 12))!;
        expect(at(x, y, 12), `tar at ${y}`).toBe(TAR);
      }
      expect(at(0, 4, 12)).toBe(paint.strakes[0]);
      expect(at(1, 3, 12)).toBe(paint.strakes[1]);
      for (const z of [8, 12, 15]) expect(at(0, sheer(z) - 1, z)).toBe(paint.top);
      // Within a kit no two variants share a top strake.
      const tops = BOAT_VARIANTS.map(v => voxels(createRowingBoat(style, v).blueprint).at(0, sheer(12) - 1, 12));
      expect(new Set(tops).size).toBe(3);
      // Brass rowlock horns stand on both inwales either side of the pin.
      for (const x of [1, W - 2]) {
        expect(at(x, sheer(HULL.rowlock), HULL.rowlock - 1)).toBe(MAT.brass);
        expect(at(x, sheer(HULL.rowlock), HULL.rowlock)).toBe(0);
        expect(at(x, sheer(HULL.rowlock), HULL.rowlock + 1)).toBe(MAT.brass);
      }
    });

    it('carries its oars with blades showing and ties its painter to a brass ring on the stem head', () => {
      // Two oar blades, two cells wide, their tips in the top-strake colour, lying in the open boat on the thwarts.
      const blades: number[] = [];
      for (let z = 0; z < L; z++) for (let x = 2; x < W - 2; x++) {
        if (at(x, HULL.thwartRow + 1, z) === paint.top && at(x + 1, HULL.thwartRow + 1, z) === paint.top) blades.push(z);
      }
      expect(blades).toHaveLength(2);
      expect(piece.mounts).toHaveLength(1);
      const [mount] = piece.mounts, [x, y, z] = mount!.position;
      expect(mount!.id).toBe('painter');
      expect(mount!.axis).toEqual([0, 1, 0]);
      // The pivot is on the forward face of the brass ring, at the stem: nothing of the boat is further forward.
      expect(z).toBe(L);
      expect(at(Math.floor(x), Math.floor(y), L - 1)).toBe(MAT.brass);
      expect(breadth(at, L - 1, size[1], W)).toBe(1);
      // The ring is near the stem head, well above the waterline.
      expect(y).toBeGreaterThan(ROWING_BOAT.draft + 4);
      expect(at(Math.floor(x), Math.floor(y) + 1, L - 1)).not.toBe(0);
      expect(at(Math.floor(x), Math.floor(y) + 2, L - 1)).toBe(0);
      expect(piece.footings).toEqual([]);
    });
  });

  it('three variants of a kit differ in paint and in what they carry', () => {
    for (const style of STYLE_KEYS) {
      const boats = BOAT_VARIANTS.map(v => voxels(createRowingBoat(style, v).blueprint));
      const census = boats.map(({ at }) => {
        const counts = new Map<number, number>();
        for (let z = 0; z < L; z++) for (let y = HULL.floor + 1; y < 10; y++) for (let x = 2; x < W - 2; x++) {
          const m = at(x, y, z); if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
        }
        return counts;
      });
      // A coiled painter, a copper bailer and a cushion, a wicker basket with a fish.
      expect(census[0]!.get(MAT.thatch) ?? 0).toBeGreaterThanOrEqual(8);
      expect(census[1]!.get(MAT.forgeCopper)).toBeGreaterThan(0);
      expect(census[1]!.get(MAT.cloth)).toBeGreaterThan(0);
      expect(census[2]!.get(MAT.darkStone)).toBeGreaterThan(0);
      expect(census[2]!.get(MAT.thatch) ?? 0).toBeGreaterThanOrEqual(10);
      // The oars lie differently: blade ends in different places.
      const bladeEnds = boats.map(({ at }) => [3, 7].map(x => (at(x, HULL.thwartRow + 1, 17) !== 0 && at(x + (x < MID ? 1 : -1), HULL.thwartRow + 1, 17) !== 0 ? 'fore' : 'aft')).join());
      expect(new Set(bladeEnds).size).toBe(3);
    }
  });

  describe.each(UPTURNED.map(p => [p.blueprint.id, p] as const))('%s', (_, piece) => {
    const style = styleOf(piece), variant = Number(piece.blueprint.id.at(-1)) as BoatVariant;
    const { at, size } = voxels(piece.blueprint);
    const [SX, SY] = size, flip = UPTURNED_BOAT.lift + HULL.height;

    it('is the same hull as the rowing boat, turned keel up', () => {
      expect(size).toEqual([...UPTURNED_BOAT.size]);
      const upright = voxels(createRowingBoat(style, variant).blueprint).at;
      // The planking at both sides, cell for cell (the gear and the sawhorses lie elsewhere).
      for (const x of [0, 1, W - 2, W - 1]) for (let z = 0; z < L; z++) for (let y = 0; y < sheer(z); y++) {
        expect(at(x + 1, flip - 1 - y, z), `${x},${y},${z}`).toBe(upright(x, y, z));
      }
    });

    it('shows its tarred keel as its highest line and its painted top strake underneath', () => {
      const top = SY - 1;
      const highest: [number, number][] = [];
      for (let z = 0; z < L; z++) for (let x = 0; x < SX; x++) if (at(x, top, z)) highest.push([x, z]);
      expect(highest.length).toBeGreaterThan(L / 2);
      expect(highest.every(([x]) => x === MID + 1)).toBe(true);
      expect(highest.every(([x, z]) => at(x, top, z) === TAR)).toBe(true);
      // Seen from above, the bottom is tar from end to end of the keel.
      for (let z = 4; z < L - 6; z++) for (let x = 2; x < SX - 2; x++) {
        let y = top; while (y > 0 && !at(x, y, z)) y--;
        // Upright rows under HULL.tar land above flip - 1 - HULL.tar.
        if (y > flip - 1 - HULL.tar) expect(at(x, y, z), `bottom ${x},${z}`).toBe(TAR);
      }
      // The top strake is the lowest planking at the side.
      for (const z of [8, 12, 15]) expect(at(1, flip - sheer(z), z)).toBe(HULL_PAINT[style][variant].top);
    });

    it('rests its gunwales on two sawhorses whose splayed feet stand on the ground', () => {
      for (const zt of UPTURNED_BOAT.trestles) {
        const gunwale = flip - sheer(zt);
        for (const z of [zt, zt + 1]) {
          // Both gunwales (top strake and inwale on each side) bear on the bar directly under them.
          const resting = [...Array(SX).keys()].filter(x => at(x, gunwale, z) !== 0);
          expect(resting.length, `gunwale at ${z}`).toBeGreaterThanOrEqual(4);
          expect(resting.some(x => x < SX / 2) && resting.some(x => x > SX / 2)).toBe(true);
          for (const x of resting) expect(at(x, gunwale - 1, z), `bar ${x},${z}`).not.toBe(0);
        }
        // The bar is the whole sawhorse top, wider than the hull, with its ends showing.
        for (let x = 0; x < SX; x++) expect(at(x, gunwale - 1, zt)).not.toBe(0);
      }
      expect(piece.footings).toHaveLength(8);
      for (const f of piece.footings) {
        expect(f.box.from[1]).toBe(0);
        expect(occupiedIn(piece.blueprint, f.box).length).toBe((f.box.to[0] - f.box.from[0]) * (f.box.to[2] - f.box.from[2]));
      }
      // Each A's feet stand further apart than its top: the legs splay.
      for (const zt of UPTURNED_BOAT.trestles) for (const x of [0, SX - 1]) {
        const feet = piece.footings.filter(f => f.box.from[0] === x && Math.abs(f.box.from[2] - zt) < 5);
        expect(feet).toHaveLength(2);
        const span = Math.max(...feet.map(f => f.box.to[2])) - Math.min(...feet.map(f => f.box.from[2]));
        expect(span).toBeGreaterThan(4);
      }
      // Only the feet bear on the ground; nothing else of the boat or its oars lies there.
      const ground = occupiedIn(piece.blueprint, { from: [0, 0, 0], to: [SX, 1, L] }).length;
      expect(ground).toBe(piece.footings.reduce((n, f) => n + (f.box.to[0] - f.box.from[0]) * (f.box.to[2] - f.box.from[2]), 0));
      expect(unsupported(piece.blueprint)).toBe(0);
      expect(piece.mounts).toEqual([]);
      expect(piece.sounds).toEqual([]);
    });
  });
});
