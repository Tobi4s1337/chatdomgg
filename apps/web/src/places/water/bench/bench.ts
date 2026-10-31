// The water-place review page: the lake place (pier, boathouse, moored and upturned boats) on SIMULATED fixture
// land below the fixture town, over the lane's own water surface and life, drawn with the production voxel mesher,
// clay, avatar and terrain materials, atmosphere, window lights, the shared people-light helper and sun shadows.
// Every site, person and presence here is SIMULATED. Served by the Vite dev server only (../capture.mjs); the shipped
// app never loads it.
import * as THREE from 'three';
import { MATERIALS, STYLES, type StyleKey } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { KingdomPresenceFrame, Vec3, VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createPeopleLight } from '../../../kingdom/lights/people-light';
import type { PeopleLight } from '../../../kingdom/lights/types';
import { BOATHOUSE, createBoathouse } from '../../../../../../packages/content/src/places/water/boathouse/index';
import { ROWING_BOAT, createRowingBoat, createUpturnedBoat } from '../../../../../../packages/content/src/places/water/boats/index';
import { createPier } from '../../../../../../packages/content/src/places/water/pier/index';
import type { WaterPiece } from '../../../../../../packages/content/src/places/water/place-piece';
import { CELL, placePieceAnchors, toWorld, type CardinalFrame, type PlacedEmitter, type PlacedWalk } from '../../../../../../packages/world/src/places/water/index';
import { boathousePlacement, pierPlacements, pierSite, type PiecePlacement } from '../land/sites';
import { createWaterLife, placeLampLight, type BoatMount, type WaterLife } from '../life/index';
import { groundMaterial, meshGround } from '../surface-bench/ground';
import { createWaterSurface, type WaterContact, type WaterLightSource, type WaterQuality } from '../surface/index';
import { placeFixture, type PlaceView } from './fixture';

type Pose = { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
interface BenchApi {
  readonly view: PlaceView;
  hour(value: number): void;
  time(value: number): void;
  quality(value: string): void;
  frameHash(): Promise<string>;
  readonly stats: Record<string, unknown>;
}
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomPlace?: BenchApi };

