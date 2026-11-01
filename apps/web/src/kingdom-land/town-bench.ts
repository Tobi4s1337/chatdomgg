import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { foundKingdomGeography, foundKingdomTown, terrainHeight, type KingdomTown, type StreetEdge } from '@chatdom/world';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createCastleContent } from '../kingdom/castle-content';
import { createHorizonSurface } from '../kingdom/horizon';
import { placeSettlementContent } from '../kingdom/settlement-content';
import { loadTerrain } from '../kingdom/terrain-client';
import { terrainBatches } from '../kingdom/terrain-batches';
import { TERRAIN_SURFACE_BOUNDS_PADDING } from '../kingdom/terrain-worker';
import { townMapSvg } from './town-map';
import { placeSiteContent } from './town-sites';
import { createWaterPreview } from './water-preview';

/**
 * The founded town at dusk: the version 2 street generator's homes, streets and square on the founded land,
 * with every claimed home shown occupied (SIMULATED citizens) and a small plan map of the whole town.
 * Trees, lamps and place buildings belong to their own lanes and are not drawn.
 *   /src/kingdom-land/town-bench.html?view=street|roofs&hour=18.6&seed=chatdom&first=2024&year=2026
 */
type View = { eye: Vec3; target: Vec3; fov: number; caption: string };

/** The main street's centreline walked out from the square, in order. */
function mainStreetFromSquare(town: KingdomTown): { name: string; points: Vec3[] } {
  const ways = town.plan.streets.filter(edge => edge.kind === 'main' && edge.name !== 'Crown Road');
  const first = ways.find(edge => edge.from === 'market' && edge.name === 'High Street') ?? ways.find(edge => edge.from === 'market');
  if (!first) throw new Error('The square has no main street');
  const points: Vec3[] = [...first.points];
  for (let at: StreetEdge | undefined = first; at;) {
    const next: StreetEdge | undefined = ways.find(edge => edge.from === at!.to && edge.name === first.name);
    if (next) points.push(...next.points.slice(1));
    at = next;
  }
  return { name: first.name, points };
}

const views: Record<string, (town: KingdomTown) => View> = {
  // Up the main street toward the square, roofs stepping up to the castle on its rise.
  street: town => {
    const { name, points } = mainStreetFromSquare(town);
    let run = 0, k = 1;
    for (; k < points.length && run < 82; k++) run += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![2] - points[k - 1]![2]);
    const at = points[Math.min(k, points.length - 1)]!, heart = town.plan.nodes.find(node => node.id === 'market')!.position;
    const gate = town.plan.nodes.find(node => node.id === town.plan.castle.gateNodeId)!.position;
    return { eye: [at[0], at[1] + 9, at[2]], target: [heart[0] * .7 + gate[0] * .3, heart[1] + 7, heart[2] * .7 + gate[2] * .3], fov: 56,
      caption: `Up ${name} · street fronts gathering into the square, the castle above` };
  },
  // Over the roofs from the lake side: the whole town climbing to the castle.
  roofs: town => {
    const heart = town.plan.nodes.find(node => node.id === 'market')!.position, lake = town.plan.lake;
    return { eye: [heart[0] - 70, heart[1] + 58, (heart[2] + lake.z) / 2 + 40], target: [heart[0] + 10, heart[1], heart[2] + 25], fov: 55,
      caption: 'Over the roofs · streets settling onto the land below the castle' };
  },
};

const failure = (message: string) => {
  (window as Window & { __chatdomLandError?: string }).__chatdomLandError = message;
  document.querySelector('#status')!.textContent = message;
};

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') ?? 'chatdom', viewName = params.get('view') ?? 'street', hour = Number(params.get('hour') ?? '18.6');
  const firstYear = Number(params.get('first') ?? '2024'), year = Number(params.get('year') ?? '2026');
  if (!views[viewName] || !Number.isFinite(hour)) throw new Error(`Unknown view ${viewName} or hour`);
  const config = { seed, tier: 'town' as const, firstYear, year };
  const land = foundKingdomGeography(config), town = foundKingdomTown(config, land), { plan } = town;
  const view = views[viewName]!(town);
  document.querySelector('#caption')!.textContent = view.caption;
  document.querySelector('#fixture')!.textContent = `SIMULATED citizens · ${plan.homes.length} founded homes in ${plan.quarters.length} quarters, all shown lived in; the streets hold ${town.capacity} lots`;
  document.querySelector('#map')!.innerHTML = townMapSvg(land, town, 300);

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
  props.push(...placeSiteContent(town.sites).placed);
  const { buildings: castle, beaconPosition } = createCastleContent(plan.castle);
  const placed = [...houses, ...props, ...castle];
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
  const { geometry: horizonGeometry } = createHorizonSurface(plan, { farStep: 20, sampleTerrain: height });
  const horizonMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: ground.material.uniforms, fragmentShader: ground.material.fragmentShader,
    vertexShader: 'out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);vAo=1.;vSky=1.;vLodFade=1.;vMaterial=1u;gl_Position=projectionMatrix*viewMatrix*world;}' });
  scene.add(new THREE.Mesh(horizonGeometry, horizonMaterial)); shadows.bindReceiver(horizonMaterial);
  const water = createWater(scene, { lake, terrain: { data: heights, width, height: depth, origin, step: 1 } });
  const courses = createWaterPreview(scene, land.landform, height);
  await Promise.all([...content, terrain]);
  pool.dispose();

  clay.setEnvironment(grade); ground.setEnvironment(grade);
  scene.fog = new THREE.FogExp2(new THREE.Color(grade.fog).getHex(), .0016);
  atmosphere.update(hour, 30, camera, new THREE.Vector3(...beaconPosition), 0);
  water.update(grade, 30, camera); courses.update(grade, 30);
  shadows.updateSunDirection(grade.sunDirection);
  renderer.render(scene, camera);
  status('');
  requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
}

main().catch(error => { console.error(error); failure(error instanceof Error ? error.message : String(error)); });
