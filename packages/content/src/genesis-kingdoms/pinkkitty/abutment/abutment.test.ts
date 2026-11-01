import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS } from '../../../materials';
import { ABUTMENT_REVETMENT, bankTop, batterTop, createAbutmentRevetment, type AbutmentEnd } from './index';

/** The blueprint executed into a dense grid, boxes in order, material zero carving; `at` reads in the hall's frame. */
function voxels(blueprint: VoxelBlueprint, offset: readonly number[]) {
  const [sx, sy, sz] = blueprint.size, cells = new Uint16Array(sx * sy * sz);
  for (const { from, to, material } of blueprint.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) cells.fill(material, from[0] + sx * (y + sy * z), to[0] + sx * (y + sy * z));
  }
  const at = (x: number, y: number, z: number): number => {
    const lx = x - offset[0]!, ly = y - offset[1]!, lz = z - offset[2]!;
    return lx < 0 || ly < 0 || lz < 0 || lx >= sx || ly >= sy || lz >= sz ? MAT.air : cells[lx + sx * (ly + sy * lz)]!;
  };
  return { cells, at, size: [sx, sy, sz] as const };
}

/** Occupied cells that no chain of face neighbours joins to a column founded under the ground. */
function floating(blueprint: VoxelBlueprint): number {
  const [sx, sy, sz] = blueprint.size, { cells } = voxels(blueprint, [0, 0, 0]);
  const seen = new Uint8Array(cells.length), stack: number[] = [];
  for (const box of blueprint.boxes) {
    if (box.material === MAT.air) continue;
    const i = box.from[0] + sx * (box.from[1] + sy * box.from[2]);
    // A box whose foot is its column's lowest cell, below any ground the test laid, is founded.
    if (box.from[1] <= 8 && cells[i] && !seen[i]) { seen[i] = 1; stack.push(i); }
  }
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

// A levee like PinkKittyRose's: the crest two metres under the bank by the water, the far meadow falling away.
const levee = (x: number, z: number) => {
  const fromRiver = z < 64 ? 64 - z : z > 192 ? z - 192 : 0;
  return 16 - fromRiver * 0.4 + Math.sin(x / 9) * 1.5;
};
const registered = new Set(MATERIALS.materials.map(m => m.id));

describe('the river hall’s abutment revetments', () => {
  for (const end of ['far', 'near'] as const satisfies readonly AbutmentEnd[]) {
    it(`wraps the ${end} abutment down to the ground in a valid, grounded piece`, () => {
      const r = createAbutmentRevetment({ end, ground: levee });
      expect(VoxelBlueprintSchema.safeParse(r.blueprint).success).toBe(true);
      expect(r.blueprint.boxes.length).toBeLessThan(8000);
      for (const box of r.blueprint.boxes) expect(registered.has(box.material), `material ${box.material}`).toBe(true);
      expect(floating(r.blueprint)).toBe(0);
      expect(createAbutmentRevetment({ end, ground: levee }).blueprint.id).toBe(r.blueprint.id);
    });

    it(`leaves no blank stone or gap between the ${end} abutment and the ground`, () => {
      const r = createAbutmentRevetment({ end, ground: levee }), { at } = voxels(r.blueprint, r.offset);
      const block = ABUTMENT_REVETMENT[end];
      // Along every flank, the ring touching the abutment is solid from under the ground to the bank line.
      for (const x of [block.x[0] - 1, block.x[1]]) for (let z = block.z[0] + 2; z < block.z[1] - 2; z += 3) {
        const g = levee(x, z);
        for (let y = Math.ceil(g) + 1; y < ABUTMENT_REVETMENT.top; y++) expect(at(x, y, z), `(${x}, ${y}, ${z})`).not.toBe(MAT.air);
      }
      // The apron steps out a ring per course and never stands over its own bank line.
      for (let o = 1; o <= 6; o++) {
        const x = block.x[0] - o, z = Math.floor((block.z[0] + block.z[1]) / 2) + 11;
        if (batterTop(o) <= levee(x, z) + 1) continue;
        expect(at(x, batterTop(o) - 1, z)).not.toBe(MAT.air);
        expect(at(x, batterTop(o), z)).toBe(MAT.air);
      }
    });
  }

  it('turns the far end into a balcony lit from its corner piers', () => {
    const r = createAbutmentRevetment({ end: 'far', ground: levee }), { at } = voxels(r.blueprint, r.offset);
    expect(r.fires).toHaveLength(2);
    for (const fire of r.fires) {
      expect(at(fire[0], fire[1], fire[2])).toBe(MAT.air);
      expect(at(fire[0], fire[1] - 1, fire[2])).toBe(MAT.forgeCopper);
    }
    const top = ABUTMENT_REVETMENT.top, { high } = ABUTMENT_REVETMENT.parapet;
    for (const x of [30, 56, 80]) {
      expect(at(x, top + 1, -1)).toBe(MAT.limestone);
      expect(at(x, top + high, -1)).toBe(MAT.darkStone);
    }
    // A turfed approach bank takes the apron's lower courses: stone above it, turf on it, falling away outward.
    // The turf block at z ∈ [−4, −2) is keyed to its nearest ring, the third.
    const mid = 56, near = -4, out = -40, b = bankTop(3);
    if (b > levee(mid, near) + 1) {
      expect(at(mid, b - 1, near)).toBe(MAT.grass);
      expect(at(mid, b + 1, near)).not.toBe(MAT.grass);
    }
    let previous = Infinity;
    for (let z = near; z >= out; z -= 4) {
      let y = 90;
      while (y > -40 && at(mid, y, z) !== MAT.grass) y--;
      if (y <= -40) break;
      expect(y, `bank at z = ${z}`).toBeLessThanOrEqual(previous);
      previous = y;
    }
    // The near end has no balcony: the landing meets it, and its fires are the landing's.
    expect(createAbutmentRevetment({ end: 'near', ground: levee }).fires).toHaveLength(0);
  });

  it('refuses ground it cannot read', () => {
    expect(() => createAbutmentRevetment({ end: 'far', ground: () => Number.NaN })).toThrow();
    expect(() => createAbutmentRevetment({ end: 'middle' as AbutmentEnd, ground: levee })).toThrow();
  });
});
