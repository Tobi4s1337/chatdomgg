import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { EXPLORE_PACE_MPS, foundKingdomRoutes, samplePublicGround, terrainHeight, waterKeepOut, type KingdomGeography, type KingdomRoutes,
  type LandPath, type SettlementPlan, type StreetEdge } from '@chatdom/world';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createCastleContent } from '../kingdom/castle-content';
import { createHorizonSurface } from '../kingdom/horizon';
import { placeMarketContent, placeSettlementContent } from '../kingdom/settlement-content';
import { loadTerrain } from '../kingdom/terrain-client';
import { terrainBatches } from '../kingdom/terrain-batches';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../kingdom/terrain-worker';
import { placeLandContent } from './dressing';
import { geographyFixture } from './geography-fixture';
import { createWaterPreview } from './water-preview';

/**
 * Kingdom walks bench: the founded trails, the bridge crossing and Crown Road laid into a SIMULATED town fixture,
 * seen from where a walk reveals its destination. Trail earth is a bench preview until the terrain paints
 * trails itself; benches and fingerposts are held for their civic models and not drawn.
 *   /src/kingdom-land/routes-bench.html?view=lake-reveal|summit&hour=17.25&seed=chatdom
 */
type View = { eye: Vec3; target: Vec3; fov: number; caption: string; walk: string; at: number };
type Edges = ReadonlyMap<string, StreetEdge>;

/** A walk's line every metre, in the direction of travel. */
function walkLine(path: LandPath, edges: Edges): Vec3[] {
  const line: Vec3[] = [];
  let at = path.from;
  for (const id of path.edgeIds) {
    const edge = edges.get(id)!, points = edge.from === at ? edge.points : [...edge.points].reverse();
    at = edge.from === at ? edge.to : edge.from;
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1]!, b = points[k]!, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2])));
      for (let j = line.length ? 1 : 0; j <= n; j++) line.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, a[2] + (b[2] - a[2]) * j / n]);
    }
  }
  return line;
}
const pointAt = (line: readonly Vec3[], metres: number): Vec3 => {
  let run = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!, b = line[k]!, step = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (run + step >= metres) { const t = step ? (metres - run) / step : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    run += step;
  }
  return line.at(-1)!;
};

const views: Record<string, (land: KingdomGeography, routes: KingdomRoutes, edges: Edges) => View> = {
  // The first sight of the lake on the walk to the pier: a walker a few steps on, clear of the bridge's end posts,
  // with the crossing behind them and the water opening beyond.
  'lake-reveal': (land, routes, edges) => {
    const walk = routes.paths.find(path => path.id === 'walk:pier')!, beat = walk.beats.find(item => item.reveal === 'lake-reveal')!;
    const line = walkLine(walk, edges), lake = land.landform.lake, deck = land.sites.find(site => site.id === 'water:bridge')!.footprint;
    const xs = deck.map(p => p[0]), zs = deck.map(p => p[1]);
    const offDeck = (p: Vec3) => Math.hypot(Math.max(Math.min(...xs) - p[0], 0, p[0] - Math.max(...xs)), Math.max(Math.min(...zs) - p[2], 0, p[2] - Math.max(...zs)));
    let at = beat.at;
    while (at < beat.at + 20 && offDeck(pointAt(line, at)) < 9) at += .5;
    const foot = pointAt(line, at);
    return { eye: [foot[0], foot[1] + 1.65, foot[2]], target: [lake.x, lake.level + 1, lake.z], fov: 58,
      caption: `The lake shows itself · ${Math.round(beat.at)} m along the walk from the market to the pier`, walk: walk.id, at };
  },
  // At the plateau's edge above the view: the lake below, the town and its castle beyond.
  summit: (land, routes) => {
    const walk = routes.paths.find(path => path.id === 'walk:lookout')!, summit = land.places.lookout.summit, lake = land.landform.lake;
    const hill = land.landform.hills.find(item => item.id === 'lookout')!, gate = land.places.court.gate;
    const target: Vec3 = [lake.x * .6 + gate[0] * .4, lake.level + 2, lake.z * .6 + gate[2] * .4];
    const bearing = Math.atan2(target[0] - summit[0], target[2] - summit[2]), out = hill.plateau - 1.5;
    const eye: Vec3 = [summit[0] + Math.sin(bearing) * out, summit[1] + 1.65, summit[2] + Math.cos(bearing) * out];
    return { eye, target, fov: 55,
      caption: `From the summit · ${Math.round(walk.length)} m of lookout path below, the lake and the town beyond`, walk: walk.id, at: walk.length };
  },
};

