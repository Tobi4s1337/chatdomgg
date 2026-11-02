/** Frozen pre-extraction hosted worker algorithm, retained only as a byte parity oracle.
 * Captured from apps/web/src/kingdom/grand-land/worker.ts before the offline extraction, 2026-11-02.
 * Keep independent of baked/mesher.ts; deliberate compiler changes must version the recipe. */
import { createVoxelizeContext, voxelizeChunk, chunkColumnRange, PAD_VOLUME } from '../voxelize';
import { GrandKind, M, kindTable } from '../palette';
import { landMaterials } from '../kits';
import { GRAND_CHUNK, GRAND_REGION } from '../types';
import { createQuadBuckets, meshQuadChunk, packQuadBuckets, QUAD_FLAG_AO, QUAD_FLAG_EMIT } from '../../../../voxel/src/grand/quad-mesher';
import { regionTouchesPhysical, restoreInstalledFloor, type PreparedGrandLand } from './prepare';
import type { BakedRegionKey } from './types';

export function originalHostedMesh({ land, seated }: PreparedGrandLand, { level, rx, rz }: BakedRegionKey) {
  const ctx = createVoxelizeContext(land), volume = new Uint8Array(PAD_VOLUME), kinds = kindTable(landMaterials(land));
  const flags = new Uint8Array(256);
  for (let m = 1; m < 256; m++) if (kinds[m] !== GrandKind.air)
    flags[m] = QUAD_FLAG_EMIT | (kinds[m] === GrandKind.water ? 0 : QUAD_FLAG_AO);
  flags[M.sea] = 0; flags[126] = QUAD_FLAG_EMIT | QUAD_FLAG_AO;
  if (level !== 0 && regionTouchesPhysical(rx, rz, seated)) throw new Error('Installed physical ground must render at half-metre resolution');
  const s = 1 << level;
  const per = Math.max(1, (GRAND_REGION / GRAND_CHUNK) >> level), coarse = GRAND_REGION / s;
  const skirt = level > 0 ? [rx * coarse, rz * coarse, (rx + 1) * coarse, (rz + 1) * coarse] as const : undefined;
  const buckets = createQuadBuckets(4096);
  let minY = Infinity, maxY = -Infinity;
  for (let lz = 0; lz < per; lz++) for (let lx = 0; lx < per; lx++) {
    const cx = rx * per + lx, cz = rz * per + lz;
    const range = chunkColumnRange(ctx, level, cx, cz);
    const lo = Math.max(0, Math.floor(range.lo / GRAND_CHUNK));
    const hi = Math.min(Math.ceil(land.height / s / GRAND_CHUNK) - 1, Math.floor((range.hi - 1) / GRAND_CHUNK));
    for (let cy = lo; cy <= hi; cy++) {
      voxelizeChunk(ctx, level, cx, cy, cz, volume, skirt ? { skirt } : {});
      if (level === 0) restoreInstalledFloor(land, seated, cx, cy, cz, volume);
      const emitted = meshQuadChunk(volume, flags, lx | (cy << 4) | (lz << 8), buckets);
      if (emitted > 0) { minY = Math.min(minY, cy * GRAND_CHUNK); maxY = Math.max(maxY, (cy + 1) * GRAND_CHUNK); }
      if (buckets.counts.reduce((sum, count) => sum + count, 0) * 8 > 8 * 1024 * 1024)
        throw new Error('A grand terrain region exceeds the bounded mesh result budget');
    }
  }
  for (const face of [2, 3]) {
    const words = buckets.faces[face]!; let kept = 0;
    for (let q = 0; q < buckets.counts[face]!; q++) {
      if ((words[q * 2 + 1]! & 255) === M.water) continue;
      words[kept * 2] = words[q * 2]!; words[kept * 2 + 1] = words[q * 2 + 1]!; kept++;
    }
    buckets.counts[face] = kept;
  }
  return { level, rx, rz, ...packQuadBuckets(buckets),
    minY: Number.isFinite(minY) ? minY : 0, maxY: Number.isFinite(maxY) ? maxY : 0 };
}
