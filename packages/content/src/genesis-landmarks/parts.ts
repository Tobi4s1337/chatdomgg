import { StyleIdSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';
import { FLAG_HEIGHT, FLAG_LENGTH, flagGrid, type BannerCut } from './heraldry';
import { Boxes, type LandmarkKit } from './kit';
import type { CellBox } from './types';

/**
 * The kingdom's flag as its own part, so a host can move it in the wind about the hoist. Part-local cells: the cloth
 * runs from the hoist at x = 0 to the fly, rows bottom to top, the main layer at z = 1 and its folds dropped back to
 * z = 0. `name` keeps each landmark's flag id stable (`genesis-<name>-flag-…`).
 */
export function flagBlueprint(name: string, style: StyleKey, kit: LandmarkKit, cut: BannerCut, colours: { readonly field: number; readonly band: number }): VoxelBlueprint {
  const grid = flagGrid(cut), b = new Boxes();
  const material: Record<string, number> = { B: kit.cord, F: colours.field, C: colours.band };
  grid.forEach((row, i) => {
    const y = FLAG_HEIGHT - 1 - i;
    let start = 0;
    for (let c = 1; c <= row.length; c++) {
      if (c < row.length && row[c] === row[start]) continue;
      const mark = row[start]!;
      if (mark !== '.') b.add(start, y, 1, c, y + 1, 2, material[mark]!);
      start = c;
    }
  });
  // Two soft folds: the middle of each drops back a cell and its edges are two cells thick, so the cloth stays
  // joined face to face.
  for (let c = 8; c < FLAG_LENGTH; c += 7) {
    for (let r = 0; r < FLAG_HEIGHT; r++) {
      const row = grid[r]!, y = FLAG_HEIGHT - 1 - r;
      for (let k = c; k < Math.min(c + 3, FLAG_LENGTH); k++) {
        const mark = row[k];
        if (!mark || mark === '.') continue;
        if (k === c + 1) b.add(k, y, 1, k + 1, y + 1, 2, MAT.air);
        b.add(k, y, 0, k + 1, y + 1, 1, material[mark]!);
      }
    }
  }
  return {
    version: 1, id: `genesis-${name}-flag-${style}-${cut}-${colours.field}-${colours.band}`, styleId: StyleIdSchema.parse(STYLES[style].id),
    kind: 'prop', lattice: 'build', size: [FLAG_LENGTH, FLAG_HEIGHT, 2], boxes: b.list, windows: [],
  };
}

/** Occupied bounds of a blueprint, measured from its authored boxes. */
export function extentOf(blueprint: VoxelBlueprint): CellBox {
  const from: [number, number, number] = [Infinity, Infinity, Infinity], to: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of blueprint.boxes) {
    if (box.material === MAT.air) continue;
    for (let d = 0; d < 3; d++) { from[d] = Math.min(from[d]!, box.from[d]!); to[d] = Math.max(to[d]!, box.to[d]!); }
  }
  return { from, to };
}
