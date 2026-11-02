import { expect, it } from 'vitest';
import type { Vec3, VoxelAsset } from '@chatdom/shared';
import { MATERIALS } from '../materials';
import { createRodNotch, createRodRibbon, createWillowRod, ROD_NOTCH_CELLS, ROD_NOTCH_MATERIAL, ROD_RIBBON_CELLS } from './rod';

const at = (asset: VoxelAsset, [x, y, z]: readonly number[]) => asset.voxels[x! + asset.size[0] * (y! + asset.size[1] * z!)]!;
function cells(asset: VoxelAsset): Vec3[] {
  const [sx, sy, sz] = asset.size, out: Vec3[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (asset.voxels[x + sx * (y + sy * z)]) out.push([x, y, z]);
  return out;
}
function connected(asset: VoxelAsset): boolean {
  const all = cells(asset), left = new Set(all.map(cell => cell.join(','))), queue = [all[0]!];
  left.delete(all[0]!.join(','));
  while (queue.length) {
    const [x, y, z] = queue.pop()!;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const key = `${x + dx},${y + dy},${z + dz}`;
      if (left.delete(key)) queue.push([x + dx, y + dy, z + dz]);
    }
  }
  return left.size === 0;
}

it('carves one pale notch per ten fish into free cells beside the foregrip, in order, at most twelve', () => {
  const plain = createWillowRod();
  for (const cell of ROD_NOTCH_CELLS) expect(at(plain.asset, cell)).toBe(0);
  expect(new Set(ROD_NOTCH_CELLS.map(cell => cell.join(','))).size).toBe(12);
  for (const notches of [1, 5, 12, 40]) {
    const rod = createWillowRod({ notches });
    const shown = Math.min(12, notches);
    ROD_NOTCH_CELLS.forEach((cell, index) => expect(at(rod.asset, cell)).toBe(index < shown ? ROD_NOTCH_MATERIAL : 0));
    expect(connected(rod.asset)).toBe(true);
    expect(cells(rod.asset).length - cells(plain.asset).length).toBe(shown);
  }
  // The grip and tip the hand and line use never move.
  expect(createWillowRod({ notches: 12, ribbon: true })).toMatchObject({ grip: plain.grip, tip: plain.tip });
});

it('ties the legend’s ribbon around the rod as one connected piece', () => {
  const plain = createWillowRod(), rod = createWillowRod({ ribbon: true });
  for (const [x, y, z, material] of ROD_RIBBON_CELLS) { expect(at(plain.asset, [x, y, z])).toBe(0); expect(at(rod.asset, [x, y, z])).toBe(material); }
  expect(connected(rod.asset)).toBe(true);
  const registered = new Set(MATERIALS.materials.map(material => material.id));
  for (const value of [...createRodRibbon().voxels, ...createRodNotch().voxels]) if (value) expect(registered.has(value)).toBe(true);
  expect(cells(createRodRibbon())).toHaveLength(ROD_RIBBON_CELLS.length);
  expect(cells(createRodNotch())).toEqual([[0, 0, 0]]);
});
