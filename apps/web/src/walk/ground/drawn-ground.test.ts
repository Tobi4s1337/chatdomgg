import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { createVoxelMaterial } from '@chatdom/render';
import { generateSettlementPlan, terrainHeight } from '@chatdom/world';
import { sampleRenderedTerrainHeight } from '../../kingdom/terrain-worker';
import { createDrawnGround, sampleHeightField, terrainHeightField } from './drawn-ground';

/** A terrain tile as the kingdom scene draws one: a mesh on the terrain material, its footprint from its geometry. */
function tile(material: THREE.Material, [minX, minZ]: [number, number], [maxX, maxZ]: [number, number], position: [number, number, number] = [0, 0, 0]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([minX, 0, minZ, maxX, 0, minZ, minX, 0, maxZ, maxX, 4, maxZ], 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  return mesh;
}

/** A 4×3 field from (-2, 1), one metre apart: every corner height is known by hand. */
function smallField() {
  const width = 4, depth = 3, data = new Float32Array(width * depth);
  for (let j = 0; j < depth; j++) for (let i = 0; i < width; i++) data[i + j * width] = i * .5 + j * j * .25 + (i === 2 && j === 1 ? 1 : 0);
  const state = createVoxelMaterial(MATERIALS, 'terrain');
  state.setTerrainHeight(data, width, depth, [-2, 1], 1);
  return { state, data, width, depth };
}

/** The tile drawn as the GPU draws it: one vertex per texel, both triangles of each metre on the 00→11 diagonal. */
function displacedMesh(heightAt: (x: number, z: number) => number, [minX, minZ]: [number, number], [maxX, maxZ]: [number, number]) {
  const positions: number[] = [], index: number[] = [], columns = maxX - minX + 1;
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) positions.push(x, Math.fround(heightAt(x, z)), z);
  for (let j = 0; j < maxZ - minZ; j++) for (let i = 0; i < maxX - minX; i++) {
    const a = i + j * columns, b = a + 1, c = a + columns, d = c + 1;
    index.push(a, c, d, a, d, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

describe('drawn ground from the terrain tiles', () => {
  it('reads the height field exactly as the terrain shader does', () => {
    const { state, data, width } = smallField();
    const field = terrainHeightField(state.material)!;
    expect(field).toMatchObject({ width: 4, depth: 3, originX: -2, originZ: 1, step: 1 });
    expect(sampleHeightField(field, -2, 1)).toBe(0);
    expect(sampleHeightField(field, 0, 2)).toBe(data[2 + width]);
    // Bilinear between the four texels of a cell, clamped past the edges like the shader's uv clamp.
    expect(sampleHeightField(field, -1.5, 1.5)).toBeCloseTo((data[0]! + data[1]! + data[4]! + data[5]!) / 4, 6);
    expect(sampleHeightField(field, -9, 1)).toBe(sampleHeightField(field, -2, 1));
    expect(terrainHeightField(createVoxelMaterial(MATERIALS, 'build').material)).toBeNull();
    expect(terrainHeightField(new THREE.MeshBasicMaterial())).toBeNull();
    state.dispose();
  });

  it('meets the drawn triangles under a point, not the smooth bilinear between texels', () => {
    const { state } = smallField();
    const scene = new THREE.Scene();
    scene.add(tile(state.material, [-2, 1], [1, 3]));
    const ground = createDrawnGround({ scene });
    // Inside the cell (-1..0, 1..2) the far corner (0, 2) is raised by 1 m: the 00→11 diagonal decides the height.
    // Hand-computed: h00 = (-1,1) → 0.5, h10 = (0,1) → 1, h01 = (-1,2) → 0.75, h11 = (0,2) → 2.25.
    expect(ground.at(-.75, 1.75)).toBeCloseTo(.5 + .25 * (2.25 - .75) + .75 * (.75 - .5), 6);
    expect(ground.at(-.25, 1.25)).toBeCloseTo(.5 + .75 * (1 - .5) + .25 * (2.25 - 1), 6);
    // The smooth bilinear there is lower: the drawn triangle, not the texture filter, is the ground.
    expect(sampleHeightField(terrainHeightField(state.material)!, -.25, 1.25)).toBeLessThan(ground.at(-.25, 1.25)! - .05);
    expect(ground.source).toBe('terrain');
    expect(ground.at(5, 2)).toBeNull();
    expect(ground.source).toBe('none');
    expect(ground.at(Number.NaN, 2)).toBeNull();
    state.dispose();
  });

  it('agrees with a downward ray against the displaced tile, including a translated tile', () => {
    const { state } = smallField();
    const field = terrainHeightField(state.material)!;
    const scene = new THREE.Scene();
    // A translated tile: the shader reads the field at world positions; its local grid stays whole metres.
    scene.add(tile(state.material, [-3, 0], [0, 2], [1, 0, 1]));
    const ground = createDrawnGround({ scene });
    const drawn = displacedMesh((x, z) => sampleHeightField(field, x, z), [-2, 1], [1, 3]);
    drawn.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), random = mulberry(7);
    for (let n = 0; n < 200; n++) {
      const x = -2 + random() * 3, z = 1 + random() * 2;
      ray.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(drawn)[0];
      expect(hit, `${x}, ${z}`).toBeDefined();
      expect(ground.at(x, z)).toBeCloseTo(hit!.point.y, 5);
    }
    state.dispose();
  });

  it('is the rendered terrain of a real plan, built as the kingdom scene builds its height texture', () => {
    const plan = generateSettlementPlan({ seed: 'tobi4s_', tier: 'town', firstYear: 2022, year: 2026 });
    const cx = Math.round((plan.bounds.minX + plan.bounds.maxX) / 2), cz = Math.round((plan.bounds.minZ + plan.bounds.maxZ) / 2);
    // The scene's texture covers the whole plan on the same whole-metre grid; a 40 m window of it is the same texels.
    const origin: [number, number] = [cx - 20, cz - 20], width = 41, depth = 41;
    const data = new Float32Array(width * depth);
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) data[x + z * width] = terrainHeight(plan, origin[0] + x, origin[1] + z);
    const state = createVoxelMaterial(MATERIALS, 'terrain');
    state.setTerrainHeight(data, width, depth, origin, 1);
    const scene = new THREE.Scene(), group = new THREE.Group();
    for (const [dx, dz] of [[-16, -16], [0, -16], [-16, 0], [0, 0]] as const) group.add(tile(state.material, [0, 0], [16, 16], [cx + dx, 0, cz + dz]));
    scene.add(group);
    const ground = createDrawnGround({ scene }), random = mulberry(11);
    for (let n = 0; n < 400; n++) {
      const x = cx - 16 + random() * 32, z = cz - 16 + random() * 32;
      expect(ground.at(x, z)).toBeCloseTo(sampleRenderedTerrainHeight(plan, x, z), 5);
    }
    state.dispose();
  }, 60_000);

  it('ignores meshes that are not terrain, instanced, rotated or hidden', () => {
    const { state } = smallField();
    const scene = new THREE.Scene();
    scene.add(tile(new THREE.MeshBasicMaterial(), [-2, 1], [1, 3]));
    scene.add(tile(createVoxelMaterial(MATERIALS, 'build').material, [-2, 1], [1, 3]));
    const rotated = tile(state.material, [-2, 1], [1, 3]);
    rotated.rotation.y = .3;
    scene.add(rotated);
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 1, 4), state.material, 1);
    scene.add(instanced);
    expect(createDrawnGround({ scene }).at(0, 2)).toBeNull();
    const hidden = tile(state.material, [-2, 1], [1, 3]);
    hidden.visible = false;
    scene.add(hidden);
    expect(createDrawnGround({ scene }).at(0, 2)).toBeNull();
    state.dispose();
  });

  it('finds tiles drawn after the first sample and forgets removed ones, rescanning at most twice a second', () => {
    const { state } = smallField();
    const scene = new THREE.Scene();
    let now = 0;
    const ground = createDrawnGround({ scene, clock: () => now });
    expect(ground.at(0, 2)).toBeNull();
    const mesh = tile(state.material, [-2, 1], [1, 3]);
    scene.add(mesh);
    now = 200;
    expect(ground.at(0, 2)).toBeNull();
    now = 600;
    expect(ground.at(0, 2)).toBeCloseTo(2.25, 6);
    scene.remove(mesh);
    now = 1200;
    expect(ground.at(0, 2)).toBeNull();
    scene.add(mesh);
    ground.refresh();
    expect(ground.at(0, 2)).toBeCloseTo(2.25, 6);
    state.dispose();
  });

  it('forgets tiles whose group left the scene or was hidden, and looks for terrain ever less often once none comes', () => {
    const { state } = smallField();
    const scene = new THREE.Scene(), group = new THREE.Group();
    group.add(tile(state.material, [-2, 1], [1, 3]));
    scene.add(group);
    let now = 0;
    const ground = createDrawnGround({ scene, clock: () => now });
    expect(ground.at(0, 2)).toBeCloseTo(2.25, 6);
    group.visible = false;
    now = 600;
    expect(ground.at(0, 2)).toBeNull();
    group.visible = true;
    ground.refresh();
    expect(ground.at(0, 2)).toBeCloseTo(2.25, 6);
    scene.remove(group);
    now = 1200;
    expect(ground.at(0, 2)).toBeNull();
    // No terrain at all (the grand land's blocky ground): twenty looks at .5 s, then ever wider apart.
    const empty = new THREE.Scene();
    let scans = 0;
    const traverse = empty.traverse.bind(empty);
    empty.traverse = (callback) => { scans++; traverse(callback); };
    const bare = createDrawnGround({ scene: empty, clock: () => now });
    for (now = 0; now <= 60_000; now += 100) bare.at(0, 2);
    expect(scans).toBeGreaterThanOrEqual(20);
    expect(scans).toBeLessThan(40);
    state.dispose();
  });

  it('reads a rebuilt height texture without a rescan', () => {
    const { state, width, depth } = smallField();
    const scene = new THREE.Scene();
    scene.add(tile(state.material, [-2, 1], [1, 3]));
    const ground = createDrawnGround({ scene });
    expect(ground.at(0, 2)).toBeCloseTo(2.25, 6);
    state.setTerrainHeight(new Float32Array(width * depth).fill(3), width, depth, [-2, 1], 1);
    expect(ground.at(0, 2)).toBe(3);
    state.dispose();
  });

  it('prefers the land seam over the scene whenever the seam is given', () => {
    const { state } = smallField();
    const scene = new THREE.Scene();
    scene.add(tile(state.material, [-2, 1], [1, 3]));
    const ground = createDrawnGround({ scene, surfaceAt: (x, z) => (x > 0 ? { drawnY: x + z } : null) });
    expect(ground.at(.5, 2)).toBe(2.5);
    expect(ground.source).toBe('seam');
    expect(ground.at(-1, 2)).toBeNull();
    expect(createDrawnGround({ surfaceAt: () => ({ drawnY: Number.NaN }) }).at(0, 0)).toBeNull();
    state.dispose();
  });

  it('samples 70 walkers twice a frame for well under a millisecond', () => {
    const { state } = smallField();
    const scene = new THREE.Scene();
    for (let n = 0; n < 200; n++) scene.add(tile(new THREE.MeshBasicMaterial(), [0, 0], [1, 1]));
    scene.add(tile(state.material, [-2, 1], [1, 3]));
    const ground = createDrawnGround({ scene }), random = mulberry(3);
    ground.at(0, 2);
    const started = performance.now();
    for (let frame = 0; frame < 100; frame++) for (let n = 0; n < 140; n++) ground.at(-2 + random() * 3, 1 + random() * 2);
    expect((performance.now() - started) / 100).toBeLessThan(1);
    state.dispose();
  });
});

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
