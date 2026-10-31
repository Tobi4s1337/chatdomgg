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
import type { CameraPose, HomeAnchor } from '../twitch-moments';

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
      setPresence(frame) { windows.setFrame(frame); windows.update(1, options.hour); lastField = -Infinity; },
      setPose(next) { pose = next; },
      get pose() { return pose; },
      render(atMs) {
        const grade = getEnvironment(options.hour);
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
