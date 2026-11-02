import { describe, expect, it } from 'vitest';
import { SHELF_BAY_SLOTS, SHELF_SLOTS, type VoxelAsset } from '@chatdom/shared';
import { executeVoxelJob } from '../../../voxel/src/protocol';
import { MAT, MATERIALS } from '../materials';
import { createKeepsakeShelf, createShelfAlcove, SHELF_MAX_BAYS, shelfBaysFor, shelfPlaceOf } from './index';

const registered = new Set(MATERIALS.materials.filter(material => material.id !== 0).map(material => material.id));
const cell = (asset: VoxelAsset, x: number, y: number, z: number) => {
  const [sx, sy, sz] = asset.size;
  return x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
};

/** Face-connected parts, by index, so a six-bay shelf is checked in moments. */
function parts(asset: VoxelAsset): { parts: number; cells: number } {
  const [sx, sy, sz] = asset.size, seen = new Uint8Array(asset.voxels.length), queue = new Int32Array(asset.voxels.length);
  let count = 0, cells = 0;
  for (let start = 0; start < asset.voxels.length; start++) {
    if (!asset.voxels[start] || seen[start]) continue;
    count++;
    let head = 0, tail = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++]!; cells++;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      const near = [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1,
        z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1];
      for (const j of near) if (j >= 0 && asset.voxels[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
    }
  }
  return { parts: count, cells };
}

