// The millrace review page: this lane's mill, wheel, launder, weir, bridge and shore pieces on SIMULATED fixture
// land, drawn through the production voxel mesher, clay and terrain materials, atmosphere, water and sun shadows.
// Served by the Vite dev server only (capture.mjs); the shipped app never loads it.
import * as THREE from 'three';
import { MATERIALS, MAT } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWater, geometryFromChunks, getEnvironment } from '@chatdom/render';
import type { VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { millraceFixture, type FixtureView } from './fixture';
import { reviewExtras } from './extras';

type View = 'mill-wheel' | 'bridge-pond';
type BenchWindow = Window & {
  __chatdomReady?: boolean;
  __chatdomMillrace?: { view(name: string): void; hour(value: number): void; readonly stats: Record<string, unknown> };
};

const VIEWS: readonly View[] = ['mill-wheel', 'bridge-pond'];
const query = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas')!;
const seal = document.querySelector('[data-seal]')!;
const fail = (error: unknown) => {
  console.error('Millrace bench failed', error);
  document.body.dataset.error = error instanceof Error ? error.message : String(error);
  seal.textContent = `The millrace bench could not draw: ${document.body.dataset.error}`;
};

function parseView(value: string | null): View {
  const view = value ?? 'mill-wheel';
  if (!VIEWS.includes(view as View)) throw new Error(`Unknown view "${view}"; choose ${VIEWS.join(' or ')}.`);
  return view as View;
}
function parseHour(value: string | null): number {
  const hour = Number(value ?? 19.5);
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error(`Hour must lie in [0, 24), not "${value}".`);
  return hour;
}

try {
  let view = parseView(query.get('view')), hour = parseHour(query.get('hour'));
  const time = Number(query.get('time') ?? 30);
  if (!Number.isFinite(time) || time < 0) throw new Error('Time must be a finite non-negative number of seconds.');
  const fixture = millraceFixture(reviewExtras());
  seal.textContent = fixture.label;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Bench shader failed', { vertex: gl.getShaderInfoLog(vertex), fragment: gl.getShaderInfoLog(fragment), link: gl.getProgramInfoLog(program) });
    throw new Error('A bench shader could not compile');
  };
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(46, 1, 0.1, 900), atmosphere = createAtmosphere(scene);
  const fog = new THREE.FogExp2(0x000000); scene.fog = fog;
  // The fixture ground's own registry: the real one plus bench-local twins of grass and waterbed (same colour and
  // surface) so neighbouring terrain tops never share a material and the mesher keeps every top one cell square.
  // Only this page's ground material and its worker job see the twins; no content uses them.
  const twin = (id: number, next: number) => ({ ...MATERIALS.materials.find(m => m.id === id)!, id: next, name: `bench-twin-${next}` });
  const GRASS_TWIN = MATERIALS.materials.length, BED_TWIN = GRASS_TWIN + 1;
  const groundRegistry = { ...MATERIALS, materials: [...MATERIALS.materials, twin(MAT.grass, GRASS_TWIN), twin(MAT.waterbed, BED_TWIN)] };
  const clay = createVoxelMaterial(MATERIALS, 'build'), ground = createVoxelMaterial(groundRegistry, 'terrain');
  const { origin, step, width, depth, data } = fixture.ground;
  ground.setTerrainHeight(data, width, depth, origin, step);
  ground.setShoreLevel(0, [origin[0], origin[0] + (width - 1) * step, origin[1], origin[1] + (depth - 1) * step]);
  const { min, max } = fixture.shadowBounds;
  const sunShadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), resolution: 2048 });
  sunShadows.bindReceiver(clay.material); sunShadows.bindReceiver(ground.material);
  const waters = fixture.waters.map(body => {
    // Each body sees the shared ground only where it lies; elsewhere its bed is lifted out of the water.
    const masked = new Float32Array(data);
    for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) {
      if (!body.covers(origin[0] + i * step, origin[1] + k * step)) masked[i + width * k] = body.level + 1;
    }
    return createWater(scene, {
      lake: { x: body.centre[0], z: body.centre[1], radiusX: body.radius[0], radiusZ: body.radius[1], level: body.level },
      terrain: { data: masked, width, height: depth, origin, step },
    });
  });

  const pool = new VoxelWorkerPool({ size: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), maxQueue: 512 });
  const meshes = new Map<string, Promise<THREE.BufferGeometry>>();
  const mesh = (blueprint: VoxelBlueprint) => {
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
  const tasks: Promise<unknown>[] = fixture.placements.map(async placement => {
    const geometry = await mesh(placement.piece.blueprint);
    const model = new THREE.Mesh(geometry, clay.material);
    model.name = placement.id;
    if (placement.mounted) {
      // A mounted part turns about its own pivot, which lands on the mount.
      const { pivot, yaw } = placement.mounted;
      model.matrixAutoUpdate = false;
      model.matrix.makeTranslation(...placement.origin)
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
    } else {
      model.position.set(...placement.origin);
      model.rotation.y = (placement.turn * Math.PI) / 2;
    }
    scene.add(model); model.updateMatrixWorld(true); sunShadows.register(model);
  });
  // The fixture ground, built as the kingdom's terrain is: real half-metre columns for the mesher's topology, which
  // the terrain material then lays on the smooth height grid. Beds under water take the waterbed surface.
  const cellsX = width - 1, cellsZ = depth - 1, centres = new Float32Array(cellsX * cellsZ);
  for (let k = 0; k < cellsZ; k++) for (let i = 0; i < cellsX; i++) {
    centres[i + cellsX * k] = (data[i + width * k]! + data[i + 1 + width * k]! + data[i + width * (k + 1)]! + data[i + 1 + width * (k + 1)]!) / 4;
  }
  const lowest = Math.min(...centres), highest = Math.max(...centres), terrainCell = 0.5;
  const base = Math.floor(lowest / terrainCell) * terrainCell - 1;
  const rows = Math.ceil((highest - base) / terrainCell) + 1;
  const voxels = new Uint16Array(cellsX * rows * cellsZ);
  for (let k = 0; k < cellsZ; k++) for (let i = 0; i < cellsX; i++) {
    const h = centres[i + cellsX * k]!, x = origin[0] + (i + 0.5) * step, z = origin[1] + (k + 0.5) * step;
    const top = Math.max(1, Math.round((h - base) / terrainCell));
    const wet = fixture.waters.some(body => body.covers(x, z) && h < body.level + 0.05);
    // Neighbouring tops alternate between two surfaces of the same kind, so the mesher never merges them into
    // quads whose corners would leave cracks once the material bends them onto the grid.
    const surface = wet ? ((i + k) % 2 ? MAT.waterbed : BED_TWIN) : (i + k) % 2 ? MAT.grass : GRASS_TWIN;
    for (let y = 0; y < top; y++) voxels[i + cellsX * (y + rows * k)] = y === top - 1 ? surface : y >= top - 3 ? MAT.earth : MAT.stone;
  }
  tasks.push(pool.submit({ kind: 'asset', asset: { id: 'millrace-fixture-ground', revision: 1, lattice: 'terrain', size: [cellsX, rows, cellsZ], voxels }, materials: groundRegistry.materials, materialRevision: MATERIALS.revision }).then(result => {
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error('Could not mesh the fixture ground');
    const geometry = geometryFromChunks(result.chunks, 'terrain');
    geometry.boundingBox!.expandByScalar(16); geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
    const land = new THREE.Mesh(geometry, ground.material); land.position.set(origin[0], base, origin[1]);
    scene.add(land); land.updateMatrixWorld(true); sunShadows.register(land);
  }));

  let pose: FixtureView = fixture.views[view].wide;
  const choose = () => { pose = fixture.views[view][canvas.clientWidth >= canvas.clientHeight ? 'wide' : 'tall']; };
  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); choose();
  }
  new ResizeObserver(resize).observe(canvas); resize();

  let loaded = false, drawn = 0;
  const stats: Record<string, unknown> = { ready: false, view, hour, drawCalls: 0, triangles: 0, pieces: fixture.placements.length, blueprints: 0 };
  void Promise.all(tasks).then(() => { loaded = true; stats.blueprints = meshes.size; }, fail);
  const target = new THREE.Vector3(), nowhere = new THREE.Vector3(0, -1000, 0);
  function render() {
    try {
      const grade = getEnvironment(hour); clay.setEnvironment(grade); ground.setEnvironment(grade);
      camera.position.set(...pose.eye); target.set(...pose.target);
      if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
      camera.lookAt(target); camera.updateMatrixWorld();
      atmosphere.update(hour, time, camera, nowhere, 0);
      fog.color.set(grade.fog); fog.density = 0.0016;
      for (const water of waters) water.update(grade, time, camera);
      if (loaded) sunShadows.updateSunDirection(grade.sunDirection);
      renderer.render(scene, camera);
      Object.assign(stats, { view, hour, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, shadow: { ...sunShadows.stats } });
      // Readiness: every mesh is in and two whole frames have been drawn with the shadows in place.
      if (loaded && ++drawn === 2) { renderer.getContext().finish(); stats.ready = true; (window as BenchWindow).__chatdomReady = true; }
      requestAnimationFrame(render);
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(render);
  (window as BenchWindow).__chatdomMillrace = {
    stats,
    view: name => { view = parseView(name); choose(); },
    hour: value => { hour = parseHour(String(value)); },
  };
} catch (error) { fail(error); }

