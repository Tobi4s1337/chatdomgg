// The water surface review page: the lane's water material and its explicit one-pass planar reflection against the
// coherent reduced path, on SIMULATED fixture land (a lake below a town, and the millrace's bridge pool), drawn
// with the production voxel mesher, clay and terrain materials, atmosphere, window lights, people light and sun
// shadows. Served by the Vite dev server only (capture.mjs); the shipped app never loads it.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { KingdomLandform } from '@chatdom/world';
import { createPeopleLight } from '../../../kingdom/lights/people-light';
import { deriveWaterReaches } from '../../../../../../packages/world/src/places/water/reaches';
import { millraceFixture } from '../millrace-bench/fixture';
import { reviewExtras } from '../millrace-bench/extras';
import { createWaterSurface, type WaterContact, type WaterLightSource, type WaterQuality } from '../surface/index';
import { groundMaterial, meshGround, type BenchGround } from './ground';
import { lakeFixture } from './lake';

type View = 'lake-postcard' | 'bridge-pond';
type Pose = { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
interface BenchApi { view: View; hour(value: number): void; quality(value: string): void; time(value: number): void; readonly stats: Record<string, unknown> }
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomWater?: BenchApi };

const VIEWS: readonly View[] = ['lake-postcard', 'bridge-pond'];
const CELL = 0.125;
const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas')!;
const seal = document.querySelector('[data-seal]')!;
const fail = (error: unknown) => {
  console.error('Water surface bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
  seal.textContent = `The water surface bench could not draw: ${document.body.dataset.error}`;
};
function parseView(value: string | null): View {
  const view = value ?? 'lake-postcard';
  if (!VIEWS.includes(view as View)) throw new Error(`Unknown view "${view}"; choose ${VIEWS.join(' or ')}.`);
  return view as View;
}
function parseHour(value: string | null): number {
  const hour = Number(value ?? 19.5);
  if (value === '' || !Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error(`Hour must lie in [0, 24), not "${value}".`);
  return hour;
}
function parseTime(value: string | null): number {
  const time = Number(value ?? 30);
  if (value === '' || !Number.isFinite(time) || time < 0) throw new Error(`Time must be finite non-negative seconds, not "${value}".`);
  return time;
}
function parseQuality(value: string | null): WaterQuality {
  const quality = value ?? 'full';
  if (quality !== 'full' && quality !== 'reduced') throw new Error(`Quality must be full or reduced, not "${value}".`);
  return quality;
}
function parsePeople(value: string | null): number {
  const people = Number(value ?? 2);
  if (!Number.isInteger(people) || people < 0 || people > 6) throw new Error(`People must be a whole number from 0 to 6, not "${value}".`);
  return people;
}

/** A soft warm disc standing in for a lit lantern's glow on this bench only; the place's own lamp presentation is PW05's. */
function glowTexture(): THREE.Texture {
  const size = 64, paint = document.createElement('canvas');
  paint.width = paint.height = size;
  const g = paint.getContext('2d')!, gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,226,170,1)'); gradient.addColorStop(0.25, 'rgba(255,170,90,0.55)'); gradient.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = gradient; g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(paint); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

try {
  const view = parseView(query.get('view'));
  let hour = parseHour(query.get('hour')), time = parseTime(query.get('time'));
  const quality = parseQuality(query.get('quality')), people = parsePeople(query.get('people'));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
  // The sky dome follows the real camera, so the mirrored view cannot see it: the water draws its own sky there.
  const before = new Set(scene.children), atmosphere = createAtmosphere(scene);
  const atmosphereObjects = scene.children.filter(child => !before.has(child));
  const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build');
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

  // ── The fixture for this view, in the land's own records. ──────────────────────────────────────────────────
  let ground: BenchGround, label: string, poses: { wide: Pose; tall: Pose }, shadowBounds: { min: Vec3; max: Vec3 };
  let shoreLevel: number;
  const statics: { id: string; blueprint: VoxelBlueprint; origin: Vec3; yaw: number; pivot?: Vec3 }[] = [];
  const bodies: Parameters<typeof createWaterSurface>[0]['bodies'][number][] = [];
  let reaches: ReturnType<typeof deriveWaterReaches> = [];
  let contacts: WaterContact[] = [];
  let lights: (seconds: number, hourNow: number) => WaterLightSource[];
  let beaconAt: Vec3 | null = null, beaconStrength = 0;
  const glows: THREE.Sprite[] = [];

  if (view === 'lake-postcard') {
    const lake = lakeFixture();
    ground = lake.ground; label = lake.label; poses = lake.views['lake-postcard']; shadowBounds = lake.shadowBounds; shoreLevel = lake.body.level;
    bodies.push(lake.body);
    for (const p of lake.placements) statics.push({ id: p.id, blueprint: p.blueprint, origin: p.origin, yaw: 0 });
    const houses = lake.placements.filter(p => p.slot !== undefined).map(p => ({ slot: p.slot!, blueprint: p.blueprint, position: p.origin, yaw: 0 }));
    const windows = createWindowLights(scene, houses);
    // SIMULATED presence: one public frame in which the lit homes' people have been in for a while.
    const asOf = Date.UTC(2026, 9, 31, 19, 30);
    const frame: KingdomPresenceFrame = {
      version: 1, kingdomId: 'kingdom_simulated_water_bench', epoch: 'sim:water-bench', sequence: 1, asOf, origin: 'simulated',
      streamLive: true, connection: 'fresh', windows: lake.homes.map(home => ({ slot: home.slot, present: home.present, publicName: null, since: asOf - 60_000 })),
    } as KingdomPresenceFrame;
    windows.setFrame(frame);
    beaconAt = lake.beacon;
    const present = lake.homes.filter(home => home.present).length;
    beaconStrength = 0.18 + 0.82 * Math.pow(present / lake.homes.length, 2.4);
    lights = (_seconds, hourNow) => {
      windows.update(0, hourNow);
      const night = getEnvironment(hourNow).night;
      const sources: WaterLightSource[] = windows.getSources().map(s => ({ position: s.position, strength: s.strength, kind: 'window', normal: s.normal }));
      // The beacon's reflected column needs dusk as its sky column does; its crown alone reads by day.
      sources.push({ position: [lake.beacon[0], lake.beacon[1] + 1.2, lake.beacon[2]], strength: beaconStrength * THREE.MathUtils.lerp(0.3, 1, THREE.MathUtils.smoothstep(night, 0.05, 0.26)), kind: 'beacon' });
      return sources;
    };
  } else {
    const mill = millraceFixture(reviewExtras());
    ground = mill.ground; label = `${mill.label} · ${people ? `${people} SIMULATED people on the bridge` : 'nobody on the bridge'}`;
    shadowBounds = mill.shadowBounds; shoreLevel = 0;
    bodies.push(...mill.land.bodies);
    const landform: KingdomLandform = {
      version: 2, seed: 7, ridge: { origin: [0, -200], bearing: 0, length: 1, width: 1, height: 0 }, castleRise: { centre: [0, -300], radius: 1, height: 0 },
      lake: { x: 0, z: -400, radiusX: 1, radiusZ: 1, level: -50 }, hills: [], waters: mill.land.bodies.map(b => ({ ...b })), streams: mill.land.streams.map(s => ({ ...s, points: s.points })),
    };
    reaches = deriveWaterReaches(landform);
    contacts = mill.land.contacts.map(c => ({ a: [c.a[0], c.a[1]], ...(c.b ? { b: [c.b[0], c.b[1]] as const } : {}), radius: c.radius, strength: c.strength }));
    for (const p of mill.placements) statics.push({
      id: p.id, blueprint: p.piece.blueprint, origin: p.origin, yaw: p.mounted ? p.mounted.yaw : (p.turn * Math.PI) / 2, ...(p.mounted ? { pivot: p.mounted.pivot } : {}),
    });
    // The bridge's four newel lanterns answer through the shared people-light helper to SIMULATED people on its deck.
    const bridge = mill.placements.find(p => p.id === 'bridge')!;
    const at = (cells: Vec3): Vec3 => [bridge.origin[0] + cells[0] * CELL, bridge.origin[1] + cells[1] * CELL, bridge.origin[2] + cells[2] * CELL];
    const [bx, , bz] = bridge.piece.blueprint.size;
    // Square on to the arch from downstream at a citizen's eye over the pool, so the arch and its reflection can close.
    const axis = at([bx / 2, 0, bz / 2]);
    poses = {
      wide: { eye: [axis[0] + 0.4, 1.35, 29.4], target: [axis[0], 2.5, axis[2]], fov: 46 },
      tall: { eye: [axis[0] + 0.3, 1.35, 29.4], target: [axis[0], 3.4, axis[2]], fov: 64 },
    };
    // SIMULATED people stand at the deck ends beside the newel lanterns, alternating ends.
    const ends = [...bridge.piece.emitters].sort((a, b) => a.position[0] - b.position[0]);
    const order = [0, ends.length - 1, 1, ends.length - 2].filter(i => i >= 0 && i < ends.length);
    const deck: Vec3[] = Array.from({ length: people }, (_, i) => {
      const lamp = at(ends[order[i % order.length]!]!.position);
      return [lamp[0] + (lamp[0] < axis[0] ? 1.2 : -1.2), lamp[1] - 1.6, axis[2]];
    });
    const texture = glowTexture();
    const lamps = bridge.piece.emitters.map(emitter => {
      const position = at(emitter.position);
      const light = createPeopleLight({ position, reach: emitter.reach * CELL, pilot: 0.12, full: 1, capacity: 2, rise: 0.6, fade: 0.7 });
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.position.set(...position); glow.userData.at = new THREE.Vector3(...position); glow.renderOrder = 6; scene.add(glow); glows.push(glow);
      return { light, glow };
    });
    lights = (seconds, hourNow) => {
      const night = getEnvironment(hourNow).night;
      return lamps.map(({ light, glow }) => {
        const strength = light.update(seconds, deck) * THREE.MathUtils.smoothstep(night, 0.1, 0.5);
        const source = light.source();
        glow.scale.setScalar(0.35 + 1.1 * strength); (glow.material as THREE.SpriteMaterial).opacity = Math.min(1, strength * 1.2);
        glow.visible = strength > 0.01;
        return { position: source.position, strength, kind: 'lamp' as const };
      });
    };
  }
  seal.textContent = `${label} · water ${quality === 'full' ? 'full: planar reflection' : 'reduced: analytic pillars'}`;

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
    scene.add(model); model.updateMatrixWorld(true); sunShadows.register(model);
  });
  tasks.push(meshGround(pool, ground, groundMade, (x, z, h) => water.waterAt(x, z) !== null || bodies.some(b => Math.hypot((x - b.x) / b.radiusX, (z - b.z) / b.radiusZ) < 1 && h < b.level + 0.05)).then(land => {
    scene.add(land); land.updateMatrixWorld(true); sunShadows.register(land);
  }));

  let pose = poses.wide;
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
    pose = poses[canvas.clientWidth >= canvas.clientHeight ? 'wide' : 'tall'];
  }
  new ResizeObserver(resize).observe(canvas); resize();

  let loaded = false, drawn = 0, frameNo = 0;
  const stats: Record<string, unknown> = { ready: false, view, label };
  void Promise.all(tasks).then(() => { loaded = true; }, fail);
  const target = new THREE.Vector3(), beacon = new THREE.Vector3(), nowhere = new THREE.Vector3(0, -1000, 0);
  function render() {
    try {
      const grade = getEnvironment(hour); clay.setEnvironment(grade); groundMade.state.setEnvironment(grade);
      renderer.toneMappingExposure = grade.exposure;
      camera.position.set(...pose.eye); target.set(...pose.target);
      if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      camera.lookAt(target); camera.updateMatrixWorld();
      // Each glow sits just outside its lantern's glass toward the eye, so the lantern body does not hide it.
      for (const glow of glows) glow.position.copy(glow.userData.at as THREE.Vector3).add(target.copy(camera.position).sub(glow.userData.at as THREE.Vector3).setLength(0.3));
      target.set(...pose.target);
      atmosphere.update(hour, time, camera, beaconAt ? beacon.set(...beaconAt) : nowhere, beaconStrength);
      fog.color.set(grade.fog); fog.density = grade.fogDensity;
      if (loaded) sunShadows.updateSunDirection(grade.sunDirection);
      // Host order: water update, the one explicit reflection pass, then the normal render.
      water.update({ time, environment: grade, camera, sources: lights(time, hour) });
      const reflection = water.reflect({ renderer, scene, camera, frame: ++frameNo, exclusions: [...atmosphereObjects, ...glows] });
      renderer.render(scene, camera);
      Object.assign(stats, {
        hour, time, quality: water.diagnostics().quality, reflection, water: water.diagnostics(),
        main: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        memory: { ...renderer.info.memory }, programs: renderer.info.programs?.length ?? null,
      });
      if (loaded && ++drawn === 2) { renderer.getContext().finish(); stats.ready = true; (window as BenchWindow).__chatdomReady = true; }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(render);
  (window as BenchWindow).__chatdomWater = {
    view, stats,
    hour: value => { hour = parseHour(String(value)); },
    time: value => { time = parseTime(String(value)); },
    quality: value => { const next = parseQuality(value); water.setQuality(next); seal.textContent = `${label} · water ${next === 'full' ? 'full: planar reflection' : 'reduced: analytic pillars'}`; },
  };
} catch (error) { fail(error); }
