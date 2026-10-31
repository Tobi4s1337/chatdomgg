// The effects bench diorama: a small dusk corner of a Hearth kingdom (the open smithy with its sleeping-dragon
// flue, two gate braziers, two hearth huts with a lit front window, a worn path, a meadow strip under a hedge)
// rendered only through the production renderer pieces: voxel clay through the real raster/prepare/mesh path,
// the near warm light field, window presence, the sky, the hour's fog and the HDR/bloom post stack.
// Every input here is SIMULATED and deterministic: no wall clock and no randomness; `render(time)` is a pure
// function of the supplied time, hour and view. Served by the bench's own Vite dev server, never shipped.
import * as THREE from 'three';
import { KingdomPresenceFrameSchema, VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import {
  buildLightVolume, meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint, rasterizeLightOccluders,
  type AssetChunkMesh, type LightVolume, type OccluderBox, type VoxelAsset,
} from '@chatdom/voxel';
import { createAtmosphere, getEnvironment } from '../../atmosphere';
import { createPostStack } from '../../post-stack';
import { createWindowLights, type WindowHouse } from '../../presence-lights';
import { createVoxelMaterial, geometryFromChunks } from '../../voxel-material';
// packages/render does not depend on content or world; the bench reads their real sources relatively.
import {
  MAT, MATERIALS, STYLES, createForgeHearth, createForgeWorkshop, createGateBrazier, createHearthHome, createStreetProp, createTree,
  FORGE_HEARTH_CHIMNEY_NOSE, FORGE_HEARTH_FLAME, FORGE_HEARTH_PIVOT, FORGE_WORKSHOP_HEARTH_PIVOT, GATE_BRAZIER_FLAME, GATE_BRAZIER_MOUNT,
} from '../../../../content/src/index';
import { createAnvilHeroDragon, DRAGON_MOUNT } from '../../../../content/src/anvil-hero/index';
import { createDressing } from '../../../../content/src/props/dressing/index';
import { homeLifeAnchors } from '../../../../world/src/home-life/index';

export type BenchView = 'street' | 'wide';
type Point = [number, number, number];
export type BenchSource = { id: string; position: Point };
export interface BenchAnchors {
  /** Real flame anchors, a little above each flame: the forge firebox and each gate brazier. */
  emberSources: BenchSource[];
  /** Spots along the hedge and meadow edge, about half a metre above the turf. */
  fireflySources: BenchSource[];
  /** The actual open flue mouth on top of each home chimney pot (see `chimneyMouths` below). */
  chimneyMouths: BenchSource[];
  /** The forge firebox flame anchor itself (`FORGE_HEARTH_FLAME`). */
  forgeFlame: Point;
  /** The sleeping dragon's nose on the forge flue (`FORGE_HEARTH_CHIMNEY_NOSE`), where the forge's own smoke leaves. */
  forgeNose: Point;
  /** No anvil asset stands in this corner; reserved for a later Forge-flight origin. */
  anvil?: Point;
}
export interface BenchScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  post: ReturnType<typeof createPostStack>;
  setView(name: BenchView): void;
  setHour(hour: number): void;
  render(time: number): void;
  anchors: BenchAnchors;
  stats(): { drawCalls: number; triangles: number };
  dispose(): void;
}

const CELL = VOXEL_METRES.build;
type Turn = 0 | 1 | 2 | 3;
/** A blueprint at a world position (its local origin, metres) and a cardinal turn about +Y (yaw = turn·π/2). */
type Placement = { blueprint: VoxelBlueprint; position: Point; turn: Turn };

/** The same quarter-turns as the world's `transformCardinalPoint` and a three.js Y rotation by turn·π/2. */
function turnXZ(turn: Turn, x: number, z: number): [number, number] {
  return turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
}
/** A local build-cell anchor (before the placement transform) in world metres. */
function at(placement: Placement, cell: readonly number[]): Point {
  const [x, z] = turnXZ(placement.turn, cell[0]! * CELL, cell[2]! * CELL);
  return [placement.position[0] + x, placement.position[1] + cell[1]! * CELL, placement.position[2] + z];
}
/** Places a blueprint so its local `pivot` cell lands on world (x, y, z). */
function placeAt(blueprint: VoxelBlueprint, pivot: readonly number[], world: Point, turn: Turn = 0): Placement {
  const [ox, oz] = turnXZ(turn, pivot[0]! * CELL, pivot[2]! * CELL);
  return { blueprint, position: [world[0] - ox, world[1] - pivot[1]! * CELL, world[2] - oz], turn };
}

