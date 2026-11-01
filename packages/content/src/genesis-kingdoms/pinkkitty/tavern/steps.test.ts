import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS } from '../../../materials';
import { landmarkPalette } from '../../../genesis-landmarks/kit';
import { meshCost } from '../../../places/water/piece-checks';
import { LANTERN_AND_OAR } from './index';
import { createTavernSteps, TAVERN_STEPS, tavernStepsPlan, tavernStepsReach } from './steps';

/** The blueprint executed into a dense grid, boxes in order, material zero carving. */
function voxels(blueprint: VoxelBlueprint) {
  const [sx, sy, sz] = blueprint.size, cells = new Uint16Array(sx * sy * sz);
  for (const { from, to, material } of blueprint.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) cells.fill(material, from[0] + sx * (y + sy * z), to[0] + sx * (y + sy * z));
  }
  const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? MAT.air : cells[x + sx * (y + sy * z)]!);
  return { cells, at, size: [sx, sy, sz] as const };
}

/** Occupied cells no chain of face neighbours joins to the bottom layer. */
function floating(blueprint: VoxelBlueprint): number {
  const { cells, size: [sx, sy, sz] } = voxels(blueprint);
  const seen = new Uint8Array(cells.length), stack: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) { const i = x + sx * sy * z; if (cells[i]) { seen[i] = 1; stack.push(i); } }
  while (stack.length) {
    const i = stack.pop()!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const j = nx + sx * (ny + sy * nz);
      if (cells[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  let loose = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) loose++;
  return loose;
}

const registered = new Set(MATERIALS.materials.map(m => m.id));
const allowed = new Set([...landmarkPalette('hearth'), MAT.petal, MAT.paving, MAT.leaf, MAT.moss]);
const G = LANTERN_AND_OAR.ground;
const DOOR = (LANTERN_AND_OAR.door.x[0] + LANTERN_AND_OAR.door.x[1]) / 2;

describe('The Lantern and Oar’s levee steps', () => {
  it('builds a strict, grounded Hearth piece for every rise, either way along the front', () => {
    for (const rise of [TAVERN_STEPS.rise.min, 18, 30, 36, TAVERN_STEPS.rise.max]) for (const toward of [-1, 1] as const) {
      const steps = createTavernSteps({ riseCells: rise, toward }), { blueprint } = steps;
      expect(() => VoxelBlueprintSchema.parse(blueprint)).not.toThrow();
      expect(blueprint.size).toEqual([...steps.size]);
      expect(blueprint.windows).toEqual([]);
      expect(Math.max(...blueprint.size)).toBeLessThanOrEqual(256);
      for (const box of blueprint.boxes) {
        expect(registered.has(box.material) && (box.material === MAT.air || allowed.has(box.material)), `material ${box.material}`).toBe(true);
        for (let i = 0; i < 3; i++) expect(box.from[i]! >= 0 && box.to[i]! <= blueprint.size[i]!).toBe(true);
      }
      expect(floating(blueprint), `rise ${rise} toward ${toward}`).toBe(0);
      const cost = meshCost(blueprint);
      expect(cost.triangles).toBeLessThanOrEqual(120_000);
      expect(JSON.stringify(createTavernSteps({ riseCells: rise, toward }))).toBe(JSON.stringify(steps));
    }
  }, 60_000);

  it('meets the floor at the door and the meadow at the foot, where the plan says', () => {
    for (const [rise, toward] of [[16, -1], [36, -1], [36, 1], [48, 1]] as const) {
      const steps = createTavernSteps({ riseCells: rise, toward }), plan = tavernStepsPlan({ riseCells: rise, toward });
      const { at } = voxels(steps.blueprint), o = steps.offset;
      const top = (x: number, z: number) => { for (let y = steps.size[1] - 1; y >= 0; y--) if (at(x - o[0], y, z - o[2])) return y + 1 + o[1]; return -Infinity; };
      // The landing before the door lies at the floor, the foot at floor less the rise.
      expect(top(DOOR, TAVERN_STEPS.terrace.z[1] + 4)).toBe(G);
      expect(steps.foot).toEqual(plan.foot);
      expect(plan.foot[1]).toBe(G - rise);
      const inside = toward < 0 ? plan.foot[0] + 2 : plan.foot[0] - 2;
      expect(top(inside, plan.foot[2])).toBe(G - rise);
      // Each tread is a riser below the one above it, along the flight.
      for (let k = 0; k < rise / TAVERN_STEPS.riser; k++) {
        const x = DOOR + toward * (TAVERN_STEPS.landingHalf + k * TAVERN_STEPS.tread + TAVERN_STEPS.tread / 2);
        expect(top(Math.floor(x), plan.foot[2])).toBe(G - TAVERN_STEPS.riser * (k + 1));
      }
      expect(Math.abs(plan.foot[0] - DOOR)).toBe(tavernStepsReach(rise));
    }
  });

  it('lights only its pier lanterns, as place lights over open cages', () => {
    const steps = createTavernSteps({ riseCells: 30, toward: -1 });
    expect(steps.fires).toHaveLength(3);
    const { at } = voxels(steps.blueprint);
    for (const fire of steps.fires) {
      const [x, y, z] = [Math.floor(fire[0] - steps.offset[0]), Math.floor(fire[1] - steps.offset[1]), Math.floor(fire[2] - steps.offset[2])];
      expect(at(x, y - 4, z)).toBe(MAT.darkStone);
      expect(at(x, y - 3, z)).toBe(MAT.brass);
      expect(at(x + 2, y, z)).toBe(MAT.glass);
    }
    expect(steps.blueprint.boxes.some(b => b.material === MAT.forgeCopper || b.material === MAT.goldLeaf)).toBe(false);
  });

  it('refuses a rise or direction it was not built for', () => {
    for (const riseCells of [6, 7, 50]) expect(() => createTavernSteps({ riseCells, toward: -1 })).toThrow();
    expect(() => createTavernSteps({ riseCells: 20, toward: 0 as never })).toThrow();
  });
});
