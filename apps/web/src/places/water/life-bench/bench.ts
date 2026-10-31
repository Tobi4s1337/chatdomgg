// The water life review page: the lane's wildlife, wheel, motes, rings, mist, lamps and floaters on SIMULATED
// fixture land, over the lane's own water surface, drawn with the production voxel mesher, clay, avatar and terrain
// materials, atmosphere, window lights, the shared people-light helper and sun shadows. Every person, name and
// floater action here is SIMULATED. Served by the Vite dev server only (capture.mjs); the shipped app never loads it.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { KingdomLandform } from '@chatdom/world';
import { createPeopleLight } from '../../../kingdom/lights/people-light';
import type { PeopleLight } from '../../../kingdom/lights/types';
import { MILL } from '../../../../../../packages/content/src/places/water/mill/index';
import { WHEEL } from '../../../../../../packages/content/src/places/water/millrace/index';
import type { WaterPiece } from '../../../../../../packages/content/src/places/water/place-piece';
import { placePieceAnchors, type PlacedEmitter, type PlacedWalk } from '../../../../../../packages/world/src/places/water/anchors';
import { cellToWorld, directionToWorld } from '../../../../../../packages/world/src/places/water/frame';
import { deriveWaterReaches } from '../../../../../../packages/world/src/places/water/reaches';
import { millraceFixture } from '../millrace-bench/fixture';
import { reviewExtras } from '../millrace-bench/extras';
import { groundMaterial, meshGround, type BenchGround } from '../surface-bench/ground';
import { lakeFixture } from '../surface-bench/lake';
import { createWaterSurface, type WaterContact, type WaterLightSource, type WaterQuality } from '../surface/index';
import { createWaterLife, placeLampLight, type DustInput, type FloaterAction, type WaterLife, type WeirSprayInput, type WheelMount } from '../life/index';

type View = 'bridge-pond' | 'mill-wheel' | 'lake';
type Pose = { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
interface BenchApi { readonly view: View; hour(value: number): void; time(value: number): void; frameHash(): Promise<string>; readonly stats: Record<string, unknown> }
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomLife?: BenchApi };

