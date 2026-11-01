// The place bench: the production kingdom renderer (terrain, horizon, clay, light fields, window presence, sun
// shadows, fog) on the actual founded land and opened castle, with this lane's court laid by its real factory.
// The town on that land is the kingdom-land SIMULATED fixture and its lit windows a SIMULATED evening. Served by the
// Vite dev server only (capture.mjs); the shipped app never loads it.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { KingdomPresenceFrameSchema, type KingdomPresenceFrame, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { terrainHeight, type KingdomGeography, type SettlementPlan } from '@chatdom/world';
import { beaconStrength } from '../../kingdom/beacon';
import { createCastleContent } from '../../kingdom/castle-content';
import { createHorizonSurface } from '../../kingdom/horizon';
import { inhabitedLightBounds } from '../../kingdom/light-bounds';
import { createLightField } from '../../kingdom/light-field';
import { createSimulatedPresence } from '../../kingdom/presence-feed';
import { placeMarketContent, placeSettlementContent } from '../../kingdom/settlement-content';
import { terrainBatches } from '../../kingdom/terrain-batches';
import { loadTerrain } from '../../kingdom/terrain-client';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../../kingdom/terrain-worker';
import { geographyFixture } from '../../kingdom-land/geography-fixture';
// Relative source import until the integrator registers the collection's package export (spec 30, Contracts).
import { createCastleCourtPlace, type CastleCourtPlace } from '../../../../../packages/content/src/places-high/index';
import { BUILT_VIEWS, benchQuery, parseBench, type BenchState, type View } from './params';

/** The castle's kit in every founded kingdom today (apps/realm founded/native.ts). */
const CASTLE_STYLE = 'tide';
const SEED = 'chatdom';
/** Owners whose actual pieces this bench is still waiting for. Shown in the seal and the report. */
const MISSING = [
  'keep stair envelope + small banner removal (kingdom-light, H-M2)',
  'castle standards and drops (places-high PH03)',
  'parapets replacing the front curtain caps (places-high PH02)',
  'pear espaliers (ground-dressing, H-M3)',
];

export interface PlaceBenchReport extends BenchState {
  width: number; height: number;
  triangles: number; draws: number;
  pieces: string[]; missing: string[];
  camera: { eye: Vec3; target: Vec3; fov: number };
  meshMs: number; terrainMs: number;
}
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomPlaces?: PlaceBenchReport; __chatdomPlacesError?: string };
const bench = window as BenchWindow;

const TITLES: Record<View, string> = {
  'court-arrive': 'Through the gate: arriving in the court', 'court-town': 'The castle from the town',
  'court-lean': 'Leaning on the parapet', 'hill-far': 'Lookout Hill from the town', 'hill-summit': 'On Lookout Hill',
  'hill-telescope': 'Through the telescope', 'forest-meadow': 'The forest edge from the meadow', 'forest-oak': 'Under the elder oak',
  'forest-gap': 'The gap toward the beacon',
};
const element = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The bench page is missing #${id}.`);
  return found as T;
};

/** Camera frames from the actual land: the gate, the keep door and the court's own placements. */
function frame(view: View, land: KingdomGeography, court: CastleCourtPlace, portrait: boolean): { eye: Vec3; target: Vec3; fov: number } {
  const { gate, keepDoor, elevation } = land.places.court;
  if (view === 'court-arrive') {
    // Just inside, by the west front tower: the well close by, the worn way and the keep stair ahead, the crest
    // across the court. Shoulder height, as a citizen's camera follows them in.
    return portrait
      ? { eye: [court.bounds.minX + 3, elevation + 2.4, gate[2] - 10.8], target: [keepDoor[0] - 4, elevation + 3.5, court.bounds.minZ - 4], fov: 74 }
      : { eye: [court.bounds.minX + 3, elevation + 2.6, gate[2] - 10.5], target: [keepDoor[0] - 2, elevation + 3.5, court.bounds.minZ - 2], fov: 58 };
  }
  // Above the town's roofs below the rise: homes along the lower edge, the castle crowning its hill.
  return portrait
    ? { eye: [10, 21, gate[2] + 80], target: [-2, elevation + 7, keepDoor[2] + 12], fov: 50 }
    : { eye: [46, 21, gate[2] + 86], target: [-3, elevation + 5, keepDoor[2] + 12], fov: 38 };
}

