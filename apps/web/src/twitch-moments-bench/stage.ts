import * as THREE from 'three';
import { createTree, MATERIALS, MAT } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, createWindowLights, geometryFromChunks, getEnvironment, type WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type KingdomPresenceFrame, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool, rasterizeBlueprint, voxelIndex } from '@chatdom/voxel';
import { generateSettlementPlan, randomUnit, samplePublicGround, seedHash, terrainHeight, type SettlementPlan } from '@chatdom/world';
import { HOME_REVIEW as HEARTH_HOMES } from '../../../../packages/content/src/homes/hearth';
import { HOME_REVIEW as TIDE_HOMES } from '../../../../packages/content/src/homes/tide';
import { createCastleContent } from '../kingdom/castle-content';
import { createLightField } from '../kingdom/light-field';
import { inhabitedLightBounds } from '../kingdom/light-bounds';
import { placeMarketContent, placeSettlementContent } from '../kingdom/settlement-content';
import { loadTerrain } from '../kingdom/terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../kingdom/terrain-worker';
import { terrainBatches } from '../kingdom/terrain-batches';
import type { CameraPose, DoorAnchor, GiftRoute, HomeAnchor, PlaceAnchor, SkyGlow, SpectaclePlaces, WindowAnchor } from '../twitch-moments';

/**
 * The bench's kingdom: a real generated hamlet, composed from the same settlement, content, voxel worker,
 * light-field and renderer APIs as the kingdom scene. It owns no alternate renderer, motion or storage; it only
 * stands in for main's scene attachment until the production hooks exist (Spec 20, main-owned integration).
 */
export interface MomentStage {
  readonly layout: SettlementPlan;
  readonly houses: readonly WindowHouse[];
  readonly parent: THREE.Group;
  readonly material: THREE.Material;
  readonly camera: THREE.PerspectiveCamera;
  mesh(blueprint: VoxelBlueprint): Promise<THREE.BufferGeometry>;
  homeAnchor(slot: number): HomeAnchor | null;
  doorAnchor(slot: number): DoorAnchor | null;
  windowAnchor(slot: number): WindowAnchor | null;
  placeAnchor(place: 'market' | 'gate'): PlaceAnchor | null;
  giftRoute(): GiftRoute | null;
  readonly places: SpectaclePlaces;
  /** The sky's light on the town (fireworks, aurora, dragon fire), mixed into the hour's ambient until the next call. */
  setGlow(glow: SkyGlow): void;
  setPresence(frame: KingdomPresenceFrame): void;
  setPose(pose: CameraPose): void;
  readonly pose: CameraPose;
  render(atMs: number): void;
  stats(): { drawCalls: number; triangles: number; lightingReady: boolean };
  dispose(): void;
}

const ENTRANCES: Readonly<Record<string, { entrance: readonly [number, number, number] }>> = { ...HEARTH_HOMES, ...TIDE_HOMES };

/** Find a flat, window-free stretch of the street façade beside the door to hang a banner on. */
function bannerMount(house: WindowHouse): HomeAnchor | null {
  const blueprint = house.blueprint, [sx, sy, sz] = blueprint.size, asset = rasterizeBlueprint(blueprint);
  const front = (x: number, y: number) => { for (let z = sz - 1; z >= 0; z--) if (asset.voxels[voxelIndex(x, y, z, blueprint.size)] !== MAT.air) return z; return -1; };
  const material = (x: number, y: number, z: number) => asset.voxels[voxelIndex(x, y, z, blueprint.size)]!;
  const entrance = ENTRANCES[blueprint.id]?.entrance;
  const doorX = entrance && entrance[2] > sz / 2 ? entrance[0] : sx / 2;
  const floor = entrance ? entrance[1] - 11 : 4;
  const offsets = [13, -13, 15, -15, 17, -17, 19, -19, 11, -11];
  for (const rodY of [floor + 27, floor + 29, floor + 25, floor + 31]) for (const offset of offsets) {
    const centre = Math.round(doorX + offset) + 0.5, x0 = centre - 7.5;
    if (x0 < 0 || centre + 7.5 > sx || rodY + 3 > sy || rodY - 16 < 1) continue;
    const wall = front(Math.floor(centre), rodY);
    if (wall < sz * 0.5) continue;
    let ok = true;
    for (let x = x0; x < centre + 7.5 && ok; x++) for (let y = rodY - 16; y <= rodY + 3 && ok; y++) {
      const z = front(x, y);
      const cloth = x >= centre - 4.5 && x < centre + 4.5 && y < rodY;
      // Nothing may stand proud into the banner; the cloth never covers a door, window or recess.
      if (z > wall + 1 || (cloth && z < wall - 2)) ok = false;
      if (ok && cloth) for (let d = 0; d <= 3; d++) if (wall - d >= 0 && material(x, y, wall - d) === MAT.glass) ok = false;
    }
    for (const plate of [centre - 5.5, centre + 4.5]) for (let y = rodY - 3; y <= rodY + 2 && ok; y++) if (front(plate, y) < wall - 1) ok = false;
    if (!ok) continue;
    const toWorld = (cell: Vec3) => new THREE.Vector3(...cell).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw).add(new THREE.Vector3(...house.position));
    const mount = toWorld([centre, rodY + 0.5, wall + 1]);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw);
    const doorstep = toWorld([doorX, floor, sz + 3]);
    return { mount: mount.toArray(), normal: normal.toArray(), right: right.toArray(), doorstep: doorstep.toArray() };
  }
  return null;
}