// ---------------------------------------------------------------------------------------------------------------
// Ground: an authored turf slab for this corner, with a worn earth path, a cobbled smithy apron and moss where
// feet wear the edges, ringed by plain turf tiles so the land runs on to the fog. All deterministic hashes.

function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale, fz = z / scale, ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz, sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function segmentDistance(px: number, pz: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, t = Math.max(0, Math.min(1, ((px - a[0]!) * dx + (pz - a[1]!) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - a[0]! - dx * t, pz - a[1]! - dz * t);
}
function polylineDistance(px: number, pz: number, line: readonly (readonly number[])[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segmentDistance(px, pz, line[i - 1]!, line[i]!));
  return best;
}

/** Slab extent in world metres. 256 build cells (32 m) is the per-axis blueprint limit. */
const SLAB = { x: -16, z: -24, cells: 256 } as const;
// The lane from the viewer to the smithy apron, and the worn branch to the near hut's door.
const LANE = [[0.6, 9], [0.2, 6.2], [-1.1, 4.4], [-2.6, 3.4]] as const;
const DOORWARD = [[0.3, 5.2], [2.6, 2.4], [5.2, -0.6], [7.2, -3.2], [7.7, -5.2]] as const;

function groundMaterial(x: number, z: number): number {
  const wobble = (noise(x, z, 1.7, 3) - 0.5) * 0.5;
  const lane = polylineDistance(x, z, LANE) + wobble, doorward = polylineDistance(x, z, DOORWARD) + wobble * 0.8;
  // The smithy apron: a rounded cobbled yard before the open workshop, its rim worn back into earth and moss.
  const ax = Math.max(Math.abs(x + 3) - 3.6, 0), az = Math.max(Math.abs(z - 0.4) - 3.4, 0);
  const apron = Math.hypot(ax, az) - 0.9 + (noise(x, z, 1.3, 9) - 0.5) * 0.7;
  const cobble = hash(Math.floor(x * 4 + (Math.floor(z * 4) % 2) * 0.5), Math.floor(z * 4), 11);
  if (apron < 0) {
    if (apron > -0.35 && cobble < 0.45) return cobble < 0.2 ? MAT.moss : MAT.earth;
    return cobble < 0.18 ? MAT.stone : cobble < 0.27 ? MAT.limestone : cobble > 0.96 ? MAT.earth : MAT.paving;
  }
  const path = Math.min(lane - 0.82, doorward - 0.6);
  if (path < 0) {
    // Worn earth with sunk flags where the most feet fall.
    const flag = hash(Math.floor(x * 3.2), Math.floor(z * 3.2 + 0.5), 5);
    if (path < -0.25 && flag < 0.2) return flag < 0.07 ? MAT.limestone : MAT.paving;
    return path > -0.12 && flag > 0.62 ? MAT.moss : MAT.earth;
  }
  if (path < 0.22 || (apron < 0.3 && cobble < 0.5)) return hash(Math.floor(x * 8), Math.floor(z * 8), 7) < 0.55 ? MAT.moss : MAT.grass;
  return noise(x, z, 2.6, 21) > 0.7 ? MAT.moss : MAT.grass;
}

type Box = VoxelBlueprint['boxes'][number];
/** Run-length rows of one top course over an earth bed, so the slab stays a few thousand boxes. */
function surfaceBlueprint(id: string, cells: number, origin: readonly [number, number], material: (x: number, z: number) => number, depth: number): VoxelBlueprint {
  const boxes: Box[] = [];
  if (depth > 1) boxes.push({ from: [0, 0, 0], to: [cells, depth - 1, cells], material: MAT.earth });
  for (let k = 0; k < cells; k++) {
    let start = 0, current = -1;
    for (let i = 0; i <= cells; i++) {
      const next = i < cells ? material(origin[0] + (i + 0.5) * CELL, origin[1] + (k + 0.5) * CELL) : -2;
      if (next === current) continue;
      if (current >= 0) boxes.push({ from: [start, depth - 1, k], to: [i, depth, k + 1], material: current });
      start = i; current = next;
    }
  }
  return { version: 1, id, styleId: STYLES.hearth.id, kind: 'prop', lattice: 'build', size: [cells, depth, cells], boxes, windows: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Fire. The content leaves flames to the runtime; this is the bench's own small voxel fire at each real anchor:
// stacked emissive HDR cubes (coal, tongue, tip) with a slow flicker of the bench clock. Crafted, not a blob.

type FireKind = 'forge' | 'brazier';
type Fire = { kind: FireKind; anchor: Point; lateral: [number, number]; depth: [number, number]; phase: number };
const TONGUES: Record<FireKind, readonly { x: number; z: number; h: number }[]> = {
  forge: [{ x: -0.34, z: 0.05, h: 0.2 }, { x: -0.16, z: -0.08, h: 0.32 }, { x: 0.03, z: 0.02, h: 0.4 }, { x: 0.2, z: -0.06, h: 0.3 }, { x: 0.36, z: 0.04, h: 0.18 }],
  brazier: [{ x: -0.11, z: 0.06, h: 0.3 }, { x: 0.1, z: -0.07, h: 0.36 }, { x: 0.02, z: 0.1, h: 0.24 }, { x: -0.01, z: -0.02, h: 0.48 }],
};
const COALS: Record<FireKind, readonly [number, number][]> = {
  forge: [[-0.38, 0.06], [-0.24, -0.08], [-0.1, 0.07], [0.04, -0.06], [0.18, 0.08], [0.32, -0.05], [-0.31, 0.2], [0.1, 0.2], [0.26, 0.19]],
  brazier: [[-0.16, -0.12], [0.02, -0.15], [0.17, -0.06], [-0.13, 0.09], [0.06, 0.12], [0.18, 0.15], [-0.03, -0.01]],
};
const FIRE_BASE: Record<FireKind, number> = { forge: -0.1, brazier: -0.32 };
const MAX_FIRE_CUBES = 160;
const EMBER_LOW = new THREE.Color(2.2, 0.55, 0.09), TONGUE_LOW = new THREE.Color(3.1, 0.95, 0.16);
const TONGUE_MID = new THREE.Color(4.4, 1.95, 0.42), TONGUE_TIP = new THREE.Color(5.4, 3.4, 1.15);

function flick(time: number, phase: number): number {
  return 0.5 + 0.3 * Math.sin(time * 5.3 + phase) + 0.2 * Math.sin(time * 8.9 + phase * 1.7);
}
function fract(value: number): number { return value - Math.floor(value); }

function createFires(scene: THREE.Scene, fires: readonly Fire[]) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_FIRE_CUBES);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FIRE_CUBES * 3), 3);
  mesh.frustumCulled = false;
  mesh.name = 'bench fire (SIMULATED)';
  scene.add(mesh);
  const matrix = new THREE.Matrix4(), colour = new THREE.Color();
  let count = 0;
  const cube = (fire: Fire, x: number, y: number, z: number, size: number, c: THREE.Color) => {
    if (count >= MAX_FIRE_CUBES || size < 0.012) return;
    const [lx, lz] = fire.lateral, [dx, dz] = fire.depth;
    matrix.makeScale(size, size, size).setPosition(fire.anchor[0] + lx * x + dx * z, fire.anchor[1] + y, fire.anchor[2] + lz * x + dz * z);
    mesh.setMatrixAt(count, matrix); mesh.setColorAt(count, c); count++;
  };
  return {
    update(time: number) {
      count = 0;
      for (const fire of fires) {
        const base = FIRE_BASE[fire.kind];
        // A bed of coals that breathes slowly, under the tongues.
        COALS[fire.kind].forEach(([x, z], i) => {
          const glow = 0.78 + 0.22 * Math.sin(time * 1.3 + fire.phase + i * 2.1);
          cube(fire, x, base - 0.03, z, fire.kind === 'forge' ? 0.12 : 0.11, colour.copy(EMBER_LOW).multiplyScalar(glow));
        });
        TONGUES[fire.kind].forEach((tongue, i) => {
          const phase = fire.phase + i * 2.39996;
          const height = tongue.h * (0.78 + 0.32 * flick(time, phase));
          const steps = Math.max(2, Math.ceil(height / 0.09));
          for (let j = 0; j < steps; j++) {
            const u = j / (steps - 1);
            const sway = 0.035 * Math.sin(time * 3.1 + phase + j * 0.7) * u;
            colour.copy(u < 0.5 ? TONGUE_LOW : TONGUE_MID).lerp(u < 0.5 ? TONGUE_MID : TONGUE_TIP, u < 0.5 ? u * 2 : u * 2 - 1);
            cube(fire, tongue.x + sway, base + (j + 0.5) * height / steps, tongue.z + sway * 0.4, 0.125 * (1 - 0.55 * u), colour);
          }
          // One lick lifts off each tongue, shrinking as it rises.
          const rise = fract(time * 0.85 + phase / 6.2832);
          cube(fire, tongue.x + 0.04 * Math.sin(phase + time * 2), base + height + rise * 0.16, tongue.z, 0.065 * (1 - rise), colour.copy(TONGUE_MID).lerp(TONGUE_TIP, 0.4));
        });
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The near warm light field: the production 0.5 m flood (`buildLightVolume`) over blockers rasterised with
// `rasterizeLightOccluders`, plus the renderer's corner samples so pools shade smoothly on the clay.

const LIGHT = { origin: [-16, -1, -24] as Point, size: [64, 24, 68] as Point, cell: 0.5 };

/** Cells at least half filled by light-blocking voxels (glass passes light), as exact one-cell occluder runs. */
function voxelOccluders(placements: readonly Placement[], assets: ReadonlyMap<VoxelBlueprint, VoxelAsset>): OccluderBox[] {
  const [sx, sy, sz] = LIGHT.size, counts = new Uint16Array(sx * sy * sz);
  for (const placement of placements) {
    const asset = assets.get(placement.blueprint)!, [ax, ay, az] = asset.size;
    for (let z = 0; z < az; z++) for (let y = 0; y < ay; y++) for (let x = 0; x < ax; x++) {
      const material = asset.voxels[x + ax * (y + ay * z)]!;
      if (material === 0 || material === MAT.glass) continue;
      const [wx, wy, wz] = at(placement, [x + 0.5, y + 0.5, z + 0.5]);
      const cx = Math.floor((wx - LIGHT.origin[0]) / LIGHT.cell), cy = Math.floor((wy - LIGHT.origin[1]) / LIGHT.cell), cz = Math.floor((wz - LIGHT.origin[2]) / LIGHT.cell);
      if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) continue;
      counts[cx + sx * (cy + sy * cz)]!++;
    }
  }
  const boxes: OccluderBox[] = [], inset = 0.01, half = (LIGHT.cell / CELL) ** 3 / 2;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
    let start = -1;
    for (let x = 0; x <= sx; x++) {
      const blocked = x < sx && counts[x + sx * (y + sy * z)]! >= half;
      if (blocked && start < 0) start = x;
      if (!blocked && start >= 0) {
        const o = LIGHT.origin, c = LIGHT.cell;
        boxes.push({ min: [o[0] + start * c + inset, o[1] + y * c + inset, o[2] + z * c + inset], max: [o[0] + x * c - inset, o[1] + (y + 1) * c - inset, o[2] + (z + 1) * c - inset] });
        start = -1;
      }
    }
  }
  return boxes;
}

/** Corner samples in the renderer's near-field layout: level 0..15, bit 128 when the cell itself blocks. */
function cornerSamples(size: Point, occupancy: Uint8Array, light: Uint8Array): Uint8Array {
  const [sx, sy, sz] = size, samples = new Uint8Array((sx + 1) * (sy + 1) * (sz + 1));
  let target = 0;
  for (let z = 0; z <= sz; z++) for (let y = 0; y <= sy; y++) for (let x = 0; x <= sx; x++, target++) {
    let sum = 0, open = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const cx = x + dx, cy = y + dy, cz = z + dz;
      if (cx < 0 || cy < 0 || cz < 0 || cx >= sx || cy >= sy || cz >= sz) continue;
      const index = cx + sx * (cy + sy * cz);
      if (occupancy[index]) continue;
      sum += light[index]!; open++;
    }
    const own = x < sx && y < sy && z < sz && occupancy[x + sx * (y + sy * z)] ? 128 : 0;
    samples[target] = open === 0 ? 128 : Math.round(sum / open) | own;
  }
  return samples;
}

/** Steps a source out along its normal until it sits in open air, as the light field requires. */
function inAir(occupancy: Uint8Array, position: Point, normal: Point): Point {
  const [sx, sy, sz] = LIGHT.size;
  for (let step = 0; step <= 8; step++) {
    const p: Point = [position[0] + normal[0] * step * CELL, position[1] + normal[1] * step * CELL, position[2] + normal[2] * step * CELL];
    const c = p.map((v, axis) => Math.floor((v - LIGHT.origin[axis]!) / LIGHT.cell));
    if (c[0]! < 0 || c[1]! < 0 || c[2]! < 0 || c[0]! >= sx || c[1]! >= sy || c[2]! >= sz) return position;
    if (!occupancy[c[0]! + sx * (c[1]! + sy * c[2]!)]) return p;
  }
  return position;
}

// ---------------------------------------------------------------------------------------------------------------

type Pose = { eye: Point; target: Point; fov: number };
const VIEWS: Record<BenchView, Pose> = {
  // Standing in the lane at eye height: the smithy's open fire left, a brazier, the near hut's lit window and
  // chimney pots right, the hedge and meadow edge in the right foreground.
  street: { eye: [1.4, 1.72, 11.2], target: [1.3, 2.2, -4.5], fov: 44 },
  // A little higher and further back over the hedge, the whole corner in one frame.
  wide: { eye: [8.5, 5.6, 17.5], target: [-1.2, 1.6, -3.2], fov: 46 },
};

export async function createBenchScene(canvas: HTMLCanvasElement, options: { hour: number }): Promise<BenchScene> {
  let hour = Number.isFinite(options.hour) ? options.hour : 20;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const width0 = Math.max(1, canvas.clientWidth), height0 = Math.max(1, canvas.clientHeight);
  renderer.setSize(width0, height0, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VIEWS.street.fov, width0 / height0, 0.15, 900);
  const atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000, 0.0016);
  scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build');
  // The land shades as the kingdom's terrain does (its warm pools, contact and soft AO), on a flat height field:
  // the same clay at build scale, with the terrain response switched on and the near light field shared.
  const land = createVoxelMaterial(MATERIALS, 'build');
  for (const key of ['uLight', 'uLightOrigin', 'uLightExtent']) land.material.uniforms[key] = clay.material.uniforms[key]!;
  land.setTerrainHeight(new Float32Array(4), 2, 2, [-500, -500], 1000);
  const post = createPostStack(renderer, scene, camera, { quality: 'capture' });

  // --- Placements -----------------------------------------------------------------------------------------
  const ground = surfaceBlueprint('bench-effects-ground', SLAB.cells, [SLAB.x, SLAB.z], groundMaterial, 2);
  const turf = surfaceBlueprint('bench-effects-turf', SLAB.cells, [0, 0], (x, z) => noise(x, z, 3.1, 41) > 0.74 ? MAT.moss : MAT.grass, 1);
  const hearthHut = createHearthHome('hut', 0), crossHut = createHearthHome('hut', 1);
  const forge = createForgeHearth('hearth'), workshop = createForgeWorkshop('hearth'), brazier = createGateBrazier('hearth');
  const dragonMotif = createAnvilHeroDragon('hearth');
  // The forge flue carries the unmodified sleeping dragon, translated up 21 cells on the hearth's own pivot column.
  const dragon: VoxelBlueprint = { version: 1, id: 'bench-forge-dragon-hearth', styleId: STYLES.hearth.id, kind: 'prop', lattice: 'build',
    size: [...dragonMotif.size], boxes: dragonMotif.boxes, windows: [] };
  const shrub = createStreetProp('leafy-shrub', 'hearth'), trough = createStreetProp('flower-trough', 'hearth');
  const tufts = createDressing('meadow-tufts'), petals = createDressing('wildflowers-petal'), blues = createDressing('wildflowers-blue');
  const golds = createDressing('wildflowers-gold'), bed = createDressing('garden-bed', 'hearth'), woodpile = createDressing('woodpile');
  const barrels = createDressing('barrels'), fence = createDressing('rail-fence', 'hearth');
  const trees = [createTree(0), createTree(1), createTree(2)];

  const placements: Placement[] = [];
  const add = (placement: Placement) => { placements.push(placement); return placement; };
  add({ blueprint: ground, position: [SLAB.x, -2 * CELL, SLAB.z], turn: 0 });
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    if (i !== 0 || j !== 0) add({ blueprint: turf, position: [SLAB.x + i * 32, -CELL, SLAB.z + j * 32], turn: 0 });
  }
  const forgeWorld: Point = [-3, 0, -2];
  const hearth = add(placeAt(forge, FORGE_HEARTH_PIVOT, forgeWorld));
  add(placeAt(workshop, FORGE_WORKSHOP_HEARTH_PIVOT, forgeWorld));
  add(placeAt(dragon, DRAGON_MOUNT, [forgeWorld[0], 21 * CELL, forgeWorld[2]]));
  const braziers = [add(placeAt(brazier, GATE_BRAZIER_MOUNT, [-7.1, 0, 2.9])), add(placeAt(brazier, GATE_BRAZIER_MOUNT, [1.15, 0, 2.9]))];
  const nearHome = add({ blueprint: hearthHut, position: [3.2, 0, -20.6], turn: 0 });
  const farHome = add({ blueprint: crossHut, position: [-16.2, 0, -26.4], turn: 0 });
  // Under the near hut's lit window: a flower trough on the sill line and a bed against the wall.
  add({ blueprint: bed, position: [nearHome.position[0] + 1.2, 0, -4.6], turn: 0 });
  add({ blueprint: woodpile, position: [-0.4, 0, -3.2], turn: 0 });
  add({ blueprint: barrels, position: [-7.6, 0, -2.6], turn: 0 });
  // The hedge: leafy shrubs along the meadow's far side, a rail fence closing the near hut's garden.
  const hedge: Point[] = [[4.6, 0, 8.1], [5.5, 0, 6.9], [6.3, 0, 5.6], [7.2, 0, 4.5], [8.0, 0, 3.2], [8.9, 0, 2.1], [9.8, 0, 0.9], [10.5, 0, -0.4], [11.2, 0, -1.7]];
  hedge.forEach((p, i) => add({ blueprint: shrub, position: [p[0] - 0.75, 0, p[2] - 0.75], turn: (i % 4) as Turn }));
  add({ blueprint: fence, position: [7.9, 0, -3.6], turn: 0 });
  add({ blueprint: fence, position: [11.9, 0, -3.6], turn: 0 });
  // The meadow strip between the lane and the hedge: tufts with a scatter of flowers.
  const meadow: [VoxelBlueprint, Point][] = [[tufts, [3.0, 0, 6.6]], [petals, [4.4, 0, 4.7]], [tufts, [5.4, 0, 3.0]], [blues, [3.2, 0, 8.6]],
    [golds, [6.5, 0, 1.7]], [tufts, [7.6, 0, 0.2]], [petals, [8.6, 0, -1.4]], [tufts, [1.9, 0, 8.4]]];
  for (const [blueprint, p] of meadow) add({ blueprint, position: p, turn: 0 });
  add({ blueprint: trough, position: [nearHome.position[0] + 1.6, 0, -4.15], turn: 0 });
  // Old trees behind the homes close the view, so the land never ends against the sky.
  const treeSpots: [number, Point][] = [[0, [10.5, 0, -17.5]], [1, [-4.5, 0, -19]], [2, [-25, 0, -14]], [0, [16, 0, -6]], [1, [-21, 0, 2]], [2, [21, 0, -26]], [0, [-8, 0, -36]], [1, [4, 0, -38]]];
  for (const [variant, p] of treeSpots) add({ blueprint: trees[variant]!, position: [p[0] - 4, 0, p[2] - 4], turn: ((variant + 1) % 4) as Turn });

  // --- Real voxel meshes, one instanced draw per blueprint ------------------------------------------------
  const assets = new Map<VoxelBlueprint, VoxelAsset>();
  const meshes: THREE.InstancedMesh[] = [];
  const groups = new Map<VoxelBlueprint, Placement[]>();
  for (const placement of placements) { const list = groups.get(placement.blueprint); if (list) list.push(placement); else groups.set(placement.blueprint, [placement]); }
  for (const [blueprint, list] of groups) {
    // The synchronous form of the worker's blueprint job: raster, sky/halo preparation, greedy chunk meshes.
    const asset = rasterizeBlueprint(blueprint, 1);
    assets.set(blueprint, asset);
    const chunks: AssetChunkMesh[] = prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)
      .map(request => ({ coordinate: request.coordinate, mesh: meshVoxelChunk(request) }));
    const geometry = geometryFromChunks(chunks, 'build');
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(list.length).fill(1), 1));
    const isLand = blueprint === ground || blueprint === turf;
    const mesh = new THREE.InstancedMesh(geometry, isLand ? land.material : clay.material, list.length), matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((p, i) => mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(...p.position), q.setFromAxisAngle(up, p.turn * Math.PI / 2), new THREE.Vector3(1, 1, 1))));
    mesh.frustumCulled = false;
    mesh.name = blueprint.id;
    scene.add(mesh); meshes.push(mesh);
  }

  // --- Window presence (SIMULATED): both huts' first authored windows are lit, as two people at home ------
  const houses: WindowHouse[] = [
    { slot: 1, blueprint: hearthHut, position: [...nearHome.position], yaw: 0 },
    { slot: 2, blueprint: crossHut, position: [...farHome.position], yaw: 0 },
  ];
  const windows = createWindowLights(scene, houses);
  windows.setFrame(KingdomPresenceFrameSchema.parse({ version: 1, kingdomId: '1', epoch: 'effects-bench', sequence: 1, asOf: 10_000,
    origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: [{ slot: 1, present: true, publicName: null, since: 0 }, { slot: 2, present: true, publicName: null, since: 0 }] }));
  windows.update(0, hour);

  // --- Anchors (world metres) -----------------------------------------------------------------------------
  const forgeFlame = at(hearth, FORGE_HEARTH_FLAME);
  const forgeNose = at(hearth, FORGE_HEARTH_CHIMNEY_NOSE);
  const brazierFlames = braziers.map(b => at(b, GATE_BRAZIER_FLAME));
  const anchors: BenchAnchors = {
    // The forge's embers leave the firebox mouth just in front of the hood face (local z 16 is the brick front),
    // a quarter metre above the flame anchor; a brazier's rise a little above its bowl flame.
    emberSources: [
      { id: 'forge:hearth:firebox', position: at(hearth, [FORGE_HEARTH_FLAME[0], FORGE_HEARTH_FLAME[1] + 1.5, 16.75]) },
      ...braziers.map((b, i) => ({ id: `forge:brazier:${i}`, position: at(b, [GATE_BRAZIER_FLAME[0], GATE_BRAZIER_FLAME[1] + 1.25, GATE_BRAZIER_FLAME[2]]) })),
    ],
    // On the meadow side of the hedge, at grass-top height plus a little.
    fireflySources: [
      { id: 'meadow:hedge:a', position: [4.3, 0.55, 6.6] },
      { id: 'meadow:hedge:b', position: [5.9, 0.45, 4.4] },
      { id: 'meadow:hedge:c', position: [7.3, 0.6, 2.4] },
      { id: 'meadow:hedge:d', position: [8.7, 0.5, 0.6] },
      { id: 'meadow:hedge:e', position: [3.2, 0.5, 8.4] },
    ],
    // `homeLifeAnchors` (packages/world, the same projection the kingdom's home life uses): an air box of at most
    // 6x6 cells, above half the home's solid top, walled on four sides with a solid floor and clear sky above it,
    // is an open flue; its mouth is the top centre of that box. Transformed by the home's placement.
    chimneyMouths: [nearHome, farHome].flatMap((home, h) => homeLifeAnchors(home.blueprint).chimneys
      .map((mouth, i) => ({ id: `home:${h === 0 ? 'near' : 'far'}:chimney:${i}`, position: at(home, mouth) }))),
    forgeFlame, forgeNose,
  };

  // --- Warm light: the forge mouth, the two brazier bowls and the lit windows --------------------------------
  const spec = { revision: 1, origin: LIGHT.origin, size: LIGHT.size, cellSize: LIGHT.cell };
  const groundBox: OccluderBox = { min: [LIGHT.origin[0], LIGHT.origin[1], LIGHT.origin[2]], max: [LIGHT.origin[0] + LIGHT.size[0] * LIGHT.cell, -0.01, LIGHT.origin[2] + LIGHT.size[2] * LIGHT.cell] };
  const occupancy = rasterizeLightOccluders(spec, [groundBox, ...voxelOccluders(placements.filter(p => p.blueprint !== ground && p.blueprint !== turf), assets)]);
  const emitters = [
    { position: inAir(occupancy, forgeFlame, [0, 0, 1]), level: 15 },
    ...brazierFlames.map(position => ({ position: inAir(occupancy, position, [0, 1, 0]), level: 14 })),
    ...windows.getSources().map(source => ({ position: inAir(occupancy, [...source.position], [...source.normal]), level: Math.round(source.strength * 15) })),
  ];
  const flood = buildLightVolume({ ...spec, occupancy, emitters });
  const volume: LightVolume & { surfaceSamples: Uint8Array } = { ...flood, surfaceSamples: cornerSamples(LIGHT.size, occupancy, flood.light) };
  clay.setLight(volume);

  const fires = createFires(scene, [
    { kind: 'forge', anchor: forgeFlame, lateral: [1, 0], depth: [0, 1], phase: 0.6 },
    ...brazierFlames.map((anchor, i): Fire => ({ kind: 'brazier', anchor, lateral: [1, 0], depth: [0, 1], phase: 2.1 + i * 3.7 })),
  ]);

  // --- Frame ------------------------------------------------------------------------------------------------
  let pose = VIEWS.street, disposed = false;
  const target = new THREE.Vector3(), beaconAway = new THREE.Vector3(0, -500, 0), forgeLight = new THREE.Vector3(...forgeFlame);
  function fit(): void {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight), size = renderer.getSize(new THREE.Vector2());
    if (size.x === width && size.y === height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    post.resize(width, height, 1);
  }
  post.resize(width0, height0, 1);
  return {
    renderer, scene, camera, post, anchors,
    setView(name) {
      if (!(name in VIEWS)) throw new Error(`Unknown bench view ${String(name)}`);
      pose = VIEWS[name];
    },
    setHour(next) { if (Number.isFinite(next)) hour = next; },
    render(time) {
      if (disposed) return;
      const t = Number.isFinite(time) ? time : 0;
      fit();
      const grade = getEnvironment(hour);
      clay.setEnvironment(grade); land.setEnvironment(grade);
      fog.color.set(grade.fog); fog.density = grade.fogDensity * 1.35;
      windows.update(0, hour);
      fires.update(t);
      camera.position.set(...pose.eye); target.set(...pose.target);
      if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      camera.lookAt(target); camera.updateMatrixWorld();
      // No castle stands in this corner: the beacon is absent, not hidden.
      atmosphere.update(hour, t, camera, beaconAway, 0);
      post.update({ environment: grade, hour, focusDistance: null, forge: { position: forgeLight, strength: 1 } });
      post.render();
    },
    stats() { return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      fires.dispose(); windows.dispose(); atmosphere.dispose();
      for (const mesh of meshes) { scene.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); }
      clay.dispose(); land.dispose(); post.dispose(); renderer.dispose();
    },
  };
}
