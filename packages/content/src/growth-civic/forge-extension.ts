import { Boxes, type CivicKit } from '../civic/kit';
import { MAT } from '../materials';

/**
 * Mount createForgeHearth at this offset inside the 64 × 64 × 32 growth form.
 * The entire [20,44) × [0,37) × [7,25) hearth envelope, including its
 * sleeping dragon, stays empty in every addition. Both mouths face +Z.
 * Subtract the hearth's ground pivot [12,0,9] from its world anchor to
 * place the hearth, then subtract this offset to place the growth form.
 */
export const FORGE_EXTENSION_HEARTH_OFFSET = [20, 0, 7] as const;
export const FORGE_EXTENSION_HEARTH_PIVOT = [32, 0, 16] as const;
export const FORGE_EXTENSION_FLAME = [32, 6, 22] as const;

/** Additional masonry and smith's equipment only; the original hearth is mounted separately.
 * Stages accumulate, and levels above four retain the mature form. */
export function createForgeExtension(k: CivicKit, level: number): Boxes['list'] {
  if (!Number.isSafeInteger(level) || level < 1) throw new Error('Forge level must be a positive safe integer');
  const stage = Math.min(level, 4), b = new Boxes();

  // Low, individually coursed side aprons meet the old curb without covering it.
  for (const x of [14, 44]) {
    b.add(x, 0, 8, x + 6, 2, 25, k.base);
    b.add(x + 1, 2, 9, x + 5, 3, 24, k.stone);
    for (const z of [10, 16, 22]) b.add(x + 1, 3, z, x + 5, 4, z + 1, k.band);
  }
  // Loose iron poker resting on the left stone ledge.
  b.add(16, 4, 10, 17, 5, 21, MAT.darkStone);
  b.add(15, 4, 10, 17, 5, 12, MAT.forgeCopper);

  if (stage >= 2) {
    // Paired masonry piers rise beyond the original hearth's protected envelope.
    for (const x of [15, 44]) {
      b.add(x, 0, 8, x + 5, 26, 13, k.stone);
      b.add(x, 24, 7, x + 5, 27, 14, k.base);
    }
    // Paired brick cheeks extend the hearth's mass, with hand-laid cap stones.
    for (const x of [15, 44]) {
      b.add(x, 4, 8, x + 5, 12, 17, MAT.brick);
      b.add(x, 12, 8, x + 5, 14, 17, k.stone);
      b.add(x, 7, 17, x + 5, 8, 18, k.band);
      b.add(x, 13, 17, x + 5, 14, 18, k.base);
    }
  }
  if (stage >= 3) {
    // An open smithy roof bridges the hearth above its reserved dragon envelope.
    for (const x of [15, 44]) b.add(x, 27, 8, x + 5, 39, 13, k.trim);
    b.add(14, 37, 7, 50, 39, 15, k.trim);
    for (let i = 0; i < 7; i++) b.add(12 + i, 39 + i, 5, 52 - i, 40 + i, 19, k.roof);
    // A stout working bench to the right: top, legs, iron plate and a hammer.
    b.add(50, 8, 12, 62, 10, 23, k.trim);
    for (const x of [51, 59]) for (const z of [13, 20]) b.add(x, 0, z, x + 2, 8, z + 2, k.trim);
    b.add(52, 10, 14, 58, 11, 20, MAT.darkStone);
    b.add(58, 10, 19, 62, 11, 20, MAT.timber);
    b.add(60, 11, 18, 62, 13, 21, MAT.darkStone);
    // Upright tool rack with a pair of hanging iron tongs.
    b.add(46, 14, 9, 47, 21, 10, k.trim);
    b.add(45, 20, 9, 50, 21, 10, k.trim);
    b.add(48, 15, 9, 49, 20, 10, MAT.darkStone);
    b.add(49, 15, 9, 50, 19, 10, MAT.darkStone);
    b.add(48, 14, 9, 50, 15, 10, MAT.forgeCopper);
  }
  if (stage >= 4) {
    // The tall side chimney and hanging smith's standard give the mature forge its own skyline.
    b.add(49, 0, 3, 57, 43, 9, MAT.brick);
    b.add(48, 41, 2, 58, 44, 10, k.stone);
    b.add(50, 44, 4, 56, 48, 8, k.base);
    b.add(10, 29, 13, 20, 37, 14, k.field);
    b.add(13, 31, 14, 17, 35, 15, k.charge);
    // An open coal bin and the copper-rimmed water trough that serves the smith.
    b.add(3, 0, 10, 13, 2, 21, k.trim);
    b.add(3, 2, 10, 4, 8, 21, k.trim);
    b.add(12, 2, 10, 13, 8, 21, k.trim);
    b.add(4, 2, 10, 12, 8, 11, k.trim);
    b.add(4, 2, 20, 12, 8, 21, k.trim);
    b.add(4, 2, 11, 12, 6, 20, MAT.darkStone);
    b.add(5, 6, 12, 8, 7, 16, MAT.bark);
    b.add(9, 6, 16, 12, 7, 19, MAT.bark);
    b.add(50, 0, 25, 61, 2, 31, k.base);
    b.add(50, 2, 25, 61, 6, 31, k.stone);
    b.add(51, 6, 26, 60, 7, 30, MAT.waterbed);
    b.add(50, 6, 25, 61, 7, 26, MAT.forgeCopper);
    b.add(50, 6, 30, 61, 7, 31, MAT.forgeCopper);
    b.add(50, 6, 26, 51, 7, 30, MAT.forgeCopper);
    b.add(60, 6, 26, 61, 7, 30, MAT.forgeCopper);
  }
  return b.list;
}
