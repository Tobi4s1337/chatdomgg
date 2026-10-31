import * as THREE from 'three';
import { createTree, MATERIALS } from '@chatdom/content';
import { createAtmosphere, createPostStack, createSunShadows, createVoxelMaterial, createWater, createWindowLights,
  geometryFromChunks, getEnvironment, type PostQuality, type WindowHouse } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { generateSettlementPlan, randomUnit, samplePublicGround, seedHash, terrainHeight, type SettlementPlan } from '@chatdom/world';
import type { KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { placeMarketContent, placeSettlementContent } from '../settlement-content';
import { createCastleContent } from '../castle-content';
import { createLightField } from '../light-field';
import { inhabitedLightBounds } from '../light-bounds';
import { createSimulatedPresence } from '../presence-feed';
import { beaconStrength } from '../beacon';
import { createLandCandidate, PROTECTION_CLEARANCE, type BoundsXZ, type LandCandidate } from './stand-in';
import { buildLandGeometry, createLandMaterial, landHeightGrid, landRegistry } from './land-mesh';

/**
 * PICTURE-LAND FIXTURE (spec 46). The accepted founded geography (seed `simulated-founded-town`, 240 homes,
 * v1 landform) drawn on an explicit candidate land stand-in. Homes, market and castle use the real content
 * and the real kingdom materials, light field and sky; presence is the labelled SIMULATED scenario.
 * It proves appearance only. It is not wired into the kingdom, its collision or any founded revision.
 */

export interface FixtureView { eye: Vec3; target: Vec3; fov: number }
export interface FixtureOptions {
  hour: number;
  view: FixtureView;
  quality: PostQuality;
  /** Draw the accepted (unsculpted) ground instead, for a same-view comparison. */
  accepted: boolean;
  onProgress(text: string): void;
}

const FOUNDED = { seed: 'simulated-founded-town', tier: 'town', firstYear: 2022, year: 2026 } as const;
const LIGHT_UNIFORMS = ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell', 'uBeaconPosition', 'uBeaconStrength'];
/** Whole landscape; the coarse ring uses 4 m corners, the town and its margin exact metres. */
const LAND_BOUNDS: BoundsXZ = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const FAR_STEP = 4;

export const FIXTURE_VIEWS: Record<string, FixtureView> = {
  // Low on Crown Road's southern lanes, looking up the climb to the keep with the ridges behind it.
  street: { eye: [-5, 12.5, 46], target: [3, 19, -60], fov: 52 },
  // From the west shelf across the terraced edge of town toward the castle and the eastern knoll.
  west: { eye: [-205, 14, 66], target: [-20, 14, -70], fov: 50 },
  // Development overview of the whole candidate; not a composed shot.
  overview: { eye: [40, 95, 330], target: [0, 10, -140], fov: 55 },
};

export function foundedPlan(): SettlementPlan {
  return generateSettlementPlan(FOUNDED);
}

export async function createPictureLandFixture(canvas: HTMLCanvasElement, options: FixtureOptions) {
  const cleanups: (() => void)[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => { cleanups.push(() => resource.dispose()); return resource; };
  const dispose = (): void => { for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch { /* Release the rest. */ } } };
  try {
    const plan = foundedPlan();
    options.onProgress('Shaping the land');
    const accepted: LandCandidate = {
      bounds: LAND_BOUNDS,
      height: (x, z) => terrainHeight(plan, x, z), corner: (x, z) => Math.fround(terrainHeight(plan, x, z)),
      // The installed worker's own rule: designed paving width plus its worn edge, the lake bed, else grass.
      material: (x, z) => {
        const cx = Math.floor(x) + .5, cz = Math.floor(z) + .5;
        const wear = .22 * Math.sin(cx * .12 + cz * .09) + .1 * Math.sin(cx * .29 - cz * .17);
        if ((samplePublicGround(plan, cx, cz)?.pavingDistance ?? Infinity) <= Math.max(0, wear)) return 'paving';
        return terrainHeight(plan, cx, cz) < plan.lake.level + .25 ? 'waterbed' : 'grass';
      },
      protection: () => -PROTECTION_CLEARANCE,
    };
    const candidate = createLandCandidate({ plan, bounds: LAND_BOUNDS,
      ground: (x, z) => terrainHeight(plan, x, z), publicGround: (x, z) => samplePublicGround(plan, x, z) });

    const renderer = own(new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }));
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      console.error('Land fixture shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
      throw new Error('A land fixture shader could not compile');
    };
    renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(options.view.fov, 1, .15, 2600);
    const atmosphere = own(createAtmosphere(scene));
    const post = own(createPostStack(renderer, scene, camera, { quality: options.quality, toneMapping: 'aces', fog: 'material' }));
    const clay = own(createVoxelMaterial(MATERIALS, 'build')), ground = own(createVoxelMaterial(landRegistry(), 'terrain'));
    for (const key of LIGHT_UNIFORMS) ground.material.uniforms[key] = clay.material.uniforms[key]!;
    const lake = plan.lake;
    ground.setShoreLevel(lake.level, [lake.x - lake.radiusX * 1.3, lake.x + lake.radiusX * 1.3, lake.z - lake.radiusZ * 1.3, lake.z + lake.radiusZ * 1.3]);
    const shadows = own(createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(plan.bounds.minX - 40, -8, plan.bounds.minZ - 70), new THREE.Vector3(plan.bounds.maxX + 40, 60, plan.bounds.maxZ + 20)), resolution: 2048 }));
    shadows.bindReceiver(clay.material); shadows.bindReceiver(ground.material);
    const landMaterial = createLandMaterial(ground.material); cleanups.push(() => landMaterial.dispose());
    shadows.bindReceiver(landMaterial);

    // Land: exact metres over the town and a margin, then a coarse ring to the horizon with a hidden skirt.
    const source = options.accepted ? accepted : candidate;
    const align = (value: number, down: boolean): number => (down ? Math.floor(value / 8) : Math.ceil(value / 8)) * 8;
    // Exact metres reach north to the first ridge, so its ledges are never narrower than their triangles.
    const near: BoundsXZ = { minX: align(plan.bounds.minX - 24, true), maxX: align(plan.bounds.maxX + 24, false), minZ: align(plan.bounds.minZ - 172, true), maxZ: align(plan.bounds.maxZ + 24, false) };
    const geometries: THREE.BufferGeometry[] = [];
    cleanups.push(() => { for (const geometry of geometries) geometry.dispose(); });
    const landStarted = performance.now();
    for (const region of [{ bounds: near, step: 1, skirt: 3 }, { bounds: LAND_BOUNDS, step: FAR_STEP, hole: near }]) {
      const geometry = buildLandGeometry(source, region); geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, landMaterial); mesh.frustumCulled = false; scene.add(mesh);
      if (region.step === 1) shadows.register(mesh);
    }
    const landSeconds = (performance.now() - landStarted) / 1000;

    // The accepted homes and castle stand on their own foundations; props on the candidate ground.
    const { houses, props } = placeSettlementContent(plan.homes, (x, z) => source.height(x, z));
    props.push(...placeMarketContent(plan.market));
    const { buildings: castle, beaconPosition } = createCastleContent(plan.castle);
    const blockers: WindowHouse[] = [...houses, ...castle], placements = [...blockers, ...props];
    const windows = own(createWindowLights(scene, houses));
    const nearBlockers = [...blockers, ...props.map(prop => ({ ...prop, slot: 65534 }))];
    let nearBytes = 0, farBytes = 0, beaconBytes = 0, lightError: string | null = null;
    const fail = (error: Error): void => { lightError = error.message; };
    const field = own(createLightField(plan, nearBlockers, volume => { clay.setLight(volume); nearBytes = volume.estimatedPeakBytes; }, fail));
    const farField = own(createLightField(plan, blockers, volume => { clay.setFarLight(volume); farBytes = volume.estimatedPeakBytes; }, fail, { mode: 'kingdom', bounds: inhabitedLightBounds(plan.homes) }));
    const beaconField = own(createLightField(plan, blockers, volume => { clay.setBeaconLight(volume); beaconBytes = volume.estimatedPeakBytes; }, fail, { mode: 'beacon', position: beaconPosition }));

    // A modest grove on grass treads only: never on rock, a reservation, public ground, the castle or the lake.
    const trees = [createTree(0), createTree(1), createTree(2)], treePlaces = trees.map(() => [] as { position: Vec3; yaw: number }[]);
    const planted: [number, number][] = [], crown = 4.25;
    const plant = (x: number, z: number, variant: number): void => {
      if (source.protection(x, z) < crown + 1) return;
      if (plan.reservations.some(({ lot }) => x > lot.minX - crown && x < lot.maxX + crown && z > lot.minZ - crown && z < lot.maxZ + crown)) return;
      if ((samplePublicGround(plan, x, z)?.reservedDistance ?? Infinity) < crown) return;
      for (const dx of [-1.5, 0, 1.5]) for (const dz of [-1.5, 0, 1.5]) if (!['grass', 'heath'].includes(source.material(x + dx, z + dz))) return;
      if (planted.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 10)) return;
      let root = Infinity;
      for (const dx of [-1.25, 0, 1.25]) for (const dz of [-1.25, 0, 1.25]) root = Math.min(root, source.height(x + dx, z + dz));
      planted.push([x, z]); treePlaces[variant]!.push({ position: [x - 4, root, z - 4], yaw: 0 });
    };
    for (let i = 0; i < 2400 && planted.length < 170; i++) {
      const group = Math.floor(i / 9), rand = (part: string): number => randomUnit(seedHash(`${plan.config.seed}:picture-land-grove:${part}`));
      const cx = plan.bounds.minX - 60 + rand(`${group}:x`) * (plan.bounds.maxX - plan.bounds.minX + 120);
      const cz = plan.bounds.minZ - 110 + rand(`${group}:z`) * (plan.bounds.maxZ - plan.bounds.minZ + 140);
      const angle = rand(`${i}:a`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:r`)) * 12;
      plant(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius, group % 3);
    }

    const pool = own(new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 192 }));
    const instance = (blueprint: VoxelBlueprint, geometry: THREE.BufferGeometry, list: readonly { position: Vec3; yaw: number }[], scale: number): void => {
      if (!list.length) return;
      geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(list.length).fill(1), 1)); geometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, clay.material, list.length), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
      list.forEach((place, i) => mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(...place.position), rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw), new THREE.Vector3(scale, scale, scale))));
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.name = blueprint.id; scene.add(mesh); shadows.register(mesh);
      cleanups.push(() => mesh.dispose());
    };
    const unique = new Map<string, VoxelBlueprint>();
    for (const { blueprint } of placements) unique.set(blueprint.id, blueprint);
    const assets = [...unique.values(), ...trees];
    let built = 0;
    await Promise.all(assets.map(async blueprint => {
      const flora = trees.includes(blueprint), factor = flora ? 2 : 1;
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision, ...(factor === 1 ? {} : { lodFactor: factor }) });
      if (result?.kind !== 'asset') throw new Error(`Could not build ${blueprint.id}`);
      instance(blueprint, geometryFromChunks(result.chunks, 'build'), flora ? treePlaces[trees.indexOf(blueprint)]! : placements.filter(place => place.blueprint.id === blueprint.id), factor);
      options.onProgress(`Raising the town · ${++built}/${assets.length}`);
    }));

    const waterOrigin: [number, number] = [Math.floor(lake.x - lake.radiusX * 2), Math.floor(lake.z - lake.radiusZ * 2)];
    const waterWidth = Math.ceil(lake.radiusX * 4) + 1, waterDepth = Math.ceil(lake.radiusZ * 4) + 1;
    own(createWater(scene, { lake, terrain: { data: landHeightGrid(source, waterOrigin, waterWidth, waterDepth), width: waterWidth, height: waterDepth, origin: waterOrigin, step: 1 } }));
    const fog = new THREE.FogExp2(0x000000, .0012); scene.fog = fog;

    // SIMULATED presence: the labelled scenario, advanced until every home that will light has lit.
    const simulation = createSimulatedPresence(plan);
    simulation.advance(simulation.completeAt + 1);
    let frame: KingdomPresenceFrame | undefined;
    const unsubscribe = simulation.feed.subscribe(next => { frame = next; windows.setFrame(next); }, () => { frame = undefined; });
    cleanups.push(unsubscribe);

    const view = options.view;
    function resize(): void {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      post.resize(canvas.clientWidth, canvas.clientHeight, renderer.getPixelRatio());
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      camera.fov = view.fov; camera.position.set(...view.eye); camera.lookAt(new THREE.Vector3(...view.target));
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); cleanups.push(() => observer.disconnect()); resize();

    const beaconAt = new THREE.Vector3(...beaconPosition);
    const done = (stats: typeof field.stats): boolean => stats.publishedRevision === stats.requestedRevision && !stats.busy && !stats.queued;
    return {
      plan, candidate, landSeconds,
      /** Draw one settled frame at the fixture's fixed hour. */
      draw(elapsedSeconds: number): void {
        const hour = options.hour, grade = getEnvironment(hour);
        clay.setEnvironment(grade); ground.setEnvironment(grade);
        windows.update(1, hour);
        const beacon = beaconStrength(frame, houses.length);
        clay.setBeaconSource(beaconPosition, beacon);
        atmosphere.update(hour, elapsedSeconds, camera, beaconAt, beacon);
        fog.color.set(grade.fog); fog.density = grade.fogDensity;
        shadows.updateSunDirection(grade.sunDirection);
        post.update({ environment: grade, hour, focusDistance: null, beacon: { position: beaconAt, strength: beacon } });
        post.render(1 / 60);
      },
      /** Light every window and the beacon once; the fields settle in their workers. */
      light(): void {
        const target = new THREE.Vector3(...view.target).lerp(new THREE.Vector3(...view.eye), .6);
        const centre: Vec3 = [target.x, terrainHeight(plan, target.x, target.z), target.z];
        const sources = windows.getSources(), beacon = beaconStrength(frame, houses.length);
        field.update(centre, sources); farField.update(centre, sources);
        beaconField.update(beaconPosition, [{ position: beaconPosition, strength: beacon, normal: [0, 1, 0] }, ...sources.filter(source => source.slot === 65534)]);
      },
      get lightSettled(): boolean {
        if (lightError) throw new Error(lightError);
        return nearBytes > 0 && farBytes > 0 && beaconBytes > 0 && done(field.stats) && done(farField.stats) && done(beaconField.stats);
      },
      finish(): void { renderer.getContext().finish(); },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
