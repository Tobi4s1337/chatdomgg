import type { AssetChunkMesh } from '@chatdom/voxel';

/** Render-only 64 m tiles. Preserve every worker mesh and its asset-local coordinates;
 * a whole-kingdom bounding sphere would draw all ground even from one street. */
export function terrainBatches(chunks: readonly AssetChunkMesh[]): readonly (readonly AssetChunkMesh[])[] {
  const tiles = new Map<string, AssetChunkMesh[]>();
  for (const chunk of chunks) {
    const key = `${Math.floor(chunk.coordinate[0] / 4)},${Math.floor(chunk.coordinate[2] / 4)}`;
    const tile = tiles.get(key);
    if (tile) tile.push(chunk); else tiles.set(key, [chunk]);
  }
  return [...tiles.values()];
}
