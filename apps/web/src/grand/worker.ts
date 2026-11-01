/// <reference lib="webworker" />
import { generateGrandLand } from '../../../../packages/world/src/grand/generate';
import { createVoxelizeContext, voxelizeChunk, chunkColumnRange, PAD_VOLUME, type VoxelizeContext } from '../../../../packages/world/src/grand/voxelize';
import { GrandKind, M, kindTable } from '../../../../packages/world/src/grand/palette';
import { landMaterials } from '../../../../packages/world/src/grand/kits';
import { GRAND_CHUNK, GRAND_REGION, type GrandLand, type GrandLandSeed } from '../../../../packages/world/src/grand/types';
import { landCacheKey, readLand, writeLand } from './land-cache';
import { createQuadBuckets, meshQuadChunk, packQuadBuckets, QUAD_FLAG_AO, QUAD_FLAG_EMIT } from '../../../../packages/voxel/src/grand/quad-mesher';

/**
 * One grand-land worker: generates the land (worker 0), then voxelises and meshes whole regions at a level.
 * A region job returns one transferable quad buffer with seven face offsets.
 */
export type GrandWorkerRequest =
  | { type: 'generate'; seed: GrandLandSeed }
  | { type: 'land'; land: GrandLand }
  | { type: 'mesh'; id: number; level: number; rx: number; rz: number };

export type GrandWorkerReply =
  | { type: 'land'; land: GrandLand; cached: boolean }
  | { type: 'ready' }
  | { type: 'mesh'; id: number; level: number; rx: number; rz: number; quads: Uint32Array; offsets: Int32Array; minY: number; maxY: number; solid: number; treeVoxels: number; millis: number }
  | { type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let ctx: VoxelizeContext | null = null;
let flags = new Uint8Array(256);
const volume = new Uint8Array(PAD_VOLUME);

function adopt(land: GrandLand): void {
  ctx = createVoxelizeContext(land);
  const kinds = kindTable(landMaterials(land));
  flags = new Uint8Array(256);
  for (let m = 1; m < 256; m++) {
    const kind = kinds[m]!;
    if (kind === GrandKind.air) continue;
    flags[m] = QUAD_FLAG_EMIT | (kind === GrandKind.water ? 0 : QUAD_FLAG_AO);
  }
  flags[M.sea] = 0;
}

function meshRegion(level: number, rx: number, rz: number) {
  if (!ctx) throw new Error('No land yet.');
  const started = performance.now();
  const treesBefore = ctx.treeVoxels;
  const s = 1 << level, land = ctx.land;
  const per = Math.max(1, (GRAND_REGION / GRAND_CHUNK) >> level);
  const coarse = GRAND_REGION / s;
  const skirt = level > 0 ? [rx * coarse, rz * coarse, (rx + 1) * coarse, (rz + 1) * coarse] as const : undefined;
  const layers = Math.ceil(land.height / s / GRAND_CHUNK);
  const buckets = createQuadBuckets(8192);
  let minY = 1e9, maxY = -1e9, solid = 0;
  for (let lz = 0; lz < per; lz++) for (let lx = 0; lx < per; lx++) {
    const cx = rx * per + lx, cz = rz * per + lz;
    const range = chunkColumnRange(ctx, level, cx, cz);
    const lo = Math.max(0, Math.floor(range.lo / GRAND_CHUNK)), hi = Math.min(layers - 1, Math.floor((range.hi - 1) / GRAND_CHUNK));
    for (let cy = lo; cy <= hi; cy++) {
      solid += voxelizeChunk(ctx, level, cx, cy, cz, volume, skirt ? { skirt } : {});
      const emitted = meshQuadChunk(volume, flags, lx | (cy << 4) | (lz << 8), buckets);
      if (emitted > 0) { minY = Math.min(minY, cy * GRAND_CHUNK); maxY = Math.max(maxY, (cy + 1) * GRAND_CHUNK); }
    }
  }
  const { quads, offsets } = packQuadBuckets(buckets);
  return { quads, offsets, minY: minY > maxY ? 0 : minY, maxY: minY > maxY ? 0 : maxY, solid, treeVoxels: ctx.treeVoxels - treesBefore, millis: performance.now() - started };
}

async function raise(seed: GrandLandSeed): Promise<void> {
  // Built bundles carry a content hash in this worker's URL; development has none and always raises afresh.
  const key = import.meta.env.DEV ? null : landCacheKey(seed, scope.location.pathname);
  const cached = key ? await readLand(key).catch(() => null) : null;
  const land = cached ?? generateGrandLand(seed, () => performance.now());
  adopt(land);
  // A copy for the main thread; this worker keeps its own for meshing.
  scope.postMessage({ type: 'land', land, cached: cached !== null } satisfies GrandWorkerReply);
  if (key && !cached) await writeLand(key, land, Date.now()).catch(() => undefined);
}

scope.onmessage = (event: MessageEvent<GrandWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'generate') {
      raise(message.seed).catch((error: unknown) => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies GrandWorkerReply));
    } else if (message.type === 'land') {
      adopt(message.land);
      scope.postMessage({ type: 'ready' } satisfies GrandWorkerReply);
    } else {
      const result = meshRegion(message.level, message.rx, message.rz);
      scope.postMessage({ type: 'mesh', id: message.id, level: message.level, rx: message.rx, rz: message.rz, ...result } satisfies GrandWorkerReply, [result.quads.buffer, result.offsets.buffer]);
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) } satisfies GrandWorkerReply);
  }
};
