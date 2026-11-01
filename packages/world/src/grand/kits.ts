import { generateTreeShape, treeExtent } from './trees';
import { grandPalette, GrandKind, M, type GrandMaterial } from './palette';
import { STRUCTURE_COLOURS, STRUCTURE_STRIDE, type GrandComposeInput, type GrandDressingKits, type GrandKitPlacement, type GrandLand } from './types';

/** The built-in kits: the tree generator and no structures (the land alone). */
export const GRAND_DEFAULT_KITS: GrandDressingKits = { trees: { extent: treeExtent, shape: generateTreeShape }, compose: [] };

// The dressing lane's kits plug in here when their module exists; see "Dressing kits" in ./types.ts.
const found = import.meta.glob<{ GRAND_ARTISAN_KITS?: Partial<GrandDressingKits> }>('./artisans/index.ts', { eager: true });
const artisan = Object.values(found)[0]?.GRAND_ARTISAN_KITS ?? {};

export const GRAND_KITS: GrandDressingKits = {
  trees: artisan.trees ?? GRAND_DEFAULT_KITS.trees,
  compose: artisan.compose ?? GRAND_DEFAULT_KITS.compose,
};

/** Rotate a piece's box by quarter turns about +Y (x, z) → (−z − sz, x), then place it. Exclusive max. */
export function placeBoxes(placements: readonly GrandKitPlacement[], size: number, height: number): { boxes: Int32Array; count: number; colours: string[] } {
  const colours: string[] = [], index = new Map<string, number>(), out: number[] = [];
  const material = (colour: string) => {
    const key = colour.toLowerCase();
    let i = index.get(key);
    if (i === undefined) {
      // Past 128 colours a piece reuses the last slot rather than spilling into land materials.
      i = Math.min(colours.length, STRUCTURE_COLOURS - 1);
      if (i === colours.length) colours.push(key);
      index.set(key, i);
    }
    return M.structureBase + i;
  };
  for (const { piece, at, turns } of placements) {
    const t = ((turns % 4) + 4) % 4;
    for (const box of piece.boxes) {
      const y = box.min[1], sy = box.size[1];
      let [x, , z] = box.min, [sx, , sz] = box.size;
      for (let k = 0; k < t; k++) { [x, z] = [-z - sz, x]; [sx, sz] = [sz, sx]; }
      const x0 = Math.max(0, x + at[0]), y0 = Math.max(0, y + at[1]), z0 = Math.max(0, z + at[2]);
      const x1 = Math.min(size, x + at[0] + sx), y1 = Math.min(height, y + at[1] + sy), z1 = Math.min(size, z + at[2] + sz);
      if (x1 <= x0 || y1 <= y0 || z1 <= z0) continue;
      out.push(x0, y0, z0, x1, y1, z1, material(box.colour));
    }
  }
  return { boxes: Int32Array.from(out), count: out.length / STRUCTURE_STRIDE, colours };
}

/** Run every composer on the finished land and place what they return. */
export function composeStructures(land: GrandComposeInput, kits: GrandDressingKits = GRAND_KITS): { boxes: Int32Array; count: number; colours: string[] } {
  const placements: GrandKitPlacement[] = [];
  for (const compose of kits.compose) placements.push(...compose(land));
  return placeBoxes(placements, land.size, land.height);
}

/** The land's full material list: its style palette plus the colours its structures brought. */
export function landMaterials(land: Pick<GrandLand, 'style' | 'structureColours'>): GrandMaterial[] {
  return [...grandPalette(land.style), ...land.structureColours.map((colour, i) => ({ id: M.structureBase + i, colour, kind: GrandKind.stone }))];
}