const VIEWS: readonly PlaceView[] = ['lake-postcard', 'pier-deck'];
const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas')!;
const seal = document.querySelector('[data-seal]')!;
const fail = (error: unknown) => {
  console.error('Water place bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
  seal.textContent = `The water place bench could not draw: ${document.body.dataset.error}`;
};
const number = (name: string, fallback: number, ok: (v: number) => boolean, rule: string) => {
  const raw = query.get(name), value = raw === null ? fallback : Number(raw);
  if (raw === '' || !Number.isFinite(value) || !ok(value)) throw new Error(`${name} must be ${rule}, not "${raw}".`);
  return value;
};
const choice = <T extends string>(name: string, fallback: T, allowed: readonly T[]): T => {
  const value = query.get(name) ?? fallback;
  if (!allowed.includes(value as T)) throw new Error(`${name} must be one of ${allowed.join(', ')}, not "${value}".`);
  return value as T;
};
const validHour = (h: number) => h >= 0 && h < 24, validTime = (t: number) => t >= 0;

try {
  const view = choice('view', 'lake-postcard', VIEWS);
  let hour = number('hour', 19.5, validHour, 'an hour in [0, 24)'), time = number('time', 30, validTime, 'non-negative seconds');
  const seed = number('seed', 29, Number.isSafeInteger, 'a whole number');
  const quality: WaterQuality = choice('quality', 'full', ['full', 'reduced'] as const);
  const style = choice('style', 'tide', Object.keys(STYLES) as StyleKey[]);
  const people = number('people', 2, v => Number.isInteger(v) && v >= 0 && v <= 6, 'a whole number from 0 to 6');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
  const atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build'), fur = createVoxelMaterial(MATERIALS, 'avatar');
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 512 });
  const meshes = new Map<string, Promise<THREE.BufferGeometry>>();
  const mesherCost: Record<string, { triangles: number; boxes: number }> = {};
  const meshBlueprint = (blueprint: VoxelBlueprint) => {
    let pending = meshes.get(blueprint.id);
    if (!pending) {
      pending = pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision }).then(result => {
        if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${blueprint.id}`);
        const geometry = geometryFromChunks(result.chunks, 'build');
        mesherCost[blueprint.id] = { triangles: (geometry.index?.count ?? 0) / 3, boxes: blueprint.boxes.length };
        return geometry;
      });
      meshes.set(blueprint.id, pending);
    }
    return pending;
  };

  // ── The SIMULATED lake place, its pieces built on the fixture's plans through the production adapters. ──────────
  const place = placeFixture();
  const { lake, ground } = place;
  const pier = createPier(style, pierSite(place.pier, seed));
  const statics: PiecePlacement[] = [...pierPlacements(place.pier, pier)];
  const boathouse = boathousePlacement(place.boathouse, (site) => createBoathouse('tide', site));
  statics.push(boathouse);
  const upturned = createUpturnedBoat(style, 2);
  statics.push({ id: upturned.blueprint.id, piece: upturned, frame: place.upturned });

  const walks: PlacedWalk[] = [], lamps: PlacedEmitter[] = [], contacts: WaterContact[] = [];
  for (const p of statics) {
    const anchors = placePieceAnchors(p.frame, p.piece);
    walks.push(...anchors.walks); lamps.push(...anchors.emitters);
  }
  // Every pile standing in the lake rings the water a little; the lake's level is the pier's datum.
  for (const pile of pier.piles) {
    const at = toWorld(place.pier.frame, [place.pier.walk.x[0] + pile[0] * CELL, 0, pile[2] * CELL]);
    if (contacts.length < 40) contacts.push({ a: [at[0], at[2]], radius: 0.14, strength: 0.35 });
  }
  const head = statics.find(p => p.id.startsWith('water-pier-head'))!, headAnchors = placePieceAnchors(head.frame, head.piece);

  // Two faded rowing boats moored to the head's wing-end rings, lying along the wing faces, bows out over the lake.
  const boats: { piece: WaterPiece; matrix: THREE.Matrix4; tether: Vec3 }[] = [];
  const level = lake.body.level;
  for (const [i, side] of (['west', 'east'] as const).entries()) {
    const ring = headAnchors.mounts.find(m => m.id === `mooring-${side}`)!;
    const piece = createRowingBoat(style, i as 0 | 1), painter = piece.mounts.find(m => m.id === 'painter')!;
    // The wing face lies 2.75 m west / 5.25 m east of the walk's west edge; the hull floats a hand's width off it.
    const beam = ROWING_BOAT.beam * CELL, offX = side === 'west' ? -2.75 - beam / 2 - 0.25 : 5.25 + beam / 2 + 0.25;
    const bow = toWorld(place.pier.frame, [offX, 0, 25.4 + (side === 'east' ? 0.5 : 0)]);
    const yaw = place.pier.frame.turn * Math.PI / 2 + (side === 'west' ? 0.05 : -0.08);
    const matrix = new THREE.Matrix4().makeTranslation(bow[0], level - ROWING_BOAT.draft * CELL, bow[2])
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeTranslation(-painter.position[0] * CELL, 0, -painter.position[2] * CELL));
    boats.push({ piece, matrix, tether: ring.pivot });
  }

  seal.textContent = `${place.label} · ${people ? `${people} SIMULATED ${people === 1 ? 'person' : 'people'} at the pier head` : 'nobody on the pier'} · water ${quality}`;

  const groundMade = groundMaterial(lake.ground, level);
  const shadowBounds = lake.shadowBounds;
  const sunShadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...shadowBounds.min), new THREE.Vector3(...shadowBounds.max)), resolution: 2048 });
  sunShadows.bindReceiver(clay.material); sunShadows.bindReceiver(groundMade.state.material);
  const water = createWaterSurface({ bodies: [lake.body], reaches: [], ground, contacts, quality });
  scene.add(water.root);

  const tasks: Promise<unknown>[] = [];
  const addMesh = async (blueprint: VoxelBlueprint, place: (mesh: THREE.Mesh) => void) => {
    const mesh = new THREE.Mesh(await meshBlueprint(blueprint), clay.material);
    mesh.name = blueprint.id; place(mesh); scene.add(mesh); mesh.updateMatrixWorld(true); sunShadows.register(mesh);
    return mesh;
  };
  const framed = (frame: CardinalFrame) => (mesh: THREE.Mesh) => { mesh.position.set(...frame.origin); mesh.rotation.y = frame.turn * Math.PI / 2; mesh.updateMatrix(); };
  for (const p of lake.placements) if (place.keep(p.id)) tasks.push(addMesh(p.blueprint, mesh => { mesh.position.set(...p.origin); mesh.updateMatrix(); }));
  for (const p of statics) tasks.push(addMesh(p.piece.blueprint, framed(p.frame)));
  const boatMounts: Promise<BoatMount>[] = boats.map(boat => addMesh(boat.piece.blueprint, mesh => {
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(boat.matrix);
  }).then(object => ({ object, tether: boat.tether })));
  tasks.push(meshGround(pool, lake.ground, groundMade, (x, z, h) => water.waterAt(x, z) !== null || (Math.hypot((x - lake.body.x) / lake.body.radiusX, (z - lake.body.z) / lake.body.radiusZ) < 1 && h < level + 0.05)).then(land => {
    scene.add(land); land.updateMatrixWorld(true); sunShadows.register(land);
  }));

  // The town's SIMULATED evening: homes lit where their people are in, the beacon answering how many are.
  const houses = lake.placements.filter(p => p.slot !== undefined).map(p => ({ slot: p.slot!, blueprint: p.blueprint, position: p.origin, yaw: 0 }));
  const windows = createWindowLights(scene, houses);
  const asOf = Date.UTC(2026, 9, 31, 19, 30);
  windows.setFrame({
    version: 1, kingdomId: 'kingdom_simulated_place_bench', epoch: 'sim:place-bench', sequence: 1, asOf, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: lake.homes.map(home => ({ slot: home.slot, present: home.present, publicName: null, since: asOf - 60_000 })),
  } as KingdomPresenceFrame);
  const beaconStrength = 0.18 + 0.82 * Math.pow(lake.homes.filter(h => h.present).length / lake.homes.length, 2.4);
  const windowSources = (hourNow: number): WaterLightSource[] => {
    windows.update(0, hourNow);
    const night = getEnvironment(hourNow).night;
    return [...windows.getSources().map(s => ({ position: s.position, strength: s.strength, kind: 'window' as const, normal: s.normal })),
      { position: [lake.beacon[0], lake.beacon[1] + 1.2, lake.beacon[2]], strength: beaconStrength * THREE.MathUtils.lerp(0.3, 1, THREE.MathUtils.smoothstep(night, 0.05, 0.26)), kind: 'beacon' }];
  };

  // SIMULATED people at the pier head, by the seat edge; the head lantern answers only through the shared helper.
  const seat = headAnchors.seats[0]!;
  const crowd: Vec3[] = Array.from({ length: people }, (_, i) => {
    const t = (i + 0.5) / Math.max(1, people);
    return [THREE.MathUtils.lerp(seat.min[0], seat.max[0], t), seat.min[1], THREE.MathUtils.lerp(seat.min[2], seat.max[2], t) + (place.pier.frame.turn === 2 ? 0.6 : -0.6)];
  });
  const lampLights = new Map<string, PeopleLight>(lamps.map(l => [l.id, createPeopleLight(placeLampLight(l))]));
  const strengths = new Map<string, number>();
  const reeds: Vec3[] = lake.placements.filter(p => p.id.startsWith('reeds') && place.keep(p.id))
    .map(p => [p.origin[0] + (p.blueprint.size[0] * CELL) / 2, p.origin[1] + 0.05, p.origin[2] + (p.blueprint.size[2] * CELL) / 2]);

  let life: WaterLife | null = null;
  const lifeReady = Promise.all(tasks).then(async () => {
    life = createWaterLife({
      seed, reeds, lamps, boats: await Promise.all(boatMounts),
      habitat: { waterAt: water.waterAt, bodies: [lake.body], reaches: [], obstacles: contacts, walks },
      critters: { material: fur.material, pool, registry: MATERIALS },
    });
    scene.add(life.root);
    await life.ready;
  });

  let pose: Pose = place.views[view].wide;
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
    pose = place.views[view][canvas.clientWidth >= canvas.clientHeight ? 'wide' : 'tall'];
  }
  new ResizeObserver(resize).observe(canvas); resize();

  let loaded = false, drawn = 0, frameNo = 0;
  const stats: Record<string, unknown> = { ready: false, view, label: place.label };
  void lifeReady.then(() => { loaded = true; }, fail);
  const target = new THREE.Vector3(), beacon = new THREE.Vector3(...lake.beacon);
  function draw() {
    const grade = getEnvironment(hour); clay.setEnvironment(grade); fur.setEnvironment(grade); groundMade.state.setEnvironment(grade);
    renderer.toneMappingExposure = grade.exposure;
    camera.position.set(...pose.eye); target.set(...pose.target);
    if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
    camera.lookAt(target); camera.updateMatrixWorld();
    atmosphere.update(hour, time, camera, beacon, beaconStrength);
    fog.color.set(grade.fog); fog.density = grade.fogDensity;
    if (loaded) sunShadows.updateSunDirection(grade.sunDirection);
    // The host's people-light results for the place's lamps, on a dusk curve.
    const lit = THREE.MathUtils.smoothstep(grade.night, 0.1, 0.5);
    for (const [id, light] of lampLights) strengths.set(id, light.update(time, crowd) * lit);
    // Host order: life, then water with the life's light, then the one reflection pass, then the normal render.
    life?.update({ time, hour, environment: grade, camera, lamps: strengths, floaters: [] });
    water.update({ time, environment: grade, camera, sources: [...windowSources(hour), ...(life?.sources() ?? [])] });
    const reflection = water.reflect({ renderer, scene, camera, frame: ++frameNo, exclusions: [...atmosphere.reflectionExclusions, ...(life?.exclusions ?? [])] });
    renderer.render(scene, camera);
    Object.assign(stats, {
      hour, time, reflection, water: water.diagnostics(), life: life?.diagnostics() ?? null, lamps: Object.fromEntries(strengths),
      main: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }, mesher: mesherCost,
      modules: pier.modules.length, bayDepths: place.pier.headDepth, boathouseBay: BOATHOUSE.bay,
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
  (window as BenchWindow).__chatdomPlace = {
    view, stats,
    hour: value => { if (!validHour(value)) throw new Error('hour must lie in [0, 24)'); hour = value; },
    time: value => { if (!(Number.isFinite(value) && validTime(value))) throw new Error('time must be non-negative seconds'); time = value; },
    quality: value => { if (value !== 'full' && value !== 'reduced') throw new Error('quality must be full or reduced'); water.setQuality(value); },
    async frameHash() {
      draw(); renderer.getContext().finish();
      const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    },
  };
} catch (error) { fail(error); }