function renderNav(state: BenchState) {
  const nav = element<HTMLElement>('nav');
  const link = (label: string, next: Partial<BenchState>, current: boolean) => {
    const a = document.createElement('a');
    a.href = `?${benchQuery({ ...state, ...next })}`;
    a.textContent = label;
    if (current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  };
  for (const view of BUILT_VIEWS) link(view, { view, place: 'court' }, view === state.view);
  for (const [label, hour] of [['noon', 12], ['dusk', 18.5], ['night', 22]] as const) link(label, { hour }, state.hour === hour);
  link(state.occupied ? 'empty town' : 'neighbours home', { occupied: !state.occupied }, false);
}

async function main(): Promise<void> {
  bench.__chatdomReady = false;
  const state = parseBench(location.search);
  renderNav(state);
  element('title').textContent = TITLES[state.view];
  element('caption').textContent = `Founded land, court and castle: actual · town homes and ${state.occupied ? 'lit windows' : 'dark windows'}: SIMULATED · ${String(Math.floor(state.hour)).padStart(2, '0')}:${String(Math.round(state.hour % 1 * 60)).padStart(2, '0')}`;
  element('missing').textContent = `Waiting for: ${MISSING.join(' · ')}`;
  const status = (text: string) => { element('status').querySelector('p')!.textContent = text; };

  // The kingdom-land geography fixture: actual founded land and castle, today's homes re-seated on it.
  const { plan: founded, land } = geographyFixture(SEED, state.tier);
  // One terrain request around the castle rise and the streets below it; the horizon carries the rest.
  const plan: SettlementPlan = { ...founded, bounds: { minX: -136, maxX: 136, minZ: -136, maxZ: 136 } };
  const court = createCastleCourtPlace(land.places.court, CASTLE_STYLE);
  const height = (x: number, z: number) => terrainHeight(plan, x, z);

  const canvas = element<HTMLCanvasElement>('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Place bench shader failed', gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment), gl.getProgramInfoLog(program));
    throw new Error('A place bench shader could not compile.');
  };
  // The kingdom's own output: ACES, sRGB, the same exposure. One pixel ratio so shots compare run to run.
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, .15, 2200);
  const atmosphere = createAtmosphere(scene), grade = getEnvironment(state.hour);
  const fog = new THREE.FogExp2(new THREE.Color(grade.fog).getHex(), .0016); scene.fog = fog;
  const clay = createVoxelMaterial(MATERIALS, 'build'), ground = createVoxelMaterial(MATERIALS, 'terrain');
  // The terrain shares the build material's light volumes, exactly as the kingdom scene binds them.
  for (const key of ['uLight', 'uLightOrigin', 'uLightExtent', 'uFarLight', 'uFarOrigin', 'uFarExtent', 'uFarCell', 'uBeaconLight', 'uBeaconOrigin', 'uBeaconExtent', 'uBeaconCell']) ground.material.uniforms[key] = clay.material.uniforms[key]!;
  const origin: [number, number] = [Math.floor(plan.bounds.minX) - 20, Math.floor(plan.bounds.minZ) - 20];
  const width = Math.ceil(plan.bounds.maxX - origin[0]) + 21, depth = Math.ceil(plan.bounds.maxZ - origin[1]) + 21;
  const heights = new Float32Array(width * depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) heights[x + z * width] = height(origin[0] + x, origin[1] + z);
  ground.setTerrainHeight(heights, width, depth, origin, 1);
  const lake = plan.lake;
  ground.setShoreLevel(lake.level, [lake.x - lake.radiusX * 1.3, lake.x + lake.radiusX * 1.3, lake.z - lake.radiusZ * 1.3, lake.z + lake.radiusZ * 1.3]);
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-110, -4, -120), new THREE.Vector3(110, 60, 110)), resolution: 2048 });
  shadows.bindReceiver(clay.material); shadows.bindReceiver(ground.material);
  const { geometry: horizonGeometry } = createHorizonSurface(plan, { farStep: 20, sampleTerrain: height });
  const horizonMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: ground.material.uniforms, fragmentShader: ground.material.fragmentShader,
    vertexShader: 'out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}' });
  scene.add(new THREE.Mesh(horizonGeometry, horizonMaterial)); shadows.bindReceiver(horizonMaterial);

  // Homes, market, the castle's stock modules and the court, each blueprint one instanced draw.
  const { houses, props } = placeSettlementContent(plan.homes, height);
  props.push(...placeMarketContent(plan.market));
  const { buildings: castle, beaconPosition } = createCastleContent(plan.castle, CASTLE_STYLE);
  const courtPieces = court.placements.map(p => ({ blueprint: p.blueprint, position: p.position, yaw: p.turn * Math.PI / 2, casts: p.blocker }));
  const placed = [...houses.map(h => ({ ...h, casts: true })), ...castle.map(c => ({ ...c, casts: true })), ...props.map(p => ({ ...p, casts: true })), ...courtPieces];
  const groups = new Map<VoxelBlueprint, typeof placed>();
  for (const item of placed) { const list = groups.get(item.blueprint); if (list) list.push(item); else groups.set(item.blueprint, [item]); }
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 1024 });
  const geometries: THREE.BufferGeometry[] = [];
  let done = 0;
  const started = performance.now();
  let meshMs = 0, terrainMs = 0;
  const meshes = Promise.all([...groups].map(async ([blueprint, placements]) => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`Could not mesh ${blueprint.id}.`);
    const geometry = geometryFromChunks(result.chunks, 'build');
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1), 1));
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, clay.material, placements.length);
    const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    placements.forEach((item, i) => mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(...item.position), turn.setFromAxisAngle(up, item.yaw), one)));
    mesh.frustumCulled = false; mesh.name = blueprint.id; scene.add(mesh);
    if (placements[0]!.casts) shadows.register(mesh);
    status(`Laying ${++done} of ${groups.size}`);
  })).then(() => { meshMs = Math.round(performance.now() - started); });
  const terrain = loadTerrain(plan, undefined, { timeoutMs: 600_000 }).then(({ chunks, origin: at }) => {
    for (const tile of terrainBatches(chunks)) {
      const geometry = geometryFromChunks(tile, 'terrain');
      geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);
      geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, ground.material); mesh.position.set(...at); scene.add(mesh); shadows.register(mesh);
    }
    terrainMs = Math.round(performance.now() - started);
  });

  // Presence: a SIMULATED evening, or the same town with every window dark.
  const windows = createWindowLights(scene, houses);
  let presence: KingdomPresenceFrame | undefined;
  if (state.occupied) {
    const simulation = createSimulatedPresence(plan);
    simulation.feed.subscribe(next => { presence = next; windows.setFrame(next); }, () => {});
    simulation.advance(state.time);
  } else {
    presence = KingdomPresenceFrameSchema.parse({ version: 1, kingdomId: '1', epoch: 'place-bench', sequence: 1, asOf: 1000, origin: 'simulated',
      streamLive: false, connection: 'fresh', windows: houses.map(h => ({ slot: h.slot, present: false, publicName: null, since: 0 })) });
    windows.setFrame(presence);
  }
  // The castle, homes and court pieces shade the near field; flat floors never block it.
  const blockers = [...houses, ...castle];
  const nearBlockers = [...blockers, ...props.map(p => ({ ...p, slot: 65534 })), ...courtPieces.filter(p => p.casts).map(p => ({ ...p, slot: 65534 }))];
  let nearBytes = 0, farBytes = 0, beaconBytes = 0;
  const failField = (what: string) => () => fail(new Error(`The ${what} light field failed.`));
  const field = createLightField(plan, nearBlockers, volume => { clay.setLight(volume); nearBytes = volume.estimatedPeakBytes; }, failField('near'));
  const farField = createLightField(plan, blockers, volume => { clay.setFarLight(volume); farBytes = volume.estimatedPeakBytes; }, failField('far'), { mode: 'kingdom', bounds: inhabitedLightBounds(plan.homes) });
  const beaconField = createLightField(plan, blockers, volume => { clay.setBeaconLight(volume); beaconBytes = volume.estimatedPeakBytes; }, failField('beacon'), { mode: 'beacon', position: beaconPosition });

  const pose = () => frame(state.view, land, court, canvas.clientWidth < canvas.clientHeight);
  const aim = () => {
    const width = canvas.clientWidth, heightPx = canvas.clientHeight, view = pose();
    renderer.setSize(width, heightPx, false);
    camera.aspect = width / heightPx; camera.fov = view.fov; camera.updateProjectionMatrix();
    camera.position.set(...view.eye); camera.lookAt(new THREE.Vector3(...view.target)); camera.updateMatrixWorld();
    return view;
  };
  let view = aim();
  clay.setEnvironment(grade); ground.setEnvironment(grade);
  windows.update(state.time, state.hour);
  const beacon = beaconStrength(presence, houses.length);
  const sources = () => windows.getSources();
  const centre: Vec3 = [view.target[0], height(view.target[0], view.target[2]), view.target[2]];
  field.update(centre, sources()); farField.update(centre, sources());
  beaconField.update(beaconPosition, [{ position: beaconPosition, strength: beacon, normal: [0, 1, 0] }]);

  // Required work: every mesh, the terrain and a first published volume from each light field.
  await Promise.all([meshes, terrain]);
  status('Waiting for the evening light');
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (bench.__chatdomPlacesError) { reject(new Error(bench.__chatdomPlacesError)); return; }
      if (nearBytes > 0 && farBytes > 0 && beaconBytes > 0) resolve(); else setTimeout(check, 50);
    };
    check();
  });
  pool.dispose();

  const draw = () => {
    view = aim();
    atmosphere.update(state.hour, state.time, camera, new THREE.Vector3(...beaconPosition), beacon);
    shadows.updateSunDirection(grade.sunDirection);
    renderer.render(scene, camera);
    renderer.getContext().finish();
    let triangles = 0;
    scene.traverse(object => { if (object instanceof THREE.Mesh && object.visible) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1); });
    bench.__chatdomPlaces = { ...state, width: canvas.clientWidth, height: canvas.clientHeight, triangles: Math.round(triangles), draws: renderer.info.render.calls,
      pieces: court.placements.map(p => p.id), missing: MISSING, camera: view, meshMs, terrainMs };
  };
  await renderer.compileAsync(scene, camera);
  draw();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  draw();
  window.addEventListener('resize', () => { bench.__chatdomReady = false; draw(); bench.__chatdomReady = true; });
  window.addEventListener('pagehide', () => {
    field.dispose(); farField.dispose(); beaconField.dispose(); windows.dispose(); shadows.dispose(); atmosphere.dispose();
    geometries.forEach(g => g.dispose()); horizonGeometry.dispose(); horizonMaterial.dispose(); clay.dispose(); ground.dispose(); renderer.dispose();
  }, { once: true });
  element('status').hidden = true;
  bench.__chatdomReady = true;
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (bench.__chatdomPlacesError) return;
  bench.__chatdomPlacesError = message;
  const status = document.getElementById('status');
  if (status) {
    status.hidden = false; status.setAttribute('role', 'alert');
    status.innerHTML = '<strong>The court could not be shown</strong><p></p>';
    status.querySelector('p')!.textContent = message;
  }
  console.error(message);
}

main().catch(fail);