const yawed = (house: WindowHouse, x: number, z: number) => new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw);
const toWorld = (house: WindowHouse, cell: Vec3) => new THREE.Vector3(...cell).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw)
  .add(new THREE.Vector3(...house.position));

/** The doorstep in front of the authored entrance (or the façade's middle), on the lot's floor. */
function doorOf(house: WindowHouse): DoorAnchor {
  const [sx, , sz] = house.blueprint.size, entrance = ENTRANCES[house.blueprint.id]?.entrance;
  const doorX = entrance && entrance[2] > sz / 2 ? entrance[0] : sx / 2, floor = entrance ? entrance[1] - 11 : 4;
  return { doorstep: toWorld(house, [doorX, floor, sz + 3]).toArray(), normal: yawed(house, 0, 1).toArray(), right: yawed(house, 1, 0).toArray() };
}

/** The presence window (the first authored one, as the window lights use), on its exterior glass face. */
function windowOf(house: WindowHouse): WindowAnchor | null {
  const window = house.blueprint.windows[0];
  if (!window) return null;
  const angle = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 }[window.facing] + house.yaw;
  const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)), right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
  return { centre: toWorld(house, window.centre).addScaledVector(normal, 0.006).toArray(), normal: normal.toArray(), right: right.toArray(),
    width: window.width * VOXEL_METRES.build, height: window.height * VOXEL_METRES.build };
}

/**
 * The gift cart's real route along active streets: in along the lane whose far junction lies nearest 55 m of road
 * from the market, and on up the castle road. Street points are the plan's own ground points.
 */
function giftRouteOf(layout: SettlementPlan): GiftRoute | null {
  const active = new Set(layout.activeStreetIds), market = layout.market.nodeId;
  const node = new Map(layout.nodes.map(n => [n.id, n]));
  const edges = layout.streets.filter(s => active.has(s.id) && s.kind !== 'approach' && s.kind !== 'trail');
  const length = (points: readonly Vec3[]) => points.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - points[i - 1]![0], p[2] - points[i - 1]![2]) : 0, 0);
  // Shortest road from the market to every junction.
  const best = new Map<string, { distance: number; points: Vec3[] }>([[market, { distance: 0, points: [node.get(market)!.position] }]]);
  const open = [market];
  while (open.length) {
    open.sort((a, b) => best.get(a)!.distance - best.get(b)!.distance);
    const here = open.shift()!, from = best.get(here)!;
    for (const edge of edges) {
      if (edge.from !== here && edge.to !== here) continue;
      const there = edge.from === here ? edge.to : edge.from, points = edge.from === here ? [...edge.points] : [...edge.points].reverse();
      const distance = from.distance + length(points);
      if ((best.get(there)?.distance ?? Infinity) <= distance) continue;
      best.set(there, { distance, points: [...from.points, ...points.slice(1)] });
      if (!open.includes(there)) open.push(there);
    }
  }
  const gate = layout.castle.gateNodeId;
  const entries = [...best.entries()].filter(([id]) => id !== market && id !== gate && !id.startsWith('road:') && best.get(id)!.distance > 30);
  const [, entry] = entries.sort((a, b) => Math.abs(a[1].distance - 55) - Math.abs(b[1].distance - 55))[0] ?? [];
  const castle = best.get(gate);
  if (!entry || !castle) return null;
  // On out up the castle road, as far as the first 60 m of it.
  let run = 0, end = castle.points.length;
  for (let i = 1; i < castle.points.length; i++) { run += Math.hypot(castle.points[i]![0] - castle.points[i - 1]![0], castle.points[i]![2] - castle.points[i - 1]![2]); if (run > 60) { end = i + 1; break; } }
  return { inbound: [...entry.points].reverse(), outbound: castle.points.slice(0, Math.max(2, end)) };
}

