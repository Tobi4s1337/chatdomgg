import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { generateKingdom, terrainHeight } from '@chatdom/world';
import { MAT, MATERIALS } from '@chatdom/content';
import { computeAssetSky, meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint, sampleLightVolume, voxelIndex, type VoxelChunkMesh } from '@chatdom/voxel';
import { createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, type WindowHouse } from '@chatdom/render';
import { createLightFieldSolver } from './light-field-worker';
import { blueprintOccludes } from './visibility';

// One 4 m stone room: 3-cell walls and floor, a 1.5 × 1.25 m south window through the wall, glass in its middle cell.
const shell: VoxelBlueprint['boxes'] = [
  { from: [0, 0, 0], to: [32, 24, 32], material: MAT.stone },
  { from: [3, 3, 3], to: [29, 21, 29], material: MAT.air },
  { from: [10, 8, 29], to: [22, 18, 32], material: MAT.air },
];
function room(pane: number): VoxelBlueprint {
  return { version: 1, id: `glass-room-${pane}`, styleId: StyleIdSchema.parse('hearth'), kind: 'home', lattice: 'build', size: [32, 24, 32],
    boxes: [...shell, { from: [10, 8, 30], to: [22, 18, 31], material: pane }],
    windows: [{ id: 'south', centre: [16, 13, 31], width: 12, height: 10, facing: 'south' }] };
}
const glazed = room(MAT.glass), bricked = room(MAT.stone);
// A 1 m casement of two 0.375 m lights either side of a timber mullion, set so no half-metre cell is all glass.
const mullioned: VoxelBlueprint = { ...room(MAT.glass), id: 'glass-room-mullioned', boxes: [
  ...shell.slice(0, 2),
  { from: [9, 8, 29], to: [17, 18, 32], material: MAT.air },
  { from: [9, 8, 30], to: [17, 18, 31], material: MAT.glass },
  { from: [12, 8, 29], to: [14, 18, 31], material: MAT.timber },
], windows: [{ id: 'south', centre: [13, 13, 31], width: 8, height: 10, facing: 'south' }] };

function mesh(blueprint: VoxelBlueprint): VoxelChunkMesh {
  const [chunk] = prepareAssetChunks(rasterizeBlueprint(blueprint), MATERIALS.materials, MATERIALS.revision);
  return meshVoxelChunk(chunk!);
}
/** A quad of this face/material whose rectangle contains the point on its plane. */
function covers(result: VoxelChunkMesh, face: number, material: number, point: Vec3): boolean {
  const axis = face >> 1;
  for (let q = 0; q < result.quadCount; q++) {
    const corners = [0, 1, 2, 3].map(c => result.vertices[(q * 4 + c) * 2]!);
    if (result.vertices[q * 8 + 1] !== material || ((corners[0]! >>> 18) & 7) !== face) continue;
    const p = corners.map(word => [word & 63, (word >>> 6) & 63, (word >>> 12) & 63]);
    if (p[0]![axis] !== point[axis]) continue;
    if ([0, 1, 2].every(d => d === axis || (point[d]! > Math.min(...p.map(v => v[d]!)) && point[d]! < Math.max(...p.map(v => v[d]!))))) return true;
  }
  return false;
}
/** Highest baked sky on the floor's upward face within a metre of the window wall. */
function floorSky(result: VoxelChunkMesh): number {
  let sky = 0;
  for (let v = 0; v < result.vertices.length / 2; v++) {
    const word = result.vertices[v * 2]!;
    if (((word >>> 18) & 7) === 2 && ((word >>> 6) & 63) === 3 && ((word >>> 12) & 63) >= 21) sky = Math.max(sky, (word >>> 23) & 15);
  }
  return sky;
}

