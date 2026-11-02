import { describe, expect, it } from 'vitest';
import { VOXEL_METRES, VoxelBlueprintSchema } from '@chatdom/shared';
import { WALK_BODY } from '@chatdom/shared/realm';
import { rasterizeBlueprint } from '../../../voxel/src/index';
import { MAT } from '../materials';
import { buildCampfireClearing, CAMPFIRE_SEAT_TOP, createCampfireClearing } from './index';

const M = VOXEL_METRES.build;
const clearing = createCampfireClearing();
const { blueprint, pivot, seats } = clearing;
const asset = rasterizeBlueprint(blueprint);
const [sx, sy, sz] = blueprint.size;
type XZ = readonly [number, number];

/** The material of the cell holding a clearing-frame point (metres; y measured up from the ground plane). */
const cellAt = (x: number, y: number, z: number): number => {
  const i = Math.floor(pivot[0] + x / M), j = Math.floor(pivot[1] + y / M), k = Math.floor(pivot[2] + z / M);
  return i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz ? MAT.air : asset.voxels[i + sx * (j + sy * k)]!;
};
/** Any solid above the ground under a standing body's footprint, with the given extra clearance. */
const bodyHits = (p: XZ, clearance = 0): boolean => {
  const r = WALK_BODY.radius + clearance;
  for (let k = Math.floor(pivot[2] + (p[1] - r) / M); k < Math.ceil(pivot[2] + (p[1] + r) / M); k++)
    for (let i = Math.floor(pivot[0] + (p[0] - r) / M); i < Math.ceil(pivot[0] + (p[0] + r) / M); i++)
      for (let j = pivot[1]; j < sy; j++) if (i >= 0 && k >= 0 && i < sx && k < sz && asset.voxels[i + sx * (j + sy * k)] !== MAT.air) return true;
  return false;
};
/** Points every 1/16 m along a polyline. */
const along = (points: readonly XZ[]): XZ[] => {
  const out: XZ[] = [points[0]!];
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1]!, b = points[n]!, steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .0625));
    for (let s = 1; s <= steps; s++) out.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
  }
  return out;
};
const facingFire = (seat: (typeof seats)[number]) => {
  const d = Math.hypot(seat.hip[0], seat.hip[1]);
  return (Math.sin(seat.heading) * -seat.hip[0] + Math.cos(seat.heading) * -seat.hip[1]) / d;
};