/** The festival train's loop: a rounded ring just outside the homes, kept off the lake and the castle, on the ground. */
function trackOf(layout: SettlementPlan): Vec3[] {
  const lots = layout.reservations.map(r => r.lot);
  const minX = Math.min(...lots.map(l => l.minX)) - 10, maxX = Math.max(...lots.map(l => l.maxX)) + 10;
  const minZ = Math.min(...lots.map(l => l.minZ)) - 10, maxZ = Math.max(...lots.map(l => l.maxZ)) + 10;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, rx = (maxX - minX) / 2, rz = (maxZ - minZ) / 2;
  const c = layout.castle.bounds, lake = layout.lake;
  const blocked = (x: number, z: number) => (x > c.minX - 6 && x < c.maxX + 6 && z > c.minZ - 6 && z < c.maxZ + 6)
    || Math.hypot((x - lake.x) / lake.radiusX, (z - lake.z) / lake.radiusZ) < 1.25;
  const out: Vec3[] = [];
  const count = Math.max(48, Math.round(Math.PI * (rx + rz) / 2.2));
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2;
    // A squircle reads as a laid railway rather than a drawn circle: long straights with rounded ends.
    const sx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.6, sz = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.6;
    let k = 1, x = cx + sx * rx, z = cz + sz * rz;
    while (blocked(x, z) && k > 0.45) { k -= 0.03; x = cx + sx * rx * k; z = cz + sz * rz * k; }
    out.push([x, terrainHeight(layout, x, z), z]);
  }
  // Ease the ring so pulled-in stretches curve rather than step.
  for (let pass = 0; pass < 3; pass++) {
    const copy = out.map(p => [...p] as Vec3);
    for (let i = 0; i < out.length; i++) {
      const a = copy[(i - 1 + out.length) % out.length]!, b = copy[i]!, d = copy[(i + 1) % out.length]!;
      const x = (a[0] + 2 * b[0] + d[0]) / 4, z = (a[2] + 2 * b[2] + d[2]) / 4;
      out[i] = [x, terrainHeight(layout, x, z), z];
    }
  }
  return out;
}

/** The town's public places for the spectacle layers, all from the plan and the placed homes. */
function placesOf(layout: SettlementPlan, houses: readonly WindowHouse[], castle: readonly (WindowHouse & { id: string })[], beacon: Vec3, track: readonly Vec3[]): SpectaclePlaces {
  const ground = (x: number, z: number): Vec3 => [x, terrainHeight(layout, x, z), z];
  const homes = layout.homes.map(h => h.position);
  const cx = homes.reduce((s, p) => s + p[0], 0) / Math.max(1, homes.length), cz = homes.reduce((s, p) => s + p[2], 0) / Math.max(1, homes.length);
  const radius = Math.max(30, ...homes.map(p => Math.hypot(p[0] - cx, p[2] - cz) + 12));
  const market = layout.market.boundary, mx = market.reduce((s, p) => s + p[0], 0) / market.length, mz = market.reduce((s, p) => s + p[1], 0) / market.length;
  const kinds = new Map(layout.castle.modules.map(m => [m.id, m.kind]));
  const walls = castle.filter(b => kinds.get(b.id) !== 'keep').map(b => {
    const [sx, sy, sz] = b.blueprint.size;
    return toWorld(b, [sx / 2, sy, sz / 2]).toArray() as Vec3;
  });
  // The lair lies in the hills beyond the castle, away from the homes.
  const away = new THREE.Vector3(layout.castle.centre[0] - cx, 0, layout.castle.centre[2] - cz).normalize();
  const lx = layout.castle.centre[0] + away.x * 70, lz = layout.castle.centre[2] + away.z * 70;
  const roofs = new Map(houses.map(h => {
    const [sx, sy, sz] = h.blueprint.size;
    return [h.slot, toWorld(h, [sx / 2, sy, sz / 2]).toArray() as Vec3] as const;
  }));
  const active = new Set(layout.activeStreetIds);
  const bunting = layout.streets.filter(st => active.has(st.id) && (st.kind === 'main' || st.kind === 'lane') && st.points.length > 1)
    .sort((a, b) => Math.hypot(a.points[0]![0] - mx, a.points[0]![2] - mz) - Math.hypot(b.points[0]![0] - mx, b.points[0]![2] - mz)).slice(0, 6)
    .map(st => st.points.map(p => [p[0], p[1] + 4.4, p[2]] as Vec3));
  return {
    sky: () => ({ centre: ground(cx, cz), radius, ceiling: 58 }),
    castle: () => ({ crown: beacon, walls }),
    plaza: () => ground(mx, mz),
    lair: () => ({ position: ground(lx, lz), facing: away.clone().negate().toArray() }),
    track: () => track,
    bunting: () => bunting,
    roof: slot => roofs.get(slot) ?? null,
    homes: () => [...roofs.keys()].sort((a, b) => a - b),
  };
}