describe('glass passes sight and light without losing its frame', () => {
  it('keeps glass solid in the registry while only glass transmits', () => {
    const glass = MATERIALS.materials.find(m => m.id === MAT.glass)!;
    expect(glass).toMatchObject({ surface: 'glass', solid: true, occludesFaces: false, occludesAo: false, blocksLight: false });
    expect(MATERIALS.materials.filter(m => m.id !== 0 && (!m.blocksLight || !m.occludesFaces || !m.solid)).map(m => m.name)).toEqual(['glass']);
  });

  it('meshes the reveal behind the glass and lets the sky reach the floor, while a wall in its place closes both', () => {
    const open = mesh(glazed), closed = mesh(bricked);
    // The glass's own street and room faces.
    expect(covers(open, 4, MAT.glass, [16, 13, 31])).toBe(true);
    expect(covers(open, 5, MAT.glass, [16, 13, 30])).toBe(true);
    // The jambs and sill beside and below the glass now face it and are drawn; a wall there stays culled.
    expect(covers(open, 0, MAT.stone, [10, 13, 30.5])).toBe(true);
    expect(covers(open, 2, MAT.stone, [16, 8, 30.5])).toBe(true);
    expect(covers(closed, 0, MAT.stone, [10, 13, 30.5])).toBe(false);
    // Adjacent opaque wall beside the window still occludes its neighbours' faces.
    expect(covers(open, 0, MAT.stone, [6, 13, 30.5])).toBe(false);
    const skyAt = (blueprint: VoxelBlueprint, cell: Vec3) => {
      const { size, sky } = computeAssetSky(rasterizeBlueprint(blueprint), MATERIALS.materials);
      return sky[voxelIndex(cell[0] + 1, cell[1] + 1, cell[2] + 1, size)]!;
    };
    expect(skyAt(glazed, [16, 4, 27])).toBeGreaterThanOrEqual(5);
    expect(skyAt(bricked, [16, 4, 27])).toBe(0);
    expect(floorSky(open)).toBeGreaterThanOrEqual(5);
    expect(floorSky(closed)).toBe(0);
  });

  it('carries a street emitter into the room through glass in the half-metre field, never through the wall', () => {
    const layout = generateKingdom({ seed: 'light-tests', tier: 'hamlet', firstYear: 2026, year: 2026 });
    const ground = terrainHeight(layout, 2, 2);
    const position: Vec3 = [0, Math.ceil(ground) + 1, 0];
    const at = (cell: Vec3): Vec3 => cell.map((value, axis) => position[axis]! + value * 0.125) as unknown as Vec3;
    const street = at([16, 13, 32 + 6]);
    const solve = (blueprint: VoxelBlueprint) => createLightFieldSolver(layout, [{ slot: 0, blueprint, position, yaw: 0 }])
      .solve({ kind: 'solve', revision: 1, origin: [-32, position[1] - 4, -32], emitters: [{ position: street, level: 15 }] }).volume;
    const open = solve(glazed), closed = solve(bricked), casement = solve(mullioned);
    expect(sampleLightVolume(open, street)).toBe(15);
    expect(sampleLightVolume(open, at([16, 12, 20]))).toBeGreaterThanOrEqual(9);
    expect(sampleLightVolume(closed, at([16, 12, 20]))).toBe(0);
    // The wall beside the window keeps its own cells, so nothing leaks around the frame.
    expect(sampleLightVolume(open, at([4, 13, 30.5]))).toBe(0);
    // Light crosses beside the mullion even though every half-metre cell there also holds frame, mullion or wall.
    expect(sampleLightVolume(casement, at([13, 12, 20]))).toBeGreaterThanOrEqual(9);
    expect(sampleLightVolume(casement, at([4, 13, 30.5]))).toBe(0);
    expect(sampleLightVolume(casement, at([24, 13, 30.5]))).toBe(0);
  });

  it('sees through the glass but not the wall beside it', () => {
    expect(blueprintOccludes(glazed, [16, 13, 40], [16, 13, 16])).toBe(false);
    expect(blueprintOccludes(glazed, [5, 13, 40], [5, 13, 16])).toBe(true);
    expect(blueprintOccludes(bricked, [16, 13, 40], [16, 13, 16])).toBe(true);
    expect(blueprintOccludes(mullioned, [10.5, 13, 40], [10.5, 13, 16])).toBe(false);
    expect(blueprintOccludes(mullioned, [13, 13, 40], [13, 13, 16])).toBe(true);
  });

  it('lets the sun through glass in the caster pass and keeps every opaque wall casting', () => {
    const clay = createVoxelMaterial(MATERIALS, 'build');
    // The shared clay pass stays opaque; glass uses coverage, never blending or a second transparent shell.
    expect(clay.material).toMatchObject({ transparent: false, depthWrite: true, alphaToCoverage: true });
    const glassKind = clay.material.uniforms.uGlassKind!.value as number;
    const palette = (clay.material.uniforms.uPalette!.value as THREE.DataTexture).image.data as Float32Array;
    expect(palette[MAT.glass * 4 + 3]).toBe(glassKind);
    expect(MATERIALS.materials.filter(m => palette[m.id * 4 + 3] === glassKind).map(m => m.id)).toEqual([MAT.glass]);
    const scenes: THREE.Scene[] = [];
    const renderer = {
      autoClear: true, xr: { enabled: false }, info: { autoReset: true, render: { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 } },
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: vi.fn(),
      getViewport: (v: THREE.Vector4) => v, setViewport: vi.fn(), getScissor: (v: THREE.Vector4) => v, setScissor: vi.fn(),
      getScissorTest: () => false, setScissorTest: vi.fn(), clear: vi.fn(), render: vi.fn((scene: THREE.Scene) => { scenes.push(scene); }),
    } as unknown as THREE.WebGLRenderer;
    const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-8, -1, -8), new THREE.Vector3(8, 8, 8)), resolution: 1024 });
    const [chunk] = prepareAssetChunks(rasterizeBlueprint(glazed), MATERIALS.materials, MATERIALS.revision);
    const geometry = geometryFromChunks([{ coordinate: [0, 0, 0], mesh: meshVoxelChunk(chunk!) }], 'build');
    const roomMesh = new THREE.Mesh(geometry, clay.material);
    shadows.register(roomMesh);
    expect(shadows.updateSunDirection([0.2, 1, 0.6])).toBe(true);
    const caster = scenes[0]!.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(caster.geometry).toBe(geometry);
        expect(caster.material.uniforms.uPalette).toBe(clay.material.uniforms.uPalette);
    expect(caster.material.fragmentShader).toMatch(/flat in uint vMaterial[\s\S]*- uGlassKind\) < 0\.5\) discard;/);
    shadows.dispose(); geometry.dispose(); clay.dispose();
  });

  it('draws the presence pane as a translucent layer over the real glass', () => {
    const house: WindowHouse = { slot: 3, blueprint: glazed, position: [0, 0, 0], yaw: 0 };
    const scene = new THREE.Scene();
    const windows = createWindowLights(scene, [house]);
    const [pane, halo] = scene.children as THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
    expect(pane!.material).toMatchObject({ transparent: true, depthWrite: false });
    expect(pane!.renderOrder).toBeLessThan(halo!.renderOrder);
    windows.dispose();
  });
});