const VIEWS: readonly View[] = ['bridge-pond', 'mill-wheel', 'lake'];
const CELL = 0.125;
const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas')!;
const seal = document.querySelector('[data-seal]')!;
const fail = (error: unknown) => {
  console.error('Water life bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
  seal.textContent = `The water life bench could not draw: ${document.body.dataset.error}`;
};
const number = (name: string, fallback: number, ok: (v: number) => boolean, rule: string) => {
  const raw = query.get(name), value = raw === null ? fallback : Number(raw);
  if (raw === '' || !Number.isFinite(value) || !ok(value)) throw new Error(`${name} must be ${rule}, not "${raw}".`);
  return value;
};
function parseView(value: string | null): View {
  const view = value ?? 'bridge-pond';
  if (!VIEWS.includes(view as View)) throw new Error(`Unknown view "${view}"; choose ${VIEWS.join(', ')}.`);
  return view as View;
}
const validHour = (h: number) => h >= 0 && h < 24, validTime = (t: number) => t >= 0;

try {
  const view = parseView(query.get('view'));
  let hour = number('hour', 20.5, validHour, 'an hour in [0, 24)'), time = number('time', 30, validTime, 'non-negative seconds');
  const seed = number('seed', 7, Number.isSafeInteger, 'a whole number');
  const people = number('people', 2, v => Number.isInteger(v) && v >= 0 && v <= 6, 'a whole number from 0 to 6');
  const floaterCount = number('floaters', view === 'lake' ? 3 : 2, v => Number.isInteger(v) && v >= 0 && v <= 16, 'a whole number from 0 to 16');
  const qualityRaw = query.get('quality') ?? 'full';
  if (qualityRaw !== 'full' && qualityRaw !== 'reduced') throw new Error(`quality must be full or reduced, not "${qualityRaw}".`);
  const quality: WaterQuality = qualityRaw;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
  const before = new Set(scene.children), atmosphere = createAtmosphere(scene);
  const atmosphereObjects = scene.children.filter(child => !before.has(child));
  const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build'), fur = createVoxelMaterial(MATERIALS, 'avatar');
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 512 });
  const meshes = new Map<string, Promise<THREE.BufferGeometry>>();
  const meshBlueprint = (blueprint: VoxelBlueprint) => {
    let pending = meshes.get(blueprint.id);
    if (!pending) {
      pending = pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${blueprint.id}`);
        return geometryFromChunks(result.chunks, 'build');
      });
      meshes.set(blueprint.id, pending);
    }
    return pending;
  };

  // ── The fixture for this view. ───────────────────────────────────────────────────────────────────────────────
  let ground: BenchGround, label: string, poses: { wide: Pose; tall: Pose }, shadowBounds: { min: Vec3; max: Vec3 }, shoreLevel: number;
  const statics: { id: string; blueprint: VoxelBlueprint; origin: Vec3; yaw: number; pivot?: Vec3; object?: (mesh: THREE.Mesh) => void }[] = [];
  const bodies: Parameters<typeof createWaterSurface>[0]['bodies'][number][] = [];
  let reaches: ReturnType<typeof deriveWaterReaches> = [], contacts: WaterContact[] = [];
  const walks: PlacedWalk[] = [], reeds: Vec3[] = [], lamps: PlacedEmitter[] = [], weirs: WeirSprayInput[] = [], doors: DustInput[] = [];
  let wheel: { pivot: Vec3; axis: Vec3; mesh?: THREE.Mesh } | null = null;
  let windowSources: (hourNow: number) => WaterLightSource[] = () => [];
  let beaconAt: Vec3 | null = null, beaconStrength = 0;
  /** SIMULATED people for the lamps, and where SIMULATED floaters are set down. */
  let deck: Vec3[] = [], launch: (i: number) => [number, number] = () => [0, 0];

  const centreOf = (origin: Vec3, turn: 0 | 1 | 2 | 3, piece: WaterPiece): Vec3 => cellToWorld({ origin, turn }, [piece.blueprint.size[0] / 2, 0, piece.blueprint.size[2] / 2]);

  if (view === 'lake') {
    const lake = lakeFixture();
    ground = lake.ground; poses = lake.views['lake-postcard']; shadowBounds = lake.shadowBounds; shoreLevel = lake.body.level;
    label = `${lake.label} · SIMULATED floaters`;
    bodies.push(lake.body);
    for (const p of lake.placements) {
      statics.push({ id: p.id, blueprint: p.blueprint, origin: p.origin, yaw: 0 });
      if (p.id.startsWith('reeds')) reeds.push([p.origin[0] + (p.blueprint.size[0] * CELL) / 2, p.origin[1] + 0.05, p.origin[2] + (p.blueprint.size[2] * CELL) / 2]);
    }
    const houses = lake.placements.filter(p => p.slot !== undefined).map(p => ({ slot: p.slot!, blueprint: p.blueprint, position: p.origin, yaw: 0 }));
    const windows = createWindowLights(scene, houses);
    const asOf = Date.UTC(2026, 9, 31, 19, 30);
    windows.setFrame({
      version: 1, kingdomId: 'kingdom_simulated_life_bench', epoch: 'sim:life-bench', sequence: 1, asOf, origin: 'simulated', streamLive: true, connection: 'fresh',
      windows: lake.homes.map(home => ({ slot: home.slot, present: home.present, publicName: null, since: asOf - 60_000 })),
    } as KingdomPresenceFrame);
    beaconAt = lake.beacon;
    beaconStrength = 0.18 + 0.82 * Math.pow(lake.homes.filter(h => h.present).length / lake.homes.length, 2.4);
    windowSources = hourNow => {
      windows.update(0, hourNow);
      const night = getEnvironment(hourNow).night;
      return [...windows.getSources().map(s => ({ position: s.position, strength: s.strength, kind: 'window' as const, normal: s.normal })),
        { position: [lake.beacon[0], lake.beacon[1] + 1.2, lake.beacon[2]], strength: beaconStrength * THREE.MathUtils.lerp(0.3, 1, THREE.MathUtils.smoothstep(night, 0.05, 0.26)), kind: 'beacon' }];
    };
    // SIMULATED floaters set down off the near bank, in front of the citizen.
    launch = i => [-3 + 2.6 * Math.sin(i * 2.1), 17.5 - 1.2 * (i % 3)];
  } else {
    const mill = millraceFixture(reviewExtras());
    ground = mill.ground; shadowBounds = mill.shadowBounds; shoreLevel = 0;
    label = `${mill.label.replace(', no people', '')} · ${people ? `${people} SIMULATED people on the bridge` : 'nobody on the bridge'} · SIMULATED floaters`;
    bodies.push(...mill.land.bodies);
    const landform: KingdomLandform = {
      version: 2, seed: 7, ridge: { origin: [0, -200], bearing: 0, length: 1, width: 1, height: 0 }, castleRise: { centre: [0, -300], radius: 1, height: 0 },
      lake: { x: 0, z: -400, radiusX: 1, radiusZ: 1, level: -50 }, hills: [], waters: mill.land.bodies.map(b => ({ ...b })), streams: mill.land.streams.map(s => ({ ...s, points: s.points })),
    };
    reaches = deriveWaterReaches(landform);
    contacts = mill.land.contacts.map(c => ({ a: [c.a[0], c.a[1]], ...(c.b ? { b: [c.b[0], c.b[1]] as const } : {}), radius: c.radius, strength: c.strength }));
    for (const p of mill.placements) {
      const entry: (typeof statics)[number] = { id: p.id, blueprint: p.piece.blueprint, origin: p.origin, yaw: p.mounted ? p.mounted.yaw : (p.turn * Math.PI) / 2, ...(p.mounted ? { pivot: p.mounted.pivot } : {}) };
      statics.push(entry);
      if (p.mounted) continue;
      const anchors = placePieceAnchors({ origin: p.origin, turn: p.turn }, p.piece);
      walks.push(...anchors.walks);
      if (p.id.startsWith('reeds')) reeds.push(centreOf(p.origin, p.turn, p.piece));
      if (p.id === 'bridge') lamps.push(...anchors.emitters);
      if (p.id === 'wheel') {
        const axle = anchors.mounts.find(m => m.id === 'axle')!;
        wheel = { pivot: axle.pivot, axis: axle.axis };
        entry.object = m => { wheel!.mesh = m; };
      }
      if (p.id === 'mill') {
        // Flour dust drifts from the door's threshold, out of its recessed face.
        doors.push({ position: cellToWorld({ origin: p.origin, turn: p.turn }, [(MILL.door.x[0] + MILL.door.x[1]) / 2, MILL.door.y[0], MILL.door.face]), normal: directionToWorld(p.turn, [0, 0, 1]) });
      }
    }
    // The weir's crest: the white contact line along its foot, raised to the pond it holds back.
    const crest = mill.land.contacts[0]!, pond = mill.land.bodies[0]!;
    weirs.push({ a: [crest.a[0], pond.level, crest.a[1] - 0.45], b: [crest.b![0], pond.level, crest.b![1] - 0.45], downstream: [0, 1], drop: pond.level });
    const bridge = mill.placements.find(p => p.id === 'bridge')!;
    const at = (cells: Vec3): Vec3 => [bridge.origin[0] + cells[0] * CELL, bridge.origin[1] + cells[1] * CELL, bridge.origin[2] + cells[2] * CELL];
    const axis = at([bridge.piece.blueprint.size[0] / 2, 0, bridge.piece.blueprint.size[2] / 2]);
    poses = view === 'bridge-pond'
      ? { wide: { eye: [axis[0] + 0.4, 1.45, 29.4], target: [axis[0], 2.3, axis[2]], fov: 46 }, tall: { eye: [axis[0] + 0.3, 1.45, 29.4], target: [axis[0], 3.2, axis[2]], fov: 64 } }
      : mill.views['mill-wheel'];
    const ends = [...lamps].sort((a, b) => a.position[0] - b.position[0]);
    const order = [0, ends.length - 1, 1, ends.length - 2].filter(i => i >= 0 && i < ends.length);
    deck = Array.from({ length: people }, (_, i) => { const lamp = ends[order[i % order.length]!]!.position; return [lamp[0] + (lamp[0] < axis[0] ? 1.2 : -1.2), lamp[1] - 1.6, axis[2]]; });
    // SIMULATED floaters set down in the stream above the bridge pool, so they drift down through it.
    launch = i => [-4 + 0.5 * Math.sin(i * 1.7), 4 + 1.6 * (i % 4)];
  }
  seal.textContent = `${label} · water ${quality}`;

  const groundMade = groundMaterial(ground, shoreLevel);
  const sunShadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...shadowBounds.min), new THREE.Vector3(...shadowBounds.max)), resolution: 2048 });
  sunShadows.bindReceiver(clay.material); sunShadows.bindReceiver(groundMade.state.material);
  const water = createWaterSurface({ bodies, reaches, ground: { data: ground.data, width: ground.width, height: ground.depth, origin: ground.origin, step: ground.step }, contacts, quality });
  scene.add(water.root);

  const tasks: Promise<unknown>[] = statics.map(async placement => {
    const model = new THREE.Mesh(await meshBlueprint(placement.blueprint), clay.material);
    model.name = placement.id;
    if (placement.pivot) {
      const pivot = placement.pivot;
      model.matrixAutoUpdate = false;
      model.matrix.makeTranslation(...placement.origin).multiply(new THREE.Matrix4().makeRotationY(placement.yaw)).multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
    } else { model.position.set(...placement.origin); model.rotation.y = placement.yaw; }
    scene.add(model); model.updateMatrix(); model.updateMatrixWorld(true); sunShadows.register(model);
    placement.object?.(model);
  });
  tasks.push(meshGround(pool, ground, groundMade, (x, z, h) => water.waterAt(x, z) !== null || bodies.some(b => Math.hypot((x - b.x) / b.radiusX, (z - b.z) / b.radiusZ) < 1 && h < b.level + 0.05)).then(land => {
    scene.add(land); land.updateMatrixWorld(true); sunShadows.register(land);
  }));

  // SIMULATED floater actions: launched before the bench's time, newest last.
  const floaters: FloaterAction[] = Array.from({ length: floaterCount }, (_, i) => ({
    id: `simulated-floater-${i}`, label: `SIMULATED lantern ${i + 1}`, launched: Math.max(0, time - 6 - 11 * (floaterCount - 1 - i)), from: launch(i),
  }));

  // The life layer mounts once the wheel's mesh exists, so it can turn it about its axle.
  let life: WaterLife | null = null;
  const lampLights = new Map<string, PeopleLight>(lamps.map(l => [l.id, createPeopleLight(placeLampLight(l))]));
  const strengths = new Map<string, number>();
  const lifeReady = Promise.all(tasks).then(async () => {
    const wheels: WheelMount[] = wheel?.mesh ? [{ object: wheel.mesh, pivot: wheel.pivot, axis: wheel.axis, radius: WHEEL.radius * CELL, width: (WHEEL.sole[1] - WHEEL.sole[0]) * CELL,
      level: water.waterAt(wheel.pivot[0], wheel.pivot[2] + 1.5)?.level ?? wheel.pivot[1] - WHEEL.radius * CELL }] : [];
    life = createWaterLife({
      seed, reeds, wheels, weirs, doors, lamps,
      habitat: { waterAt: water.waterAt, bodies, reaches, obstacles: contacts, walks },
      critters: { material: fur.material, pool, registry: MATERIALS },
    });
    scene.add(life.root);
    await life.ready;
  });

  // An optional review framing (eye x,y,z then target x,y,z) for looking at one creature closely.
  const look = query.get('look')?.split(',').map(Number);
  if (look && (look.length !== 6 || !look.every(Number.isFinite))) throw new Error('look must be six numbers: eye x,y,z then target x,y,z.');
  if (look) poses = { wide: { eye: [look[0]!, look[1]!, look[2]!], target: [look[3]!, look[4]!, look[5]!], fov: 40 }, tall: { eye: [look[0]!, look[1]!, look[2]!], target: [look[3]!, look[4]!, look[5]!], fov: 55 } };
  let pose = poses.wide;
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
    pose = poses[canvas.clientWidth >= canvas.clientHeight ? 'wide' : 'tall'];
  }
  new ResizeObserver(resize).observe(canvas); resize();

  let loaded = false, drawn = 0, frameNo = 0;
  const stats: Record<string, unknown> = { ready: false, view, label };
  void lifeReady.then(() => { loaded = true; }, fail);
  const target = new THREE.Vector3(), beacon = new THREE.Vector3(), nowhere = new THREE.Vector3(0, -1000, 0);
  function draw() {
    const grade = getEnvironment(hour); clay.setEnvironment(grade); fur.setEnvironment(grade); groundMade.state.setEnvironment(grade);
    renderer.toneMappingExposure = grade.exposure;
    camera.position.set(...pose.eye); target.set(...pose.target);
    if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
    camera.lookAt(target); camera.updateMatrixWorld();
    atmosphere.update(hour, time, camera, beaconAt ? beacon.set(...beaconAt) : nowhere, beaconStrength);
    fog.color.set(grade.fog); fog.density = grade.fogDensity;
    if (loaded) sunShadows.updateSunDirection(grade.sunDirection);
    // The host's people-light results for the place's lamps, with a dusk curve: SIMULATED people on the deck.
    const lit = THREE.MathUtils.smoothstep(grade.night, 0.1, 0.5);
    for (const [id, light] of lampLights) strengths.set(id, light.update(time, deck) * lit);
    // Host order: life, then water with the life's light, then the one reflection pass, then the normal render.
    life?.update({ time, hour, environment: grade, camera, lamps: strengths, floaters });
    water.update({ time, environment: grade, camera, sources: [...windowSources(hour), ...(life?.sources() ?? [])] });
    const reflection = water.reflect({ renderer, scene, camera, frame: ++frameNo, exclusions: [...atmosphereObjects, ...(life?.exclusions ?? [])] });
    renderer.render(scene, camera);
    Object.assign(stats, {
      hour, time, reflection, water: water.diagnostics(), life: life?.diagnostics() ?? null, labels: life?.floaterLabels().map(l => ({ ...l })) ?? [],
      lamps: Object.fromEntries(strengths), main: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
    });
  }
  function render() {
    try {
      draw();
      if (loaded && ++drawn === 2) { renderer.getContext().finish(); stats.ready = true; (window as BenchWindow).__chatdomReady = true; }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(render);
  (window as BenchWindow).__chatdomLife = {
    view, stats,
    hour: value => { if (!validHour(value)) throw new Error('hour must lie in [0, 24)'); hour = value; },
    time: value => { if (!(Number.isFinite(value) && validTime(value))) throw new Error('time must be non-negative seconds'); time = value; },
    // A digest of the drawn frame, so a capture can prove a seek back lands on the same pixels.
    async frameHash() {
      draw(); renderer.getContext().finish();
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    },
  };
} catch (error) { fail(error); }
