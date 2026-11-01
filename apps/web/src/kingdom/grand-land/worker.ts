/// <reference lib="webworker" />
import { createVoxelizeContext, voxelizeChunk, chunkColumnRange, PAD_VOLUME, type VoxelizeContext } from '../../../../../packages/world/src/grand/voxelize';
import { GrandKind, M, kindTable } from '../../../../../packages/world/src/grand/palette';
import { landMaterials } from '../../../../../packages/world/src/grand/kits';
import { GRAND_CHUNK, GRAND_REGION, type GrandLand } from '../../../../../packages/world/src/grand/types';
import type { SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';
import { createQuadBuckets, meshQuadChunk, packQuadBuckets, QUAD_FLAG_AO, QUAD_FLAG_EMIT } from '../../../../../packages/voxel/src/grand/quad-mesher';
import { prepareInstalledLand, regionTouchesPhysical, restoreInstalledFloor } from './prepare';
import { HOSTED_PAVING } from './palette';
import { HOSTED_RESULT_BYTES, type HostedRequest, type HostedReply, type HostedMesh } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let ctx: VoxelizeContext | undefined, seated: SeatedKingdom | undefined;
let flags = new Uint8Array(256);
const volume = new Uint8Array(PAD_VOLUME);

function adopt(land: GrandLand, seat: SeatedKingdom): void {
  ctx = createVoxelizeContext(land); seated = seat;
  const kinds = kindTable(landMaterials(land));
  flags = new Uint8Array(256);
  for (let m = 1; m < 256; m++) if (kinds[m] !== GrandKind.air)
    flags[m] = QUAD_FLAG_EMIT | (kinds[m] === GrandKind.water ? 0 : QUAD_FLAG_AO);
  flags[M.sea] = 0;
  flags[HOSTED_PAVING] = QUAD_FLAG_EMIT | QUAD_FLAG_AO;
}

function meshRegion(message: Extract<HostedRequest, { type: 'mesh' }>): HostedMesh {
  if (!ctx || !seated) throw new Error('The installed land has not been prepared');
  const { id, level, rx, rz } = message;
  if (level !== 0 && regionTouchesPhysical(rx, rz, seated)) throw new Error('Installed physical ground must render at half-metre resolution');
  const s = 1 << level, land = ctx.land;
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
      if (buckets.counts.reduce((sum, count) => sum + count, 0) * 8 > HOSTED_RESULT_BYTES)
        throw new Error('A grand terrain region exceeds the bounded mesh result budget');
    }
  }
  // The native water owner draws every horizontal water top from the same column raster.
  // Keep vertical running-water faces for the falls; never draw a second horizontal sheet.
  for (const face of [2, 3]) {
    const words = buckets.faces[face]!; let kept = 0;
    for (let q = 0; q < buckets.counts[face]!; q++) {
      if ((words[q * 2 + 1]! & 255) === M.water) continue;
      words[kept * 2] = words[q * 2]!; words[kept * 2 + 1] = words[q * 2 + 1]!; kept++;
    }
    buckets.counts[face] = kept;
  }
  return { type: 'mesh', id, level, rx, rz, ...packQuadBuckets(buckets),
    minY: Number.isFinite(minY) ? minY : 0, maxY: Number.isFinite(maxY) ? maxY : 0 };
}

scope.onmessage = (event: MessageEvent<HostedRequest>) => {
  try {
    const message = event.data;
    if (message.type === 'generate') {
      const prepared = prepareInstalledLand(message.plan, message.recipe);
      adopt(prepared.land, prepared.seated);
      scope.postMessage({ type: 'land', ...prepared } satisfies HostedReply);
    } else if (message.type === 'adopt') {
      adopt(message.land, message.seated);
      scope.postMessage({ type: 'ready' } satisfies HostedReply);
    } else {
      const result = meshRegion(message);
      scope.postMessage(result satisfies HostedReply, [result.quads.buffer, result.offsets.buffer]);
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies HostedReply);
  }
};
