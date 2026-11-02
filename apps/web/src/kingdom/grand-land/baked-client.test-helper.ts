import { gzipSync } from 'node:zlib';
import { sha256Hex, canonicalSceneJson, utf8 } from '../../../../../packages/world/src/founded-world/codec';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedMetadata, type BakedRegion, type BakedRegionMesh, type BakedSurface } from '../../../../../packages/world/src/grand/baked/types';
import type { BakedLandBinding, BakedLandExpected } from './baked-client-binding';
import type { BakedCompressedCache } from './baked-cache';

export const expected: BakedLandExpected = { kingdomId: '123', sceneHash: 'a'.repeat(64), recipeHash: 'b'.repeat(64),
  sourcePlanHash: 'c'.repeat(64), layoutRevision: 'layout-1', collisionRevision: 1 };
export async function artifact(options: { mesh?: (mesh: BakedRegionMesh) => BakedRegionMesh;
  metadata?: (metadata: BakedMetadata) => BakedMetadata; surface?: (surface: BakedSurface) => BakedSurface } = {}) {
  const blobs = new Map<string, Uint8Array>();
  async function store(raw: Uint8Array) {
    const gzip = new Uint8Array(gzipSync(raw));
    const hash = await sha256Hex(raw); blobs.set(hash, gzip);
    return { hash, rawBytes: raw.byteLength, gzipHash: await sha256Hex(gzip), gzipBytes: gzip.byteLength };
  }
  let surface: BakedSurface = { size: 512, height: 384, seaLevel: 0,
    ground: new Uint16Array(512 ** 2).fill(8), water: new Uint16Array(512 ** 2) };
  surface = options.surface?.(surface) ?? surface;
  const surfaceRef = await store(encodeBakedSurface(surface));
  const regions: BakedRegion[] = [];
  for (let rz = 0; rz < 2; rz++) for (let rx = 0; rx < 2; rx++) {
    const exact = rx === 0 && rz === 0, meshes = [];
    for (let level = 0; level < (exact ? 1 : 4); level++) {
      const target = rx === 1 && rz === 0 && level === 3, maxY = target ? 64 : 0;
      let mesh: BakedRegionMesh = { rx, rz, level, minY: 0, maxY,
        quads: target ? new Uint32Array([(15 << 5) | (2 << 25), 126 | (16 << 16)]) : new Uint32Array(),
        offsets: target ? new Int32Array([0, 0, 0, 1, 1, 1, 1]) : new Int32Array(7) };
      if (target) mesh = options.mesh?.(mesh) ?? mesh;
      meshes.push({ ...await store(encodeBakedRegion(mesh)), rx, rz, level, minY: 0, maxY, quadCount: target ? 1 : 0 });
    }
    regions.push({ rx, rz, exact, meshes, bounds: { min: [rx * 128 - 16, -5, rz * 128 - 32],
      max: [(rx + 1) * 128 - 16, rx === 1 && rz === 0 ? 251 : -5, (rz + 1) * 128 - 32] } });
  }
  let metadata: BakedMetadata = { version: 1, kingdomId: expected.kingdomId, recipeHash: expected.recipeHash,
    sourcePlanHash: expected.sourcePlanHash, sourcePlanRevision: expected.layoutRevision, compilers: BAKED_COMPILERS,
    size: 512, height: 384, seaLevel: 0,
    seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [240, 187, 224] },
    palette: [{ id: 126, colour: '#aaaaaa', kind: 13 }], surface: surfaceRef, regions };
  metadata = options.metadata?.(metadata) ?? metadata;
  const manifest = await store(encodeBakedMetadata(metadata));
  const binding: BakedLandBinding = { version: 1, ...expected, manifest };
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = String(input); requests.push(path);
    const hash = path.split('/')[6];
    if (!hash) {
      const bytes = utf8(canonicalSceneJson(binding));
      return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/json', 'content-length': String(bytes.byteLength) } });
    }
    const bytes = blobs.get(hash);
    return new Response(bytes?.slice().buffer, { status: bytes ? 200 : 404,
      headers: { 'content-type': 'application/gzip', 'content-length': String(bytes?.byteLength ?? 0) } });
  }) as typeof fetch;
  return { metadata, binding, blobs, requests, fetcher };
}
export function memoryCache() {
  const values = new Map<string, Uint8Array>(), deletes: string[] = [];
  const cache: BakedCompressedCache = {
    async get(hash) { return values.get(hash)?.slice() ?? null; },
    async put(hash, bytes) { values.set(hash, bytes.slice()); },
    async delete(hash) { deletes.push(hash); values.delete(hash); },
  };
  return { values, deletes, cache };
}
