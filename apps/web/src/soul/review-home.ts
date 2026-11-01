import * as THREE from 'three';
import { VOXEL_METRES, type VoxelBlueprint, type VoxelMaterial } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint, unpackVoxelVertex } from '@chatdom/voxel';

const normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
type SurfaceData = { positions: number[]; normals: number[]; colors?: number[] };

function geometry(data: SurfaceData): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  if (data.colors) result.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  return result;
}

/** Convert exposed voxel faces into ordinary Three geometry, preserving blueprint cuts. */
export function buildSoulReviewHome(blueprint: VoxelBlueprint, materials: readonly VoxelMaterial[], roofMaterial: number): {
  surfaces: readonly { material: number; geometry: THREE.BufferGeometry }[];
  snow: THREE.BufferGeometry;
} {
  const surfaces = new Map<number, SurfaceData>();
  const snow: SurfaceData = { positions: [], normals: [] };
  const scale = VOXEL_METRES[blueprint.lattice];
  for (const chunk of prepareAssetChunks(rasterizeBlueprint(blueprint), materials)) {
    const mesh = meshVoxelChunk(chunk);
    for (const index of mesh.indices) {
      const vertex = unpackVoxelVertex(mesh.vertices[index * 2]!, mesh.vertices[index * 2 + 1]!);
      let surface = surfaces.get(vertex.material);
      if (!surface) {
        surface = { positions: [], normals: [], colors: [] };
        surfaces.set(vertex.material, surface);
      }
      const position = [vertex.x, vertex.y, vertex.z].map((value, axis) => (value + chunk.coordinate[axis]! * 32) * scale);
      const normal = normals[vertex.face]!;
      surface.positions.push(...position);
      surface.normals.push(...normal);
      const shade = (0.62 + 0.38 * vertex.ao / 3) * (0.65 + 0.35 * vertex.sky / 15);
      surface.colors!.push(shade, shade, shade);
      if (vertex.material === roofMaterial && vertex.face === 2) {
        snow.positions.push(position[0]!, position[1]! + 0.025, position[2]!);
        snow.normals.push(...normal);
      }
    }
  }
  return { surfaces: [...surfaces].map(([material, data]) => ({ material, geometry: geometry(data) })), snow: geometry(snow) };
}
