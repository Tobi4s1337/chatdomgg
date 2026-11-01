import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
export type PierFurnishingKind = 'lantern' | 'rack' | 'lectern' | 'board' | 'bench' | 'mooring' | 'bucket';
export interface PierFurnishing {
  readonly kind: PierFurnishingKind;
  readonly blueprint: VoxelBlueprint;
  readonly light?: { readonly position: Vec3; readonly reach: number };
  readonly text?: { readonly centre: Vec3; readonly facing: 'north' | 'south' | 'east' | 'west'; readonly width: number; readonly height: number };
}
const forms: readonly PierFurnishingKind[] = ['lantern', 'rack', 'lectern', 'board', 'bench', 'mooring', 'bucket'];
const sizes: Record<PierFurnishingKind, Vec3> = {
  lantern: [4, 23, 4], rack: [6, 21, 12], lectern: [12, 21, 12], board: [16, 19, 6],
  bench: [18, 13, 8], mooring: [8, 11, 8], bucket: [8, 9, 8],
};

/** All coordinates and metadata use local build cells; the front faces south (+Z). */
function build(style: StyleKey, kind: PierFurnishingKind): PierFurnishing {
  const kit = STYLES[style], boxes: Box[] = [];
  const put = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) =>
    boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  const wood = kit.trim, dark = MAT.bark, metal = MAT.brass;
  const accent = style === 'hearth' ? MAT.terracotta : style === 'tide' ? MAT.slate : MAT.moss;
  if (kind === 'lantern') {
    put(0, 0, 0, 4, 1, 4, dark); put(1, 1, 1, 3, 14, 3, wood);
    put(0, 13, 0, 4, 14, 4, metal); put(0, 14, 0, 4, 19, 4, MAT.glass);
    for (const x of [0, 3]) for (const z of [0, 3]) put(x, 14, z, x + 1, 19, z + 1, metal);
    put(0, 19, 0, 4, 20, 4, metal); put(1, 20, 1, 3, 22, 3, accent); put(1, 22, 1, 3, 23, 3, metal);
  } else if (kind === 'rack') {
    // Narrow side-on rack: 6 cells across X, 12 deep; three separate rods along Z.
    put(0, 0, 0, 6, 1, 12, dark);
    for (const z of [1, 10]) put(0, 1, z, 2, 15, z + 1, wood);
    put(0, 4, 1, 2, 6, 11, wood); put(0, 13, 1, 2, 15, 11, wood);
    for (const z of [3, 6, 9]) {
      put(2, 1, z, 3, 16, z + 1, dark); put(2, 16, z, 3, 20, z + 1, MAT.thatch);
      put(3, 19, z, 4, 21, z + 1, MAT.thatch); put(2, 3, z, 3, 5, z + 1, metal);
    }
    put(0, 15, 1, 2, 16, 11, accent);
  } else if (kind === 'lectern') {
    put(3, 0, 3, 9, 1, 9, dark); put(5, 1, 5, 7, 12, 7, wood);
    put(2, 11, 2, 10, 12, 10, dark); put(2, 12, 2, 10, 13, 10, wood);
    // Open book: layered parchment, a central binding and a little wax seal.
    put(2, 13, 3, 10, 14, 9, MAT.cream); put(3, 14, 3, 9, 15, 8, MAT.cream);
    put(5, 14, 3, 6, 15, 9, dark); put(8, 14, 7, 9, 15, 8, MAT.terracotta);
    for (const x of [1, 10]) put(x, 11, 2, x + 1, 19, 3, wood);
    put(0, 19, 1, 12, 20, 11, kit.roof); put(1, 20, 2, 11, 21, 10, accent);
    put(1, 18, 2, 11, 19, 3, wood);
  } else if (kind === 'board') {
    for (const x of [1, 13]) { put(x, 0, 2, x + 2, 17, 4, dark); put(x, 0, 1, x + 2, 1, 5, wood); }
    put(1, 6, 2, 15, 18, 4, wood); put(2, 7, 4, 14, 17, 5, MAT.darkStone);
    put(0, 6, 3, 16, 7, 6, wood); put(0, 17, 3, 16, 19, 6, wood);
    put(0, 7, 3, 2, 17, 6, wood); put(14, 7, 3, 16, 17, 6, wood);
    put(2, 18, 4, 14, 19, 5, accent);
  } else if (kind === 'bench') {
    for (const x of [2, 14]) { put(x, 0, 1, x + 2, 6, 7, dark); put(x, 6, 1, x + 2, 12, 2, wood); }
    put(0, 6, 1, 18, 7, 7, wood); put(1, 7, 1, 17, 8, 3, wood);
    put(1, 9, 1, 17, 11, 2, wood); put(0, 12, 1, 18, 13, 3, accent);
    put(1, 5, 6, 17, 6, 7, metal);
  } else if (kind === 'mooring') {
    put(1, 0, 1, 7, 1, 7, kit.stone); put(2, 1, 2, 6, 8, 6, dark);
    put(1, 7, 2, 7, 9, 6, wood); put(2, 9, 2, 6, 10, 6, wood);
    // Rope collar laid around the shank and a short knotted tail.
    put(1, 3, 1, 7, 4, 2, MAT.thatch); put(1, 3, 6, 7, 4, 7, MAT.thatch);
    put(1, 3, 2, 2, 4, 6, MAT.thatch); put(6, 3, 2, 7, 4, 6, MAT.thatch);
    put(3, 4, 1, 5, 5, 2, MAT.thatch); put(3, 10, 3, 5, 11, 5, metal);
  } else {
    // Staves and hoops, with an open dark well rather than a solid top.
    put(1, 0, 1, 7, 1, 7, dark);
    put(1, 1, 1, 7, 8, 2, wood); put(1, 1, 6, 7, 8, 7, wood);
    put(1, 1, 2, 2, 8, 6, wood); put(6, 1, 2, 7, 8, 6, wood);
    for (const y of [2, 6]) {
      put(1, y, 0, 7, y + 1, 1, metal); put(1, y, 7, 7, y + 1, 8, metal);
      put(0, y, 1, 1, y + 1, 7, metal); put(7, y, 1, 8, y + 1, 7, metal);
    }
    put(2, 8, 1, 6, 9, 2, accent); put(2, 8, 6, 6, 9, 7, accent);
  }
  const blueprint: VoxelBlueprint = { version: 1, id: `pier-${style}-${kind}`, styleId: kit.id, kind: 'prop', lattice: 'build', size: [...sizes[kind]], boxes, windows: [] };
  return { kind, blueprint,
    ...(kind === 'lantern' ? { light: { position: [2, 16, 2] as Vec3, reach: 32 } } : {}),
    ...(kind === 'board' ? { text: { centre: [8, 12, 5] as Vec3, facing: 'south' as const, width: 12, height: 10 } } : {}),
  };
}
export function createPierFurnishings(style: StyleKey): readonly PierFurnishing[] { return forms.map(kind => build(style, kind)); }
export const BLUEPRINTS: readonly VoxelBlueprint[] = (['hearth', 'tide', 'grove'] as const).flatMap(style => createPierFurnishings(style).map(p => p.blueprint));
