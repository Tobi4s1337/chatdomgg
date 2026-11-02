import type { VoxelAsset, VoxelBlueprint, VoxelMaterial, Vec3 } from '@chatdom/shared';
import { prepareAssetChunks, rasterizeBlueprint, type PreparedAssetChunk } from './asset';
import { buildLightVolume, type LightVolumeRequest, type LightVolume } from './light';
import { meshVoxelChunk, type MeshChunkRequest, type VoxelChunkMesh } from './mesh';
import { createRenderLodAsset, type RenderLodFactor } from './lod';
import { createOpaqueShadowChunks } from './shadow-mesh';

export type { RenderLodFactor } from './lod';

export type VoxelJob =
  | { readonly id: number; readonly kind: 'mesh'; readonly request: MeshChunkRequest }
  | { readonly id: number; readonly kind: 'asset'; readonly asset: VoxelAsset; readonly materials: readonly VoxelMaterial[]; readonly materialRevision: number }
  | { readonly id: number; readonly kind: 'blueprint'; readonly blueprint: VoxelBlueprint; readonly revision: number; readonly materials: readonly VoxelMaterial[]; readonly materialRevision: number; readonly lodFactor?: RenderLodFactor | 1; readonly shadow?: 'opaque-faces-v1' }
  | { readonly id: number; readonly kind: 'prepare'; readonly blueprint: VoxelBlueprint; readonly revision: number; readonly materials: readonly VoxelMaterial[]; readonly materialRevision: number }
  | { readonly id: number; readonly kind: 'light'; readonly request: LightVolumeRequest };

export interface AssetChunkMesh { readonly coordinate: Vec3; readonly mesh: VoxelChunkMesh }
export type VoxelJobResult =
  | { readonly id: number; readonly kind: 'mesh'; readonly mesh: VoxelChunkMesh }
  | { readonly id: number; readonly kind: 'asset'; readonly assetId: string; readonly revision: number; readonly chunks: readonly AssetChunkMesh[]; readonly shadowChunks?: readonly AssetChunkMesh[] }
  | { readonly id: number; readonly kind: 'prepared'; readonly assetId: string; readonly revision: number; readonly chunks: readonly PreparedAssetChunk[] }
  | { readonly id: number; readonly kind: 'light'; readonly volume: LightVolume };

export interface VoxelJobFailure { readonly id: number; readonly kind: 'error'; readonly message: string }
export type VoxelWorkerResponse = VoxelJobResult | VoxelJobFailure;

export function executeVoxelJob(job: VoxelJob): VoxelJobResult {
  if (job.kind === 'blueprint' && job.shadow !== undefined
    && (job.shadow !== 'opaque-faces-v1' || (job.lodFactor !== undefined && job.lodFactor !== 1)))
    throw new Error('Opaque shadow faces require full-detail geometry and a supported shadow compiler');
  if (job.kind === 'mesh') return { id: job.id, kind: 'mesh', mesh: meshVoxelChunk(job.request) };
  if (job.kind === 'light') return { id: job.id, kind: 'light', volume: buildLightVolume(job.request) };
  let asset = job.kind === 'asset' ? job.asset : rasterizeBlueprint(job.blueprint, job.revision);
  const assetId = asset.id;
  // Release the full raster before sky/halo preparation; only the reduced volume is needed.
  if (job.kind === 'blueprint' && job.lodFactor !== undefined && job.lodFactor !== 1) asset = createRenderLodAsset(asset, job.lodFactor, job.materials);
  const prepared = prepareAssetChunks(asset, job.materials, job.materialRevision);
  if (job.kind === 'prepare') return { id: job.id, kind: 'prepared', assetId: asset.id, revision: asset.revision, chunks: prepared };
  const chunks = prepared.map((request) => ({ coordinate: request.coordinate, mesh: meshVoxelChunk(request) }));
  // The response identifies the requested source; mesh stamps identify its rendered detail.
  return { id: job.id, kind: 'asset', assetId, revision: asset.revision, chunks,
    ...(job.kind === 'blueprint' && job.shadow === 'opaque-faces-v1' ? { shadowChunks: createOpaqueShadowChunks(chunks, job.materials) } : {}) };
}

export function resultTransferables(result: VoxelJobResult): ArrayBuffer[] {
  if (result.kind === 'light') return [result.volume.light.buffer as ArrayBuffer];
  if (result.kind === 'mesh') return [result.mesh.vertices.buffer as ArrayBuffer, result.mesh.indices.buffer as ArrayBuffer];
  if (result.kind === 'prepared') return result.chunks.flatMap(({ halo, sky }) => [halo.buffer as ArrayBuffer, sky.buffer as ArrayBuffer]);
  return [...new Set([...result.chunks, ...(result.shadowChunks ?? [])]
    .flatMap(({ mesh }) => [mesh.vertices.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer]))];
}