describe('the kingdom campfire clearing', () => {
  it('is one schema-valid civic build-lattice piece with no bench seats of its own', () => {
    expect(VoxelBlueprintSchema.parse(blueprint)).toEqual(blueprint);
    expect(blueprint.kind).toBe('civic');
    expect(blueprint.lattice).toBe('build');
    expect(blueprint).not.toHaveProperty('seats');
    expect(Number.isInteger(pivot[1])).toBe(true);
    expect(blueprint.boxes.every(box => box.material !== MAT.air)).toBe(true);
    expect(clearing.seatTop).toBe(.25);
    expect(CAMPFIRE_SEAT_TOP).toBe(.25);
  });

  it('builds the same bytes every time', () => {
    expect(JSON.stringify(buildCampfireClearing())).toBe(JSON.stringify(clearing));
    expect(createCampfireClearing()).toBe(clearing);
  });

  it('seats ten players on logs and the Magistrate in a chair across the fire from the footpath', () => {
    expect(seats.map(seat => seat.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(seats.filter(seat => seat.kind === 'magistrate').map(seat => seat.seat)).toEqual([0]);
    const chair = seats[0]!;
    expect(chair.hip[1]).toBeLessThan(-2);
    expect(Math.abs(chair.hip[0])).toBeLessThan(.01);
    expect(facingFire(chair)).toBeGreaterThan(.999);
    for (const seat of seats) expect(facingFire(seat), `seat ${seat.seat}`).toBeGreaterThan(.9);
    // Numbered round the fire from the Magistrate's left.
    const angles = seats.slice(1).map(seat => Math.atan2(seat.hip[0], seat.hip[1]));
    expect([...angles].sort((a, b) => a - b)).toEqual(angles);
  });

  it('keeps every sitter at least a seat pitch from the next', () => {
    for (const a of seats) for (const b of seats) if (a !== b)
      expect(Math.hypot(a.hip[0] - b.hip[0], a.hip[1] - b.hip[1]), `${a.seat}-${b.seat}`).toBeGreaterThanOrEqual(.8 - 1e-9);
  });

  it('puts every hip over a seat surface exactly at the seat height, with open air above', () => {
    const wood = new Set<number>([MAT.bark, MAT.timber, MAT.cream, MAT.moss]);
    for (const seat of seats) {
      const [x, z] = seat.hip, under = cellAt(x, CAMPFIRE_SEAT_TOP - M / 2, z);
      expect(under, `seat ${seat.seat}`).not.toBe(MAT.air);
      expect(cellAt(x, CAMPFIRE_SEAT_TOP + M / 2, z), `seat ${seat.seat}`).toBe(MAT.air);
      if (seat.kind === 'player') {
        expect(wood.has(under), `seat ${seat.seat} sits on the log`).toBe(true);
        // The hip lies on the adzed top, a full cell inside its edges across the log.
        for (const dx of [-M, 0, M]) for (const dz of [-M, 0, M]) if (Math.abs(dx) + Math.abs(dz) <= M)
          expect(cellAt(x + dx, CAMPFIRE_SEAT_TOP - M / 2, z + dz), `seat ${seat.seat} ${dx},${dz}`).not.toBe(MAT.air);
      } else expect(under).toBe(MAT.fabricRed);
    }
  });

  it('leads a body in through the footpath gap and round the corridor to every seat without touching a solid', () => {
    for (const seat of seats) {
      const route = seat.approach;
      expect(route.length).toBeGreaterThanOrEqual(3);
      // Every route starts outside the logs on the footpath side and passes the gap on the centre line.
      expect(route[0]![1]).toBeGreaterThan(3);
      expect(Math.abs(route[0]![0])).toBeLessThan(1e-9);
      for (const point of along(route)) expect(bodyHits(point), `seat ${seat.seat} at ${point.join(',')}`).toBe(false);
      // The last waypoint stands in front of the seat, within reach of it, and clear with a margin.
      const stand = route[route.length - 1]!;
      expect(bodyHits(stand, .04), `seat ${seat.seat} stand`).toBe(false);
      expect(Math.hypot(stand[0] - seat.hip[0], stand[1] - seat.hip[1])).toBeLessThan(1);
    }
    // The corridor itself: a full ring between the sitters' feet and the stones.
    const ring = Array.from({ length: 96 }, (_, n): XZ => [Math.sin(n / 96 * Math.PI * 2) * 1.45, Math.cos(n / 96 * Math.PI * 2) * 1.45]);
    for (const point of ring) expect(bodyHits(point, .04), `corridor ${point.join(',')}`).toBe(false);
  });

  it('stands each lantern on open ground beside the shins, clear of every walking route', () => {
    const walked = seats.flatMap(seat => along(seat.approach));
    for (const seat of seats) {
      const [x, z] = seat.lantern;
      expect(cellAt(x, M / 2, z), `seat ${seat.seat}`).toBe(MAT.air);
      expect(Math.hypot(x - seat.hip[0], z - seat.hip[1]), `seat ${seat.seat}`).toBeLessThan(.8);
      const nearest = Math.min(...walked.map(p => Math.hypot(p[0] - x, p[1] - z)));
      expect(nearest, `seat ${seat.seat} lantern`).toBeGreaterThan(WALK_BODY.radius + .05);
    }
  });

  it('keeps the hearth a low fire pit and every piece inside the clearing radius', () => {
    let tallest = 0, reach = 0;
    for (let k = 0; k < sz; k++) for (let j = pivot[1]; j < sy; j++) for (let i = 0; i < sx; i++) {
      if (asset.voxels[i + sx * (j + sy * k)] === MAT.air) continue;
      const x = (i + .5 - pivot[0]) * M, z = (k + .5 - pivot[2]) * M;
      if (Math.hypot(x, z) < 1.1) tallest = Math.max(tallest, (j + 1 - pivot[1]) * M);
      reach = Math.max(reach, Math.hypot(x, z));
    }
    expect(tallest).toBeGreaterThan(.2);
    expect(tallest).toBeLessThanOrEqual(.375);
    expect(reach).toBeLessThan(clearing.radius - .5);
    for (const seat of seats) for (const p of seat.approach) expect(Math.hypot(p[0], p[1])).toBeLessThan(clearing.radius);
  });
});
