import { BAKED_MAX_SIDE, BAKED_MAX_HEIGHT, BAKED_REGION_QUAD_BYTES, type BakedRegionKey, type BakedRegionMesh, type BakedSurface } from './types';

export function integer(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Invalid baked ${label}`);
}
export function assertDimensions(size: number, height: number, seaLevel: number): void {
  integer(size, 256, BAKED_MAX_SIDE, 'side');
  if (size % 256 !== 0) throw new RangeError('Baked side must contain whole regions');
  integer(height, 32, BAKED_MAX_HEIGHT, 'height');
  if (height % 32 !== 0) throw new RangeError('Baked height must contain whole chunks');
  integer(seaLevel, 0, height, 'sea level');
}
export function assertRegionKey(key: BakedRegionKey, size = BAKED_MAX_SIDE): void {
  integer(key.level, 0, 3, 'level');
  integer(key.rx, 0, size / 256 - 1, 'region x');
  integer(key.rz, 0, size / 256 - 1, 'region z');
}
export function assertMesh(mesh: BakedRegionMesh): void {
  assertRegionKey(mesh);
  const { quads, offsets, minY, maxY, level } = mesh, per = 8 >> level;
  integer(minY, 0, BAKED_MAX_HEIGHT >> level, 'mesh minimum');
  integer(maxY, minY, BAKED_MAX_HEIGHT >> level, 'mesh maximum');
  if (minY % 32 || maxY % 32 || !(quads instanceof Uint32Array) || quads.length % 2
    || quads.byteLength > BAKED_REGION_QUAD_BYTES || !(offsets instanceof Int32Array)
    || offsets.length !== 7 || offsets[0] !== 0 || offsets[6] !== quads.length / 2)
    throw new RangeError('Invalid baked mesh layout');
  for (let face = 0; face < 6; face++) {
    integer(offsets[face + 1]!, offsets[face]!, quads.length / 2, 'face offset');
    for (let q = offsets[face]!; q < offsets[face + 1]!; q++) {
      const a = quads[q * 2]!, b = quads[q * 2 + 1]!, slot = b >>> 16;
      const coords = [a & 31, (a >>> 5) & 31, (a >>> 10) & 31], axis = face >> 1;
      const y = ((slot >>> 4) & 15) * 32 + coords[1]!;
      if (a >>> 29 || ((a >>> 25) & 7) !== face || !(b & 255) || slot >>> 12
        || (slot & 15) >= per || ((slot >>> 8) & 15) >= per
        || coords[(axis + 1) % 3]! + ((a >>> 15) & 31) + 1 > 32
        || coords[(axis + 2) % 3]! + ((a >>> 20) & 31) + 1 > 32
        || y < minY || y >= maxY)
        throw new RangeError('Invalid baked packed quad');
    }
  }
}
export function assertSurface(surface: BakedSurface): void {
  const { size, height, seaLevel, ground, water } = surface;
  assertDimensions(size, height, seaLevel);
  if (!(ground instanceof Uint16Array) || !(water instanceof Uint16Array)
    || ground.length !== size * size || water.length !== ground.length) throw new RangeError('Invalid baked surface size');
  for (let i = 0; i < ground.length; i++) if (ground[i]! > height || water[i]! > height)
    throw new RangeError('Baked surface exceeds its world height');
}
