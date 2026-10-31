import { describe, expect, it } from 'vitest';
import { HOME_BUILD_LIMITS, HomeTierSchema, VoxelBlueprintSchema, type HomeTier, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import {
  BLUEPRINTS, BUILD_TEMPLATE_CHOICES, BUILD_TEMPLATE_FORMS, BUILD_TEMPLATE_LABELS, BUILD_TEMPLATE_STYLES, RESERVE, TEMPLATE_REVIEW,
  activeRear, createBuildTemplate, templateId,
} from './index';

const [SX, SY, SZ] = RESERVE;
/** A route keeps 1.25 m of width and 2.5 m of headroom and climbs at most two cells (0.25 m) at a time. */
const WIDTH = 10, HEAD = 20, STEP = 2;
/** A room is somewhere to stand and turn around: a clear 2 m square under the same headroom. */
const ROOM = 16;

interface Grid { readonly cells: Uint16Array; get(x: number, y: number, z: number): number }

/** Executes the ordered boxes exactly as the production rasterizer does: later boxes overwrite, air carves. */
function execute(b: VoxelBlueprint): Grid {
  const cells = new Uint16Array(SX * SY * SZ);
  for (const { from, to, material } of b.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) {
      const row = from[0] + SX * (y + SY * z);
      cells.fill(material, row, row + to[0] - from[0]);
    }
  }
  return { cells, get: (x, y, z) => x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? 0 : cells[x + SX * (y + SY * z)]! };
}

/** Clear headroom over a footprint with every cell standing on something solid (or the meadow at y=0). */
function standable(g: Grid, x0: number, x1: number, z0: number, z1: number, feet: number): boolean {
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (feet > 0 && !g.get(x, feet - 1, z)) return false;
    for (let y = feet; y < feet + HEAD; y++) if (g.get(x, y, z)) return false;
  }
  return true;
}

/**
 * Sweeps a route slice one cell at a time from `from` to `to` along one axis, carrying the feet height and letting
 * it change by at most a step. This checks the declared walk; it is not a general pathfinder.
 */
function sweep(g: Grid, from: Vec3, axis: 0 | 2, to: number, feet: number): number | string {
  const step = Math.sign(to - from[axis]);
  const half = WIDTH / 2;
  for (let at = from[axis]; ; at += step || 1) {
    const [x0, x1, z0, z1] = axis === 2 ? [from[0] - half, from[0] + half, at, at + 1] : [at, at + 1, from[2] - half, from[2] + half];
    const next = [0, 1, -1, 2, -2].map(d => feet + d).find(f => f >= 0 && f - feet <= STEP && standable(g, x0, x1, z0, z1, f));
    if (next === undefined) return `blocked at ${axis === 2 ? `z=${at}` : `x=${at}`} near feet ${feet}`;
    feet = next;
    if (at === to || !step) return feet;
  }
}

/** Walks an L from a point to the next stop, trying either leg first. Returns the arrival feet or the failure. */
function walk(g: Grid, from: Vec3, to: Vec3): number | string {
  const tries: string[] = [];
  for (const order of [[2, 0], [0, 2]] as const) {
    const corner: [number, number, number] = [...from];
    let feet: number | string = from[1];
    for (const axis of order) {
      feet = sweep(g, corner, axis, to[axis], feet);
      if (typeof feet === 'string') break;
      corner[axis] = to[axis];
    }
    if (typeof feet === 'number') return feet;
    tries.push(feet);
  }
  return tries.join('; ');
}

const TIERS = HomeTierSchema.options;
const ORDER = BUILD_TEMPLATE_STYLES.flatMap(style => BUILD_TEMPLATE_FORMS.flatMap(form => TIERS.map(tier => templateId(style, form, tier))));
const tierOf = (b: VoxelBlueprint) => b.id.split('-').at(-1) as HomeTier;