function triangles(asset: VoxelAsset): number {
  const result = executeVoxelJob({ id: 1, kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (result.kind !== 'asset') throw new Error('Expected an asset mesh');
  return result.chunks.reduce((sum, chunk) => sum + chunk.mesh.indices.length / 3, 0);
}

describe('the keepsake shelf', () => {
  it('grows by a bay per dozen keepsakes, up to the last slot', () => {
    expect(SHELF_MAX_BAYS).toBe(Math.ceil(SHELF_SLOTS / SHELF_BAY_SLOTS));
    expect([0, 1, 12, 13, 24, 25, 60, 61, 64, 200, -3, Number.NaN].map(shelfBaysFor)).toEqual([1, 1, 1, 2, 2, 3, 5, 6, 6, 6, 1, 1]);
    expect(() => createKeepsakeShelf(0)).toThrow(/1 to 6 bays/);
    expect(() => createKeepsakeShelf(SHELF_MAX_BAYS + 1)).toThrow(/bays/);
    expect(() => shelfPlaceOf(SHELF_SLOTS)).toThrow(/not on the shelf/);
  });

  it('numbers places from pride of place outwards, each place once per bay', () => {
    expect(shelfPlaceOf(0)).toEqual({ bay: 0, tier: 1, column: 1 });
    expect(shelfPlaceOf(1)).toEqual({ bay: 0, tier: 1, column: 2 });
    expect(shelfPlaceOf(12)).toEqual({ bay: 1, tier: 1, column: 1 });
    const places = new Set(Array.from({ length: SHELF_BAY_SLOTS }, (_, n) => { const p = shelfPlaceOf(n); return `${p.tier}:${p.column}`; }));
    expect(places.size).toBe(SHELF_BAY_SLOTS);
  });

  it('is deterministic, fresh on every call, and every place is clear air on a board', () => {
    for (const bays of [1, 2, SHELF_MAX_BAYS]) {
      const shelf = createKeepsakeShelf(bays), again = createKeepsakeShelf(bays);
      const { asset } = shelf;
      expect(asset.lattice).toBe('avatar');
      expect(asset.voxels.length).toBe(asset.size[0] * asset.size[1] * asset.size[2]);
      expect(asset.size.every(n => Number.isInteger(n) && n > 0 && n <= 1024)).toBe(true);
      expect(asset.voxels.length).toBe(again.asset.voxels.length);
      expect(asset.voxels.every((m, i) => again.asset.voxels[i] === m)).toBe(true);
      expect(asset.voxels.buffer).not.toBe(again.asset.voxels.buffer);
      again.asset.voxels[0] = 99; expect(asset.voxels[0]).not.toBe(99);
      expect([...new Set(asset.voxels)].every(m => m === 0 || registered.has(m))).toBe(true);
      expect(shelf.slots).toHaveLength(Math.min(SHELF_SLOTS, bays * SHELF_BAY_SLOTS));
      expect(shelf.bayX).toHaveLength(bays);
      for (const [n, slot] of shelf.slots.entries()) {
        const [x, y, z] = slot.at;
        expect(slot.bay).toBe(Math.floor(n / SHELF_BAY_SLOTS));
        expect(x - slot.width / 2).toBeGreaterThanOrEqual(shelf.bayX[slot.bay]![0]);
        expect(x + slot.width / 2).toBeLessThanOrEqual(shelf.bayX[slot.bay]![1]);
        expect(slot.width).toBeGreaterThanOrEqual(30); expect(slot.height).toBeGreaterThanOrEqual(30); expect(slot.depth).toBeGreaterThanOrEqual(20);
        expect(y + slot.height).toBeLessThan(asset.size[1]); expect(z).toBeGreaterThan(0); expect(z).toBeLessThan(asset.size[2]);
        // The whole room a keepsake may take is air, and every column of its floor rests on wood or lace.
        const x0 = Math.ceil(x - slot.width / 2), x1 = Math.floor(x + slot.width / 2);
        for (let cx = x0; cx < x1; cx++) for (let cz = slot.back; cz < slot.back + slot.depth; cz++) {
          expect(cell(asset, cx, y - 1, cz), `slot ${n} floor at ${cx},${cz}`).not.toBe(0);
          for (let cy = y; cy < y + slot.height; cy++) if (cell(asset, cx, cy, cz)) throw new Error(`Slot ${n} is not clear at ${cx},${cy},${cz}.`);
        }
        expect(cell(asset, Math.floor(x), y, slot.back - 1)).not.toBe(0);
      }
      // A candle over every post and one on each bay's middle tier, and two display lamps over each tier, each light in
      // its own flame or glowing strip.
      expect(shelf.lights).toHaveLength(bays + 1 + bays);
      expect(shelf.lamps).toHaveLength(bays * 3 * 2);
      for (const [lx, ly, lz] of [...shelf.lights, ...shelf.lamps]) expect([MAT.fabricGold, MAT.fabricOrange, MAT.hairGold]).toContain(cell(asset, Math.floor(lx), Math.floor(ly), Math.floor(lz)));
      expect(parts(asset).parts).toBe(1);
    }
  }, 60_000);

  it('meshes a bay, and stands in an alcove whose wall it backs onto', () => {
    const shelf = createKeepsakeShelf(1), alcove = createShelfAlcove(shelf);
    const shelfTris = triangles(shelf.asset), alcoveTris = triangles(alcove.asset);
    expect(shelfTris).toBeGreaterThan(1_000); expect(shelfTris).toBeLessThan(120_000);
    expect(alcoveTris).toBeGreaterThan(100); expect(alcoveTris).toBeLessThan(60_000);
    expect(parts(alcove.asset).parts).toBe(1);
    expect([...new Set(alcove.asset.voxels)].every(m => m === 0 || registered.has(m))).toBe(true);
    expect(alcove.asset.lattice).toBe('build');
    expect(createShelfAlcove(shelf).asset.voxels).toEqual(alcove.asset.voxels);
    // The shelf's footprint, in metres, stands on the floor and inside the alcove.
    const [ax, ay, az] = alcove.asset.size.map(n => n * .125) as [number, number, number];
    const [sx, sy, sz] = shelf.asset.size.map(n => n * .0625) as [number, number, number];
    expect(alcove.shelfAt[0]).toBeGreaterThan(2); expect(alcove.shelfAt[0] + sx).toBeLessThan(ax - 2);
    expect(alcove.shelfAt[1] + sy).toBeLessThan(ay); expect(alcove.shelfAt[2] + sz).toBeLessThan(az);
    expect(alcove.window[0]).toBeLessThan(alcove.shelfAt[0]);
    console.info(`Shelf: ${shelf.asset.size.join('x')} ${shelfTris} tris; alcove ${alcove.asset.size.join('x')} ${alcoveTris} tris`);
    const six = createShelfAlcove(createKeepsakeShelf(SHELF_MAX_BAYS));
    expect(six.asset.size.every(n => n <= 1024)).toBe(true);
  }, 60_000);
});
