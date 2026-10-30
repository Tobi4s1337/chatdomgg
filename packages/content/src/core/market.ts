import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
type Add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => void;
const writer = (boxes: Box[]): Add => (x, y, z, X, Y, Z, material) => {
  boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
};

/** A little roofed well: a stone rim, blue water and a hand-turned timber spindle. */
export function createMarketWell(): VoxelBlueprint {
  const boxes: Box[] = [], add = writer(boxes);
  // The stone base and raised, open rim are stepped at the corners.
  add(4, 0, 2, 28, 3, 30, MAT.stone);
  add(2, 0, 4, 30, 3, 28, MAT.stone);
  add(5, 3, 3, 27, 12, 7, MAT.limestone);
  add(5, 3, 25, 27, 12, 29, MAT.limestone);
  add(3, 3, 7, 7, 12, 25, MAT.limestone);
  add(25, 3, 7, 29, 12, 25, MAT.limestone);
  add(6, 3, 6, 26, 4, 26, MAT.waterbed);
  add(4, 12, 2, 28, 14, 7, MAT.stone);
  add(4, 12, 25, 28, 14, 30, MAT.stone);
  add(2, 12, 7, 7, 14, 25, MAT.stone);
  add(25, 12, 7, 30, 14, 25, MAT.stone);
  // Opposed uprights carry the roof and a spindle; all touch the stone rim.
  add(4, 14, 14, 8, 29, 18, MAT.timber);
  add(24, 14, 14, 28, 29, 18, MAT.timber);
  add(3, 27, 13, 29, 30, 19, MAT.timber);
  add(6, 20, 15, 26, 22, 17, MAT.bark);
  add(14, 14, 15, 18, 20, 17, MAT.thatch); // rope around the spindle
  add(12, 12, 14, 20, 14, 18, MAT.timber); // bucket nestled inside the rim
  // The overhanging roof has a thick, stepped pitch and timber-edged eaves.
  for (let step = 0; step < 5; step++) {
    add(1, 29 + step * 2, 1 + step * 3, 31, 31 + step * 2, 31 - step * 3, MAT.slate);
  }
  add(0, 29, 1, 2, 31, 31, MAT.timber);
  add(30, 29, 1, 32, 31, 31, MAT.timber);
  add(1, 37, 12, 31, 39, 20, MAT.timber);
  // A mossy stone is authored into the lower outside corner, not random noise.
  add(3, 3, 6, 5, 5, 10, MAT.moss);
  return { version: 1, id: 'market-roofed-well', styleId: STYLES.tide.id, kind: 'prop', lattice: 'build',
    size: [32, 40, 32], boxes, windows: [] };
}

/** A staffed-place silhouette without invented townsfolk: a timber trestle and striped awning. */
export function createMarketStall(variant: 0 | 1): VoxelBlueprint {
  if (variant !== 0 && variant !== 1) throw new Error('Unknown market stall variant');
  const boxes: Box[] = [], add = writer(boxes);
  for (const x of [3, 34]) for (const z of [3, 18]) add(x, 0, z, x + 3, 25, z + 3, MAT.timber);
  add(2, 10, 3, 38, 13, 21, MAT.timber); // thick counter on four legs
  add(4, 2, 5, 36, 10, 7, MAT.bark);
  add(4, 2, 17, 36, 10, 19, MAT.bark);
  add(2, 22, 2, 38, 25, 5, MAT.timber);
  add(2, 22, 19, 38, 25, 22, MAT.timber);
  add(3, 22, 4, 6, 25, 20, MAT.timber);
  add(34, 22, 4, 37, 25, 20, MAT.timber);
  // A soft striped tent, stepped toward the central ridge, with real cloth thickness.
  for (let x = 0; x < 40; x += 5) for (let step = 0; step < 4; step++) {
    const colour = ((x / 5 + variant) % 2) ? MAT.cream : MAT.cloth;
    add(x, 24 + step * 2, step * 3, x + 5, 26 + step * 2, 24 - step * 3, colour);
  }
  // Crates and differently shaped goods give the two stalls an authored identity.
  add(5, 13, 6, 16, 16, 16, MAT.bark);
  add(6, 16, 7, 15, 17, 15, variant ? MAT.leaf : MAT.thatch);
  add(8, 17, 8, 11, 19, 11, variant ? MAT.petal : MAT.cream);
  add(12, 17, 10, 14, 19, 13, variant ? MAT.terracotta : MAT.thatch);
  add(22, 13, 7, 34, 15, 17, MAT.bark);
  add(23, 15, 8, 27, 18, 12, variant ? MAT.thatch : MAT.terracotta);
  add(29, 15, 10, 33, 18, 14, variant ? MAT.cream : MAT.terracotta);
  return { version: 1, id: `market-stall-${variant}`, styleId: STYLES.hearth.id, kind: 'prop', lattice: 'build',
    size: [40, 32, 24], boxes, windows: [] };
}