/**
 * Bench preview of trail earth: one sheet per metre cell inside a trail's designed width (with the terrain's
 * own edge wear), lying on the graded ground. The terrain worker paints only paving today.
 */
function createTrailEarth(plan: SettlementPlan, land: KingdomGeography, routes: KingdomRoutes, height: (x: number, z: number) => number,
  material: THREE.ShaderMaterial): THREE.Mesh {
  const positions: number[] = [], seen = new Set<string>(), phase = 1.7;
  const decks = new Set(['land:bridge', 'land:pier']);
  for (const edge of routes.streets.filter(street => street.kind === 'trail' && !decks.has(street.id))) {
    const xs = edge.points.map(p => p[0]), zs = edge.points.map(p => p[2]);
    for (let z = Math.floor(Math.min(...zs)) - 3; z <= Math.max(...zs) + 3; z++) for (let x = Math.floor(Math.min(...xs)) - 3; x <= Math.max(...xs) + 3; x++) {
      const key = `${x},${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sample = samplePublicGround(plan, x + .5, z + .5), wear = .22 * Math.sin(x * .12 + z * .09 + phase) + .1 * Math.sin(x * .29 - z * .17);
      if (sample?.kind !== 'trail' || decks.has(sample.id) || sample.reservedDistance > Math.min(.35, wear + .1) || waterKeepOut(land.landform, x + .5, z + .5, 0)) continue;
      const c = [[x, z], [x, z + 1], [x + 1, z + 1], [x + 1, z]] as const;
      for (const i of [0, 1, 2, 0, 2, 3]) positions.push(c[i]![0], height(c[i]![0], c[i]![1]) + .04, c[i]![1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

/** Plan inset: water, streets, trails, the walk shown, its beats and where the eye stands. North is up. */
function planInset(plan: SettlementPlan, land: KingdomGeography, routes: KingdomRoutes, edges: Edges, view: View): string {
  const walk = routes.paths.find(path => path.id === view.walk)!, line = walkLine(walk, edges);
  const xs = line.map(p => p[0]), zs = line.map(p => p[2]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 70;
  const minX = (Math.min(...xs) + Math.max(...xs)) / 2 - size / 2, minZ = (Math.min(...zs) + Math.max(...zs)) / 2 - size / 2, u = size / 260;
  const poly = (points: readonly Vec3[]) => `M${points.map(p => `${p[0].toFixed(1)} ${p[2].toFixed(1)}`).join('L')}`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${size} ${size}">`, `<rect x="${minX}" y="${minZ}" width="${size}" height="${size}" fill="#e6dcc1"/>`];
  for (const body of land.landform.waters) parts.push(`<ellipse cx="${body.x}" cy="${body.z}" rx="${body.radiusX}" ry="${body.radiusZ}" fill="#8fb4c2" stroke="#5f8796" stroke-width="${u}"/>`);
  for (const stream of land.landform.streams)
    parts.push(`<path d="M${stream.points.map(p => `${p.position[0].toFixed(1)} ${p.position[1].toFixed(1)}`).join('L')}" fill="none" stroke="#7ea8b8" stroke-width="${Math.max(2, stream.points[0]!.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const plot of plan.reservations) { const l = plot.lot; parts.push(`<rect x="${l.minX}" y="${l.minZ}" width="${l.maxX - l.minX}" height="${l.maxZ - l.minZ}" fill="#f3e8cc" stroke="#b69a72" stroke-width="${.5 * u}"/>`); }
  for (const street of plan.streets.filter(item => item.kind !== 'approach'))
    parts.push(`<path d="${poly(street.points)}" fill="none" stroke="#cdb98e" stroke-width="${street.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const street of routes.streets)
    parts.push(`<path d="${poly(street.points)}" fill="none" stroke="${street.kind === 'trail' ? '#a27b4c' : '#cdb98e'}" stroke-width="${street.kind === 'trail' ? 2.5 : street.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const site of land.sites) parts.push(`<path d="M${site.footprint.map(p => `${p[0]} ${p[1]}`).join('L')}Z" fill="#8e6a45" opacity=".85"/>`);
  parts.push(`<path d="${poly(line)}" fill="none" stroke="#c9732e" stroke-width="${3.2 * u}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const beat of walk.beats) {
    const p = pointAt(line, beat.at), colour = beat.reveal ? '#f6d27a' : beat.dressingIndex !== undefined ? '#3f5a2e' : beat.siteId ? '#5b3d22' : '#fff4dc';
    parts.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[2].toFixed(1)}" r="${2.6 * u}" fill="${colour}" stroke="#2b2418" stroke-width="${.8 * u}"/>`);
  }
  const heading = Math.atan2(view.target[0] - view.eye[0], view.target[2] - view.eye[2]), r = 9 * u;
  const tip = (a: number, d: number) => `${(view.eye[0] + Math.sin(heading + a) * d).toFixed(1)} ${(view.eye[2] + Math.cos(heading + a) * d).toFixed(1)}`;
  parts.push(`<path d="M${view.eye[0]} ${view.eye[2]}L${tip(-.45, r * 3)}L${tip(.45, r * 3)}Z" fill="#fff4dc" opacity=".55"/>`);
  parts.push(`<circle cx="${view.eye[0]}" cy="${view.eye[2]}" r="${3.6 * u}" fill="#c9732e" stroke="#fff4dc" stroke-width="${1.2 * u}"/>`);
  const label = `${Math.round(walk.length)} m · ${Math.round(walk.length / EXPLORE_PACE_MPS)} s at ${EXPLORE_PACE_MPS} m/s · ${walk.beats.length} beats`;
  parts.push(`<text x="${minX + 8 * u}" y="${minZ + size - 9 * u}" font-size="${11 * u}" font-family="system-ui,sans-serif" font-weight="600" fill="#2b2418" stroke="#e6dcc1" stroke-width="${3 * u}" paint-order="stroke">${label}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

const failure = (message: string) => {
  (window as Window & { __chatdomLandError?: string }).__chatdomLandError = message;
  document.querySelector('#status')!.textContent = message;
};

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ?? 'chatdom', viewName = params.get('view') ?? 'lake-reveal', hour = Number(params.get('hour') ?? '17.25');
  if (!views[viewName] || !Number.isFinite(hour)) throw new Error(`Unknown view ${viewName} or hour`);
  const fixture = geographyFixture(seed), land = fixture.land;
  const routes = foundKingdomRoutes(land, fixture.plan);
  // The founded walks join the town's own graph: new nodes, trails and decks become public ground.
  const plan: SettlementPlan = { ...fixture.plan, revision: `${fixture.plan.revision}:walks`, nodes: [...fixture.plan.nodes, ...routes.nodes],
    streets: [...fixture.plan.streets, ...routes.streets], activeStreetIds: [...fixture.plan.activeStreetIds, ...routes.streets.map(street => street.id)] };
  const edges = new Map(plan.streets.map(street => [street.id, street]));
  const view = views[viewName]!(land, routes, edges), { placed: landContent, pending } = placeLandContent(routes.dressings);
  document.querySelector('#caption')!.textContent = view.caption;
  const held = (form: string) => pending.filter(item => item.form === form).length;
  document.querySelector('#fixture')!.textContent = `Town fixture · ${fixture.kept} installed homes on the new land · trail earth is a bench preview · `
    + `${held('bench')} benches and ${held('direction-sign')} fingerposts reserved for their civic models`;
  document.querySelector('#plan')!.innerHTML = planInset(plan, land, routes, edges, view);

  const canvas = document.querySelector<HTMLCanvasElement>('#land')!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(view.fov, innerWidth / innerHeight, .15, 2200);
  camera.position.set(...view.eye); camera.lookAt(new THREE.Vector3(...view.target)); camera.updateMatrixWorld();
  const atmosphere = createAtmosphere(scene), grade = getEnvironment(hour);
  const clay = createVoxelMaterial(MATERIALS, 'build'), ground = createVoxelMaterial(MATERIALS, 'terrain');
  const height = (x: number, z: number) => terrainHeight(plan, x, z);

  const origin: [number, number] = [Math.floor(plan.bounds.minX) - 20, Math.floor(plan.bounds.minZ) - 20];
  const width = Math.ceil(plan.bounds.maxX - origin[0]) + 21, depth = Math.ceil(plan.bounds.maxZ - origin[1]) + 21;
  const heights = new Float32Array(width * depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) heights[x + z * width] = height(origin[0] + x, origin[1] + z);
  ground.setTerrainHeight(heights, width, depth, origin, 1);
  const lake = plan.lake;
  ground.setShoreLevel(lake.level, [lake.x - lake.radiusX * 1.3, lake.x + lake.radiusX * 1.3, lake.z - lake.radiusZ * 1.3, lake.z + lake.radiusZ * 1.3]);
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(plan.bounds.minX, -8, plan.bounds.minZ), new THREE.Vector3(plan.bounds.maxX, 60, plan.bounds.maxZ)), resolution: 2048 });
  shadows.bindReceiver(clay.material); shadows.bindReceiver(ground.material);

  const { houses, props } = placeSettlementContent(plan.homes, height);
  props.push(...placeMarketContent(plan.market));
  const { buildings: castle, beaconPosition } = createCastleContent(plan.castle);
  const placed = [...houses, ...props, ...castle, ...landContent];
  const blueprints = new Map<string, VoxelBlueprint>();
  for (const item of placed) blueprints.set(item.blueprint.id, item.blueprint);
  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 512 });
  let done = 0;
  const status = (text: string) => { document.querySelector('#status')!.textContent = text; };
  const content = [...blueprints.values()].map(async blueprint => {
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset') throw new Error(`Could not mesh ${blueprint.id}`);
    const placements = placed.filter(item => item.blueprint.id === blueprint.id), geometry = geometryFromChunks(result.chunks, 'build');
    geometry.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(placements.length).fill(1), 1));
    const mesh = new THREE.InstancedMesh(geometry, clay.material, placements.length);
    const matrix = new THREE.Matrix4(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    placements.forEach((item, i) => mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(...item.position), turn.setFromAxisAngle(up, item.yaw), one)));
    mesh.frustumCulled = false; scene.add(mesh); shadows.register(mesh);
    status(`Raising ${++done}/${blueprints.size}`);
  });
  const terrain = loadTerrain(plan, undefined, { timeoutMs: 600_000 }).then(({ chunks, origin: at }) => {
    for (const tile of terrainBatches(chunks)) {
      const geometry = geometryFromChunks(tile, 'terrain');
      geometry.boundingBox!.expandByScalar(TERRAIN_SURFACE_BOUNDS_PADDING);
      geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geometry, ground.material); mesh.position.set(...at); scene.add(mesh); shadows.register(mesh);
    }
  });
  // The horizon and the trail preview share the terrain's own shading, one with grass and one with earth.
  const surface = (material: number, lift = false) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: ground.material.uniforms, fragmentShader: ground.material.fragmentShader,
    polygonOffset: lift, polygonOffsetFactor: lift ? -2 : 0, polygonOffsetUnits: lift ? -2 : 0,
    vertexShader: `out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=${material}u;gl_Position=projectionMatrix*viewMatrix*world;}` });
  const { geometry: horizonGeometry } = createHorizonSurface(plan, { farStep: 20, sampleTerrain: height });
  const horizonMaterial = surface(MAT.grass), earthMaterial = surface(MAT.earth, true);
  scene.add(new THREE.Mesh(horizonGeometry, horizonMaterial)); shadows.bindReceiver(horizonMaterial);
  scene.add(createTrailEarth(plan, land, routes, height, earthMaterial)); shadows.bindReceiver(earthMaterial);
  const water = createWater(scene, { lake, terrain: { data: heights, width, height: depth, origin, step: 1 } });
  const courses = createWaterPreview(scene, land.landform, height);
  await Promise.all([...content, terrain]);
  pool.dispose();

  clay.setEnvironment(grade); ground.setEnvironment(grade);
  const fog = new THREE.FogExp2(new THREE.Color(grade.fog).getHex(), .0016); scene.fog = fog;
  atmosphere.update(hour, 30, camera, new THREE.Vector3(...beaconPosition), 0);
  water.update(grade, 30, camera); courses.update(grade, 30);
  shadows.updateSunDirection(grade.sunDirection);
  renderer.render(scene, camera);
  status('');
  requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
}

main().catch(error => { console.error(error); failure(error instanceof Error ? error.message : String(error)); });
