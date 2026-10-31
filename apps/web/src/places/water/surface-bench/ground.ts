// The bench ground, built the way the kingdom's terrain is: real half-metre columns for the mesher's topology,
// which the terrain material then lays on the smooth height grid. Beds under water take the waterbed surface.
import * as THREE from 'three';
import { MATERIALS, MAT } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';

export interface BenchGround { readonly origin: [number, number]; readonly step: number; readonly width: number; readonly depth: number; readonly data: Float32Array }

/**
 * The ground's own registry: the real one plus bench-local twins of grass and waterbed (same colour and surface) so
 * neighbouring terrain tops never share a material and the mesher keeps every top one cell square. Only this page's
 * ground material and its worker job see the twins; no content uses them.
 */
export function groundMaterial(ground: BenchGround, shoreLevel: number) {
  const twin = (id: number, next: number) => ({ ...MATERIALS.materials.find(m => m.id === id)!, id: next, name: `bench-twin-${next}` });
  const GRASS_TWIN = MATERIALS.materials.length, BED_TWIN = GRASS_TWIN + 1;
  const registry = { ...MATERIALS, materials: [...MATERIALS.materials, twin(MAT.grass, GRASS_TWIN), twin(MAT.waterbed, BED_TWIN)] };
  const state = createVoxelMaterial(registry, 'terrain');
  const { origin, step, width, depth, data } = ground;
  state.setTerrainHeight(data, width, depth, origin, step);
  state.setShoreLevel(shoreLevel, [origin[0], origin[0] + (width - 1) * step, origin[1], origin[1] + (depth - 1) * step]);
  return { state, registry, twins: { grass: GRASS_TWIN, bed: BED_TWIN } };
}

export async function meshGround(pool: VoxelWorkerPool, ground: BenchGround, made: ReturnType<typeof groundMaterial>, wet: (x: number, z: number, h: number) => boolean): Promise<THREE.Mesh> {
  const { origin, step, width, depth, data } = ground;
  const cellsX = width - 1, cellsZ = depth - 1, centres = new Float32Array(cellsX * cellsZ);
  for (let k = 0; k < cellsZ; k++) for (let i = 0; i < cellsX; i++) {
    centres[i + cellsX * k] = (data[i + width * k]! + data[i + 1 + width * k]! + data[i + width * (k + 1)]! + data[i + 1 + width * (k + 1)]!) / 4;
  }
  let lowest = Infinity, highest = -Infinity;
  for (const h of centres) { lowest = Math.min(lowest, h); highest = Math.max(highest, h); }
  const cell = 0.5, base = Math.floor(lowest / cell) * cell - 1, rows = Math.ceil((highest - base) / cell) + 1;
  const voxels = new Uint16Array(cellsX * rows * cellsZ);
  for (let k = 0; k < cellsZ; k++) for (let i = 0; i < cellsX; i++) {
    const h = centres[i + cellsX * k]!, x = origin[0] + (i + 0.5) * step, z = origin[1] + (k + 0.5) * step;
    const top = Math.max(1, Math.round((h - base) / cell));
    // Neighbouring tops alternate between two surfaces of the same kind, so the mesher never merges them into quads
    // whose corners would crack once the material bends them onto the grid.
    const surface = wet(x, z, h) ? ((i + k) % 2 ? MAT.waterbed : made.twins.bed) : (i + k) % 2 ? MAT.grass : made.twins.grass;
    for (let y = 0; y < top; y++) voxels[i + cellsX * (y + rows * k)] = y === top - 1 ? surface : y >= top - 3 ? MAT.earth : MAT.stone;
  }
  const result = await pool.submit({ kind: 'asset', asset: { id: 'water-bench-ground', revision: 1, lattice: 'terrain', size: [cellsX, rows, cellsZ], voxels }, materials: made.registry.materials, materialRevision: MATERIALS.revision });
  if (result?.kind !== 'asset' || !result.chunks.length) throw new Error('Could not mesh the fixture ground');
  const geometry = geometryFromChunks(result.chunks, 'terrain');
  geometry.boundingBox!.expandByScalar(16); geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
  const land = new THREE.Mesh(geometry, made.state.material);
  land.position.set(origin[0], base, origin[1]);
  return land;
}
