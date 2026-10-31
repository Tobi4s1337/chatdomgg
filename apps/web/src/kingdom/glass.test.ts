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

  it('gives the floor a clear line to the sun through glass in the uploaded field, and none through wall or brick', () => {
    const layout = generateKingdom({ seed: 'light-tests', tier: 'hamlet', firstYear: 2026, year: 2026 });
    const position: Vec3 = [0, Math.ceil(terrainHeight(layout, 2, 2)) + 1, 0], origin: Vec3 = [-32, position[1] - 4, -32];
    const at = (cell: Vec3): Vec3 => cell.map((value, axis) => position[axis]! + value * 0.125) as unknown as Vec3;
    const field = (blueprint: VoxelBlueprint) => createLightFieldSolver(layout, [{ slot: 0, blueprint, position, yaw: 0 }])
      .solve({ kind: 'solve', revision: 1, origin, emitters: [] }).volume;
    // The voxel shader's sunLine over the same bytes it uploads: bit 128 of corner sample (x,y,z) closes cell (x,y,z),
    // and under 0.8 cells of blocked path is an opening's quantised edge that fades the line.
    function sunLine(volume: ReturnType<typeof field>, floor: Vec3, sun: number[], edge = .8): number {
      const [sx, sy] = volume.size, blocked = (c: number[]) => volume.surfaceSamples[c[0]! + (sx + 1) * (c[1]! + (sy + 1) * c[2]!)]! >= 128;
      const q = at(floor).map((value, axis) => (value + (axis === 1 ? .025 : 0) - origin[axis]!) / .5);
      const cell = q.map(Math.floor);
      if (blocked(cell)) { cell[1]!++; q[1] = cell[1]! + .005; if (blocked(cell)) return 0; }
      const length = Math.hypot(...sun), d = sun.map(value => value / length);
      const delta = d.map(value => Math.abs(value) > 1e-5 ? 1 / Math.abs(value) : 1e10);
      const next = q.map((value, axis) => Math.abs(d[axis]!) > 1e-5 ? (cell[axis]! + (d[axis]! >= 0 ? 1 : 0) - value) / d[axis]! : 1e10);
      let path = 0;
      for (let i = 0; i < 48; i++) {
        const enter = Math.min(...next), axis = next.indexOf(enter);
        cell[axis]! += Math.sign(d[axis]!); next[axis]! += delta[axis]!;
        if (cell.some((value, a) => value < 0 || value >= volume.size[a]!)) break;
        if (blocked(cell) && (path += Math.min(...next) - enter) >= edge) return 0;
      }
      const t = Math.min(1, Math.max(0, (path - .25) / (edge - .25)));
      return edge > .25 ? 1 - t * t * (3 - 2 * t) : path > 0 ? 0 : 1;
    }
    const toward = (from: Vec3, to: Vec3) => at(to).map((value, axis) => value - at(from)[axis]!);
    const open = field(glazed), closed = field(bricked), casement = field(mullioned);
    // A low afternoon sun from the south lands its patch on the floor a metre and a half into the room.
    expect(sunLine(open, [16, 3, 20], toward([16, 3, 20], [16, 13, 31]))).toBe(1);
    expect(sunLine(closed, [16, 3, 20], toward([16, 3, 20], [16, 13, 31]))).toBe(0);
    // The same sun aimed at the wall beside the window leaves that floor in shade, and so does the roof.
    expect(sunLine(open, [16, 3, 20], toward([16, 3, 20], [5, 13, 31]))).toBe(0);
    expect(sunLine(open, [16, 3, 20], toward([16, 3, 20], [16, 30, 22]))).toBe(0);
    // Through a 0.375 m light beside the casement's mullion.
    expect(sunLine(casement, [10, 3, 20], toward([10, 3, 20], [10, 13, 31]))).toBe(1);
    // A 1.75 m light in a half-metre wall that straddles two field cells, as the real cottages' do, under a 58° sun.
    // Its true floor patch is (1.75 - 0.5 * .85 / .52) * .52 / .85 = 0.57 m long. Read strictly the wall is a
    // one-metre tunnel (0.375 m lit); the edge allowance gives the true length back without overshooting, and the
    // same wall bricked up stays dark at every point.
    const deep = (pane: number): VoxelBlueprint => ({ ...room(pane), id: `glass-room-deep-${pane}`, boxes: [
      { from: [0, 0, 0], to: [32, 24, 30], material: MAT.stone }, { from: [3, 3, 3], to: [29, 21, 26], material: MAT.air },
      { from: [10, 6, 26], to: [22, 20, 30], material: MAT.air }, { from: [10, 6, 27], to: [22, 20, 28], material: pane },
    ], windows: [{ id: 'south', centre: [16, 13, 28], width: 12, height: 14, facing: 'south' }] });
    const reveal = field(deep(MAT.glass)), walled = field(deep(MAT.stone)), sun = [0, .85, .52];
    const lit = (volume: ReturnType<typeof field>, edge?: number) => Array.from({ length: 22 }, (_, z) => sunLine(volume, [16, 3, 4 + z], sun, edge))
      .reduce((sum, value) => sum + value, 0) * 0.125;
    expect(lit(reveal, 0)).toBeLessThan(.4);
    expect(lit(reveal)).toBeGreaterThan(.5);
    expect(lit(reveal)).toBeLessThan(.65);
    expect(lit(walled)).toBe(0);
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