describe('editable starting shapes', () => {
  it('lists only finished shapes, in kit → form → tier order, with their review facts', () => {
    const ids = BLUEPRINTS.map(b => b.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(ORDER.filter(id => ids.includes(id)));
    expect(BUILD_TEMPLATE_CHOICES.map(c => c.id)).toEqual(ids);
    expect(Object.keys(TEMPLATE_REVIEW).sort()).toEqual([...ids].sort());
    for (const form of BUILD_TEMPLATE_FORMS) {
      expect(BUILD_TEMPLATE_LABELS[form].title.length).toBeGreaterThan(4);
      expect(BUILD_TEMPLATE_LABELS[form].hint).toMatch(/\.$/);
    }
  });

  it('returns fresh owned data and refuses anything outside the finite choices', () => {
    const [first] = BUILD_TEMPLATE_CHOICES;
    const a = createBuildTemplate(first!.style, first!.form, first!.tier);
    a.boxes[0]!.from[0] = 99; a.boxes.length = 1; a.windows.length = 0;
    expect(createBuildTemplate(first!.style, first!.form, first!.tier)).toEqual(BLUEPRINTS[0]);
    expect(JSON.stringify(createBuildTemplate(first!.style, first!.form, first!.tier))).toBe(JSON.stringify(BLUEPRINTS[0]));
    expect(() => createBuildTemplate('marble' as never, 'gable', 'hut')).toThrow(/Unknown template kit/);
    expect(() => createBuildTemplate('hearth', 'tower' as never, 'hut')).toThrow(/Unknown template form/);
    expect(() => createBuildTemplate('hearth', 'gable', 'palace' as never)).toThrow(/Unknown template tier/);
    expect(() => createBuildTemplate('toString' as never, 'gable', 'hut')).toThrow(/Unknown template kit/);
  });

  describe.each(BLUEPRINTS.map(b => [b.id, b] as const))('%s', (id, b) => {
    const tier = tierOf(b), g = execute(b), review = TEMPLATE_REVIEW[id]!;
    const kit = STYLES[b.styleId as keyof typeof STYLES];

    it('stays inside its tier, its palette and its cell allowance with room left to build', () => {
      expect(VoxelBlueprintSchema.parse(b)).toEqual(b);
      expect([b.kind, b.lattice, b.size]).toEqual(['home', 'build', [...RESERVE]]);
      const palette = new Set<number>([MAT.air, kit.wall, kit.roof, kit.trim, kit.stone, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower]);
      expect(b.boxes.filter(box => !palette.has(box.material))).toEqual([]);
      const rear = activeRear(tier), { height, maxVoxels } = HOME_BUILD_LIMITS[tier];
      let occupied = 0, outside = 0;
      for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) if (g.get(x, y, z)) {
        occupied++;
        if (z < rear || y >= height) outside++;
      }
      expect(outside).toBe(0);
      // Leave real room for the citizen's own additions. The README records what each shape leaves; the
      // tightest is the hut's three-sided court, where the 8 × 8 m lot itself sets the cost.
      expect(occupied).toBeLessThanOrEqual(Math.floor(maxVoxels * 0.85));
    });

    it('opens a supported, clear route from the street through the threshold into every room', () => {
      const street: Vec3 = [review.threshold[0], 0, SZ - 1];
      const arrive = walk(g, street, review.threshold);
      expect(arrive, 'street to threshold').toBe(review.threshold[1]);
      let from = review.threshold;
      for (const stop of [...review.rooms, ...(review.court ? [review.court] : [])]) {
        expect(walk(g, from, stop), `route to ${stop.join(',')}`).toBe(stop[1]);
        from = stop;
      }
      for (const room of review.rooms) {
        const h = ROOM / 2;
        expect(standable(g, room[0] - h, room[0] + h, room[2] - h, room[2] + h, room[1]), `room at ${room.join(',')}`).toBe(true);
      }
    });

    it('carries executable presence windows with glass on the plane and two open cells outside', () => {
      expect(b.windows.map(w => w.id)).toEqual(review.windows);
      expect(b.windows.length).toBeGreaterThan(0);
      for (const w of b.windows) {
        const across = w.facing === 'south' || w.facing === 'north' ? 0 : 2, normal = across === 0 ? 2 : 0;
        const out = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
        let glass = 0;
        for (let y = w.centre[1] - w.height / 2; y < w.centre[1] + w.height / 2; y++) for (let u = w.centre[across] - w.width / 2; u < w.centre[across] + w.width / 2; u++) {
          const cell: [number, number, number] = [...w.centre]; cell[1] = y; cell[across] = u;
          cell[normal] = w.centre[normal] - (out > 0 ? 1 : 0);
          if (g.get(...cell) === MAT.glass) glass++;
          for (let k = 0; k < 2; k++) {
            cell[normal] = w.centre[normal] + (out > 0 ? k : -1 - k);
            expect(g.get(...cell), `${w.id} outward cell ${cell.join(',')}`).toBe(MAT.air);
          }
        }
        expect(glass, w.id).toBeGreaterThanOrEqual(w.width * w.height / 2);
      }
    });
  });
});