export async function createMomentStage(canvas: HTMLCanvasElement, options: { seed: string; hour: number; signal: AbortSignal; onProgress(fraction: number): void }): Promise<MomentStage> {
  const cleanups: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => { cleanups.push(() => resource.dispose()); return resource; };
  try {
    const layout = generateSettlementPlan({ seed: options.seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
    const renderer = own(new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, 0.15, 2200), atmosphere = own(createAtmosphere(scene));
    const clay = own(createVoxelMaterial(MATERIALS, 'build')), ground = own(createVoxelMaterial(MATERIALS, 'terrain'));
    for (const key of ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell']) ground.material.uniforms[key] = clay.material.uniforms[key]!;
    const heightOrigin: [number, number] = [Math.floor(layout.bounds.minX) - 20, Math.floor(layout.bounds.minZ) - 20];
    const heightWidth = Math.ceil(layout.bounds.maxX - heightOrigin[0]) + 21, heightDepth = Math.ceil(layout.bounds.maxZ - heightOrigin[1]) + 21;
    const heightData = new Float32Array(heightWidth * heightDepth);
    for (let z = 0; z < heightDepth; z++) for (let x = 0; x < heightWidth; x++) heightData[x + z * heightWidth] = terrainHeight(layout, heightOrigin[0] + x, heightOrigin[1] + z);
    ground.setTerrainHeight(heightData, heightWidth, heightDepth, heightOrigin, 1);
    ground.setShoreLevel(layout.lake.level, [layout.lake.x - layout.lake.radiusX * 1.3, layout.lake.x + layout.lake.radiusX * 1.3, layout.lake.z - layout.lake.radiusZ * 1.3, layout.lake.z + layout.lake.radiusZ * 1.3]);
    const pool = own(new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 192 }));
    const { houses, props } = placeSettlementContent(layout.homes, (x, z) => terrainHeight(layout, x, z));
    props.push(...placeMarketContent(layout.market));
    const { buildings: castle, beaconPosition } = createCastleContent(layout.castle);
    const content = [...houses, ...castle, ...props];
    const windows = own(createWindowLights(scene, houses));
    const shadows = own(createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(layout.bounds.minX - 40, -8, layout.bounds.minZ - 70), new THREE.Vector3(layout.bounds.maxX + 40, 60, layout.bounds.maxZ + 20)), resolution: 2048 }));
    shadows.bindReceiver(clay.material); shadows.bindReceiver(ground.material);
    const track = trackOf(layout);
    const blockers = [...houses, ...castle], near = [...blockers, ...props.map(p => ({ ...p, slot: 65534 }))];
    let nearBytes = 0, farBytes = 0, beaconBytes = 0;
    const field = own(createLightField(layout, near, v => { clay.setLight(v); nearBytes = v.estimatedPeakBytes; }));
    const farField = own(createLightField(layout, blockers, v => { clay.setFarLight(v); farBytes = v.estimatedPeakBytes; }, undefined, { mode: 'kingdom', bounds: inhabitedLightBounds(layout.homes) }));
    const beaconField = own(createLightField(layout, blockers, v => { clay.setBeaconLight(v); beaconBytes = v.estimatedPeakBytes; }, undefined, { mode: 'beacon', position: beaconPosition }));
    const parent = new THREE.Group(); parent.name = 'twitch-moments-host'; scene.add(parent);
    const geometries: THREE.BufferGeometry[] = [], meshes: THREE.InstancedMesh[] = [];
    // Trees in the quiet ground around the hamlet, kept off lots, streets, the castle and the lake.
    const trees = [createTree(0), createTree(1), createTree(2)], treePlaces = trees.map(() => [] as { position: Vec3; yaw: number }[]), planted: [number, number][] = [];
    for (let i = 0; i < 1400 && planted.length < 110; i++) {
      const group = Math.floor(i / 7), rand = (part: string) => randomUnit(seedHash(`${options.seed}:grove:${part}`));
      const cx = layout.bounds.minX - 35 + rand(`${group}:x`) * (layout.bounds.maxX - layout.bounds.minX + 70), cz = layout.bounds.minZ - 65 + rand(`${group}:z`) * (layout.bounds.maxZ - layout.bounds.minZ + 45);
      const angle = rand(`${i}:a`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:r`)) * 10, x = cx + Math.cos(angle) * radius, z = cz + Math.sin(angle) * radius;
      if (layout.reservations.some(({ lot }) => x > lot.minX - 4.25 && x < lot.maxX + 4.25 && z > lot.minZ - 4.25 && z < lot.maxZ + 4.25)) continue;
      if ((samplePublicGround(layout, x, z)?.reservedDistance ?? Infinity) < 4.25) continue;
      const c = layout.castle.bounds;
      if (x > c.minX - 4.25 && x < c.maxX + 4.25 && z > c.minZ - 4.25 && z < c.maxZ + 4.25) continue;
      if (Math.hypot((x - layout.lake.x) / layout.lake.radiusX, (z - layout.lake.z) / layout.lake.radiusZ) < 1.19) continue;
      if (planted.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 8)) continue;
      // The festival railway runs clear through the groves.
      if (track.some(p => (p[0] - x) ** 2 + (p[2] - z) ** 2 < 20)) continue;
      planted.push([x, z]);
      let low = Infinity;
      for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) low = Math.min(low, terrainHeight(layout, x + dx, z + dz));
      treePlaces[group % 3]!.push({ position: [x - 4, low, z - 4], yaw: 0 });
    }
    const assets: { blueprint: VoxelBlueprint; placements: readonly { position: Vec3; yaw: number }[] }[] = [];
    for (const b of new Map(content.map(c => [c.blueprint.id, c.blueprint])).values()) assets.push({ blueprint: b, placements: content.filter(c => c.blueprint.id === b.id) });
    trees.forEach((tree, i) => assets.push({ blueprint: tree, placements: treePlaces[i]! }));
    let done = 0;
    const total = assets.length + 1;
    const jobs = assets.map(async ({ blueprint, placements }) => {
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (options.signal.aborted || result?.kind !== 'asset' || placements.length === 0) return;
      const geometry = geometryFromChunks(result.chunks, 'build'); geometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, clay.material, placements.length);
      geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1), 1));
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0);
      placements.forEach((p, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...p.position), q.setFromAxisAngle(axis, p.yaw), new THREE.Vector3(1, 1, 1))));
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; scene.add(mesh); meshes.push(mesh); shadows.register(mesh);
      options.onProgress(++done / total);
    });
    const abort = new AbortController();
    const stop = () => abort.abort();
    options.signal.addEventListener('abort', stop, { once: true });
    cleanups.push(() => options.signal.removeEventListener('abort', stop));
    jobs.push(loadTerrain(layout, () => {}, { signal: abort.signal }).then(({ chunks, origin }) => {
      for (const tile of terrainBatches(chunks)) {
        const geometry = geometryFromChunks(tile, 'terrain'); geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);
        geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere()); geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, ground.material); mesh.position.set(...origin); scene.add(mesh); shadows.register(mesh);
      }
      options.onProgress(++done / total);
    }));
    const water = own(createWater(scene, { lake: layout.lake, terrain: { data: heightData, width: heightWidth, height: heightDepth, origin: heightOrigin, step: 1 } }));
    const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
    await Promise.all(jobs);
    if (options.signal.aborted) throw new DOMException('The bench closed while loading', 'AbortError');

    const anchors = new Map<number, HomeAnchor | null>();
    const route = giftRouteOf(layout);
    const places = placesOf(layout, houses, castle, beaconPosition, track);
    let glow: SkyGlow = { colour: [0, 0, 0], strength: 0 };
    const lit = new THREE.Color(), flash = new THREE.Color();
    let pose: CameraPose = { eye: [0, 40, 80], target: [0, 0, 0], fov: 46 }, lastField = -Infinity;
    const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    cleanups.push(() => observer.disconnect());
    const disposeAll = () => {
      for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch { /* release the rest */ } }
      for (const g of geometries) g.dispose();
      for (const m of meshes) m.dispose();
      scene.clear();
    };
    return {
      layout, houses, parent, material: clay.material, camera,
      async mesh(blueprint) {
        const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
        if (result?.kind !== 'asset') throw new Error('A banner part could not be meshed');
        return geometryFromChunks(result.chunks, 'build');
      },
      homeAnchor(slot) {
        if (!anchors.has(slot)) { const house = houses.find(h => h.slot === slot); anchors.set(slot, house ? bannerMount(house) : null); }
        return anchors.get(slot)!;
      },
      doorAnchor(slot) { const house = houses.find(h => h.slot === slot); return house ? doorOf(house) : null; },
      windowAnchor(slot) { const house = houses.find(h => h.slot === slot); return house ? windowOf(house) : null; },
      placeAnchor(place) {
        if (!route) return null;
        // The gate is where the cart's lane enters the hamlet; the market is where it stops.
        const [a, b] = place === 'gate' ? [route.inbound[0]!, route.inbound[1]!] : [route.inbound.at(-1)!, route.inbound.at(-2)!];
        const facing = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize();
        return { position: a, facing: (place === 'gate' ? facing : facing.negate()).toArray() };
      },
      giftRoute: () => route,
      places,
      setGlow(next) { glow = next; },
      setPresence(frame) { windows.setFrame(frame); windows.update(1, options.hour); lastField = -Infinity; },
      setPose(next) { pose = next; },
      get pose() { return pose; },
      render(atMs) {
        const base = getEnvironment(options.hour);
        // The sky's light washes the town: the ambient leans toward the burst's colour and lifts with its strength.
        const k = Math.min(1, Math.max(0, glow.strength));
        const grade = k > 0.001 ? { ...base, ambient: `#${lit.set(base.ambient).lerp(flash.setRGB(...glow.colour), Math.min(0.5, k * 0.85)).getHexString()}`,
          ambientIntensity: base.ambientIntensity * (1 + 1.25 * k) } : base;
        clay.setEnvironment(grade); ground.setEnvironment(grade);
        camera.position.set(...pose.eye); camera.lookAt(new THREE.Vector3(...pose.target));
        if (Math.abs(camera.fov - pose.fov) > 1e-3) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
        camera.updateMatrixWorld();
        windows.update(0, options.hour);
        const now = performance.now();
        if (now - lastField > 240) {
          lastField = now;
          const t = pose.target, centre: Vec3 = [t[0], terrainHeight(layout, t[0], t[2]), t[2]];
          field.update(centre, windows.getSources()); farField.update(centre, windows.getSources());
          beaconField.update(beaconPosition, [{ position: beaconPosition, strength: 0.65, normal: [0, 1, 0] }]);
        }
        atmosphere.update(options.hour, atMs / 1000, camera, new THREE.Vector3(...beaconPosition), 0.65);
        fog.color.set(grade.fog); fog.density = 0.0016;
        water.update(grade, atMs / 1000, camera);
        shadows.updateSunDirection(grade.sunDirection);
        renderer.render(scene, camera);
      },
      stats: () => ({ drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lightingReady: nearBytes > 0 && farBytes > 0 && beaconBytes > 0 }),
      dispose: disposeAll,
    };
  } catch (error) {
    for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch { /* release the rest */ } }
    throw error;
  }
}
