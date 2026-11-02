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

/**
 * All coordinates and metadata use local build cells; the front faces south (+Z).
 * Each kit has its own hand: Hearth is limestone, terracotta and painted homeliness; Tide is cream paint, slate,
 * rope and iron by the sea; Grove is bark, moss, split logs and weaving. The lantern glass, its light and the
 * board's chalk face are the same in every kit, because the pier layer reads them.
 */
function build(style: StyleKey, kind: PierFurnishingKind): PierFurnishing {
  const kit = STYLES[style], boxes: Box[] = [];
  const put = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) =>
    boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  /** A one-cell ring around a footprint, at one height band. */
  const ring = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => {
    put(x, y, z, X, Y, z + 1, material); put(x, y, Z - 1, X, Y, Z, material);
    put(x, y, z + 1, x + 1, Y, Z - 1, material); put(X - 1, y, z + 1, X, Y, Z - 1, material);
  };
  const hearth = style === 'hearth', tide = style === 'tide';
  const wood = kit.trim, dark = MAT.bark, metal = MAT.brass, rope = MAT.thatch;
  /** The kit's paint or crown: terracotta tiles, cream paint, or moss. */
  const accent = hearth ? MAT.terracotta : tide ? MAT.cream : MAT.moss;
  /** What a piece stands on: dressed limestone, sea stone, or dark river stone. */
  const footing = kit.stone;
  if (kind === 'lantern') {
    put(0, 0, 0, 4, 2, 4, footing); put(1, 2, 1, 3, 13, 3, wood);
    if (hearth) { put(0, 2, 0, 4, 3, 4, footing); put(1, 7, 1, 3, 8, 3, MAT.cream); put(3, 10, 1, 4, 11, 3, metal); }
    else if (tide) { ring(0, 3, 0, 4, 5, 4, rope); put(1, 8, 1, 3, 9, 3, MAT.cream); put(1, 11, 1, 3, 12, 3, MAT.cream); }
    else { put(0, 2, 0, 2, 3, 2, MAT.moss); put(2, 2, 2, 4, 3, 4, MAT.leaf); put(0, 6, 1, 1, 9, 2, dark); }
    put(0, 13, 0, 4, 14, 4, metal); put(0, 14, 0, 4, 19, 4, MAT.glass);
    for (const x of [0, 3]) for (const z of [0, 3]) put(x, 14, z, x + 1, 19, z + 1, metal);
    put(0, 19, 0, 4, 20, 4, metal);
    if (hearth) { put(0, 20, 0, 4, 21, 4, MAT.terracotta); put(1, 21, 1, 3, 22, 3, MAT.terracotta); put(1, 22, 1, 3, 23, 3, metal); }
    else if (tide) { put(0, 20, 0, 4, 21, 4, MAT.slate); put(1, 21, 1, 3, 22, 3, MAT.slate); put(1, 22, 1, 2, 23, 3, metal); put(2, 22, 1, 3, 23, 2, metal); }
    else { put(0, 20, 0, 4, 21, 4, MAT.moss); put(1, 21, 1, 3, 22, 3, MAT.leaf); put(1, 22, 1, 2, 23, 2, MAT.goldLeaf); put(2, 22, 2, 3, 23, 3, MAT.leaf); }
  } else if (kind === 'rack') {
    // Narrow side-on rack: 6 cells across X, 12 deep; three separate rods along Z.
    put(0, 0, 0, 6, 1, 12, hearth ? footing : dark);
    for (const z of [1, 10]) put(0, 1, z, 2, 15, z + 1, wood);
    put(0, 4, 1, 2, 6, 11, wood); put(0, 13, 1, 2, 15, 11, wood);
    for (const z of [3, 6, 9]) {
      put(2, 1, z, 3, 16, z + 1, dark); put(2, 16, z, 3, 20, z + 1, rope);
      put(3, 19, z, 4, 21, z + 1, rope); put(2, 3, z, 3, 5, z + 1, metal);
    }
    put(0, 15, 1, 2, 16, 11, accent);
    if (hearth) { put(0, 16, 0, 2, 17, 12, MAT.terracotta); put(0, 7, 2, 1, 12, 10, MAT.cream); }
    else if (tide) { for (const z of [1, 10]) { put(0, 5, z - 1, 2, 6, z, rope); put(0, 14, z - 1, 2, 15, z, rope); } put(0, 16, 1, 2, 17, 11, MAT.slate); }
    else { put(0, 15, 0, 2, 17, 1, MAT.leaf); put(0, 15, 11, 2, 17, 12, MAT.leaf); put(0, 1, 0, 2, 2, 2, MAT.moss); }
  } else if (kind === 'lectern') {
    put(3, 0, 3, 9, 1, 9, footing); put(5, 1, 5, 7, 12, 7, wood);
    put(2, 11, 2, 10, 12, 10, dark); put(2, 12, 2, 10, 13, 10, wood);
    // Open book: layered parchment, a central binding and a little wax seal.
    put(2, 13, 3, 10, 14, 9, MAT.cream); put(3, 14, 3, 9, 15, 8, MAT.cream);
    put(5, 14, 3, 6, 15, 9, dark); put(8, 14, 7, 9, 15, 8, MAT.terracotta);
    for (const x of [1, 10]) put(x, 11, 2, x + 1, 19, 3, wood);
    put(1, 18, 2, 11, 19, 3, wood);
    put(0, 19, 1, 12, 20, 11, kit.roof);
    if (hearth) { put(1, 20, 2, 11, 21, 10, MAT.terracotta); put(1, 20, 5, 11, 21, 7, wood); put(4, 6, 4, 8, 7, 8, MAT.cream); }
    else if (tide) { put(1, 20, 2, 11, 21, 10, MAT.slate); put(1, 20, 5, 11, 21, 7, MAT.cream); ring(4, 3, 4, 8, 4, 8, rope); }
    else { put(1, 20, 2, 11, 21, 10, MAT.thatch); put(1, 20, 5, 11, 21, 7, MAT.moss); put(4, 1, 4, 6, 2, 6, MAT.moss); put(6, 1, 6, 8, 2, 8, MAT.leaf); }
  } else if (kind === 'board') {
    for (const x of [1, 13]) { put(x, 0, 2, x + 2, 17, 4, dark); put(x, 0, 1, x + 2, 1, 5, hearth ? footing : wood); }
    put(1, 6, 2, 15, 18, 4, wood); put(2, 7, 4, 14, 17, 5, MAT.darkStone);
    put(0, 6, 3, 16, 7, 6, wood); put(0, 17, 3, 16, 19, 6, wood);
    put(0, 7, 3, 2, 17, 6, wood); put(14, 7, 3, 16, 17, 6, wood);
    put(2, 18, 4, 14, 19, 5, accent);
    // A chalk ledge under the face, and the kit's crest along the top.
    put(2, 6, 5, 14, 7, 6, hearth ? MAT.terracotta : tide ? MAT.slate : dark); put(4, 6, 5, 5, 7, 6, MAT.cream);
    if (hearth) put(0, 18, 2, 16, 19, 6, MAT.terracotta);
    else if (tide) put(0, 18, 3, 16, 19, 6, MAT.cream);
    else { put(0, 18, 3, 3, 19, 6, MAT.moss); put(13, 18, 3, 16, 19, 6, MAT.leaf); }
  } else if (kind === 'bench') {
    if (style === 'grove') {
      // A split log on two stumps: bark below, the pale split face on top, and a bent-branch back.
      for (const x of [2, 14]) { put(x, 0, 2, x + 2, 5, 6, dark); put(x, 0, 1, x + 2, 1, 7, MAT.moss); }
      put(0, 5, 2, 18, 6, 7, dark); put(1, 6, 1, 17, 7, 7, MAT.cream); put(0, 6, 1, 1, 7, 7, dark); put(17, 6, 1, 18, 7, 7, dark);
      for (const x of [2, 15]) put(x, 7, 1, x + 1, 12, 2, dark);
      put(1, 11, 1, 17, 12, 2, dark); put(4, 12, 1, 7, 13, 2, MAT.moss); put(11, 12, 1, 13, 13, 2, MAT.leaf);
    } else {
      for (const x of [2, 14]) { put(x, 0, 1, x + 2, 6, 7, hearth ? footing : dark); put(x, 6, 1, x + 2, 12, 2, wood); }
      const slat = tide ? MAT.cream : wood;
      put(0, 6, 1, 18, 7, 7, slat); put(1, 7, 1, 17, 8, 3, slat);
      put(1, 9, 1, 17, 11, 2, slat); put(0, 12, 1, 18, 13, 3, hearth ? MAT.terracotta : MAT.slate);
      put(1, 5, 6, 17, 6, 7, metal);
      if (hearth) put(2, 7, 3, 16, 8, 7, MAT.cloth);
      else { put(0, 4, 1, 1, 6, 7, MAT.slate); put(17, 4, 1, 18, 6, 7, MAT.slate); }
    }
  } else if (kind === 'mooring') {
    if (hearth) {
      // A dressed limestone bollard with a timber cap.
      put(1, 0, 1, 7, 1, 7, footing); put(2, 1, 2, 6, 8, 6, footing);
      put(1, 7, 1, 7, 8, 7, footing); put(2, 8, 2, 6, 10, 6, wood); put(3, 10, 3, 5, 11, 5, MAT.terracotta);
    } else if (tide) {
      // A cast-iron bollard: a waisted shank under a mushroom head.
      put(1, 0, 1, 7, 1, 7, footing); put(2, 1, 2, 6, 3, 6, MAT.darkStone); put(3, 3, 3, 5, 7, 5, MAT.darkStone);
      put(2, 6, 2, 6, 7, 6, MAT.darkStone); put(1, 7, 1, 7, 9, 7, MAT.darkStone); put(2, 9, 2, 6, 10, 6, MAT.darkStone);
      put(3, 10, 3, 5, 11, 5, metal);
    } else {
      // An old stump with its roots, a pale cut face and moss.
      put(1, 0, 2, 7, 1, 6, dark); put(2, 0, 1, 6, 1, 7, dark); put(2, 1, 2, 6, 9, 6, dark);
      put(2, 9, 2, 6, 10, 6, MAT.cream); put(3, 9, 3, 5, 10, 5, MAT.thatch); put(2, 10, 2, 4, 11, 4, MAT.moss);
      put(0, 0, 3, 1, 1, 5, dark); put(7, 0, 3, 8, 1, 5, dark);
    }
    // Rope collar laid around the shank and a short knotted tail.
    const [low, high] = tide ? [3, 6] : [1, 7];
    const y = tide ? 4 : 3;
    put(low, y, low, high, y + 1, low + 1, rope); put(low, y, high - 1, high, y + 1, high, rope);
    put(low, y, low + 1, low + 1, y + 1, high - 1, rope); put(high - 1, y, low + 1, high, y + 1, high - 1, rope);
    put(3, y + 1, low, 5, y + 2, low + 1, rope);
  } else if (hearth) {
    // A glazed clay bait pot with a wide rim, the bait dark inside.
    put(2, 0, 2, 6, 1, 6, MAT.terracotta);
    ring(1, 1, 1, 7, 8, 7, MAT.terracotta); put(2, 1, 2, 6, 5, 6, MAT.earth);
    ring(0, 7, 0, 8, 8, 8, MAT.terracotta); ring(1, 2, 1, 7, 3, 7, MAT.cream);
  } else if (tide) {
    // A cream-painted pail with slate hoops and a rope handle.
    put(1, 0, 1, 7, 1, 7, dark);
    ring(1, 1, 1, 7, 6, 7, wood); ring(1, 2, 1, 7, 3, 7, MAT.cream); ring(1, 5, 1, 7, 6, 7, MAT.slate);
    put(2, 1, 2, 6, 4, 6, MAT.earth);
    for (const x of [1, 6]) put(x, 6, 3, x + 1, 8, 5, rope);
    put(1, 8, 3, 7, 9, 5, rope);
  } else {
    // A woven creel: thatch walls on bark ribs, moss in the mouth.
    put(1, 0, 1, 7, 1, 7, dark);
    ring(1, 1, 1, 7, 8, 7, MAT.thatch); ring(1, 3, 1, 7, 4, 7, dark); ring(0, 7, 0, 8, 8, 8, dark);
    put(2, 1, 2, 6, 5, 6, MAT.moss); put(2, 5, 2, 4, 6, 4, MAT.leaf);
  }
  const blueprint: VoxelBlueprint = { version: 1, id: `pier-${style}-${kind}`, styleId: kit.id, kind: 'prop', lattice: 'build', size: [...sizes[kind]], boxes, windows: [] };
  return { kind, blueprint,
    ...(kind === 'lantern' ? { light: { position: [2, 16, 2] as Vec3, reach: 32 } } : {}),
    ...(kind === 'board' ? { text: { centre: [8, 12, 5] as Vec3, facing: 'south' as const, width: 12, height: 10 } } : {}),
  };
}
export function createPierFurnishings(style: StyleKey): readonly PierFurnishing[] { return forms.map(kind => build(style, kind)); }
export const BLUEPRINTS: readonly VoxelBlueprint[] = (['hearth', 'tide', 'grove'] as const).flatMap(style => createPierFurnishings(style).map(p => p.blueprint));
