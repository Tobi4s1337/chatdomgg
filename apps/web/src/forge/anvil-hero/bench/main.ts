import * as THREE from 'three';
import { MATERIALS, MAT, createHome, createHearthHome, createMarketStall, createMarketWell, createTideHome, createTree, STYLES } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment, type WindowHouse } from '@chatdom/render';
import { KingdomPresenceFrameSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createAnvilHero } from '../index';
import { BENCH_STYLES, BUILT_VIEWS, parseBench, type BenchState, type BenchStyle } from './params';

export interface AnvilBenchReport extends BenchState {
  width: number;
  height: number;
  heroTriangles: number;
  heroCastMs: number;
  triangles: number;
  draws: number;
  cameraDistance: number;
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomAnvilHero?: AnvilBenchReport;
    __chatdomAnvilHeroError?: string;
  }
}

const STYLE_NAMES: Record<BenchStyle, string> = { hearth: 'Hearth & heather', tide: 'Salt & slate', grove: 'Moss & honey' };
const element = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The bench page is missing #${id}.`);
  return found as T;
};

/** A home on the square, read-only authored content in its kit's own language. */
function homeFor(style: BenchStyle, variant: 0 | 1 | 2): VoxelBlueprint {
  if (style === 'hearth') return createHearthHome('house', variant);
  if (style === 'tide') return createTideHome('house', variant);
  return createHome('house', 'grove', variant);
}

/** Flat slabs the authored content stands on. Neither is a home or a generator of homes. */
function slab(id: string, size: number, material: number, styleId: BenchStyle): VoxelBlueprint {
  return { version: 1, id, styleId: STYLES[styleId].id, kind: 'civic', lattice: 'build', size: [size, 1, size], boxes: [{ from: [0, 0, 0], to: [size, 1, size], material }], windows: [] };
}

interface Placed { blueprint: VoxelBlueprint; position: Vec3; yaw: number; lattice: 'build' | 'terrain' }

/** The market square around the anvil, in metres. The anvil stands at the origin. */
function square(style: BenchStyle): Placed[] {
  const placed: Placed[] = [
    { blueprint: slab('anvil-bench-meadow', 128, MAT.grass, style), position: [-32, -.51, -32], yaw: 0, lattice: 'terrain' },
    { blueprint: slab('anvil-bench-paving', 256, MAT.paving, style), position: [-16, -.125, -16], yaw: 0, lattice: 'build' },
  ];
  // A row of homes facing the square across the street, one more closing the west side.
  ([[-15, 0], [-5.5, 1], [4, 2], [13.5, 0]] as const).forEach(([x, variant]) => placed.push({ blueprint: homeFor(style, variant), position: [x, 0, -27], yaw: 0, lattice: 'build' }));
  placed.push({ blueprint: homeFor(style, 1), position: [-27, 0, 8], yaw: Math.PI / 2, lattice: 'build' });
  placed.push({ blueprint: createMarketWell(), position: [-14, 0, -7], yaw: 0, lattice: 'build' });
  placed.push({ blueprint: createMarketStall(0), position: [6, 0, -5.5], yaw: 0, lattice: 'build' });
  for (const [x, z, variant] of [[-20, -34, 0], [-2, -35, 1], [17, -33, 2], [-34, -12, 1]] as const) placed.push({ blueprint: createTree(variant), position: [x, 0, z], yaw: 0, lattice: 'build' });
  return placed;
}

/** Distance at which every corner of the box sits inside `margin` of the frame along this direction. */
function fitDistance(box: THREE.Box3, target: THREE.Vector3, direction: THREE.Vector3, vfov: number, hfov: number, margin: number): number {
  const forward = direction.clone().negate(), right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).sub(target), depth = -p.dot(forward);
    distance = Math.max(distance, depth + Math.abs(p.dot(right)) / Math.tan(hfov / 2 * margin), depth + Math.abs(p.dot(up)) / Math.tan(vfov / 2 * margin));
  }
  return distance;
}

function renderNav(state: BenchState) {
  const nav = element<HTMLElement>('nav');
  const link = (label: string, next: Partial<BenchState>, current: boolean) => {
    const a = document.createElement('a');
    const query = new URLSearchParams({ view: state.view, style: state.style, hour: String(state.hour), heat: String(state.heat), time: String(state.time), ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])) });
    a.href = `?${query}`; a.textContent = label;
    if (current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  };
  for (const view of BUILT_VIEWS) link(view, { view }, view === state.view);
  for (const style of BENCH_STYLES) link(style, { style }, style === state.style);
}

async function main() {
  window.__chatdomReady = false;
  const state = parseBench(window.location.search);
  renderNav(state);
  element('title').textContent = state.view === 'anvil-close' ? 'The anvil, close' : 'The anvil, from across the square';
  element('caption').textContent = `${STYLE_NAMES[state.style]} · ${String(state.hour).padStart(2, '0')}:00 · ${state.heat > 0 ? `SIMULATED heat ${state.heat}` : 'cold iron'} · lit windows SIMULATED`;
  const host = element<HTMLDivElement>('stage');
  const grade = getEnvironment(state.hour);
  document.body.style.background = `linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 78%, ${grade.fog} 100%)`;

  // The kingdom's own renderer settings: ACES, sRGB, the same exposure.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    console.error('Anvil bench shader failed', gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment), gl.getProgramInfoLog(program));
    throw new Error('An anvil bench shader could not compile.');
  };
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.domElement.setAttribute('aria-label', `The Forge anvil, ${state.view}, ${STYLE_NAMES[state.style]}`);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const portrait = host.clientWidth < host.clientHeight;
  const camera = new THREE.PerspectiveCamera(state.view === 'anvil-close' ? 34 : portrait ? 58 : 42, host.clientWidth / host.clientHeight, .1, 600);
  const atmosphere = createAtmosphere(scene);
  const clay = createVoxelMaterial(MATERIALS, 'build'), meadow = createVoxelMaterial(MATERIALS, 'terrain');
  clay.setEnvironment(grade); meadow.setEnvironment(grade);
  const pool = new VoxelWorkerPool({ size: 2 });
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-34, -1, -40), new THREE.Vector3(34, 22, 20)), resolution: 2048 });
  shadows.bindReceiver(clay.material); shadows.bindReceiver(meadow.material);

  const castStart = performance.now();
  const hero = createAnvilHero(scene);
  const heroCastMs = performance.now() - castStart;
  hero.setEnvironment(grade);
  hero.update({ time: state.time, heat: state.heat, shaping: false });
  const stage = hero.root.getObjectByName('forge-anvil-hero:stage') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  if (!stage) throw new Error('The anvil returned no stage mesh.');
  shadows.bindReceiver(stage.material);
  shadows.register(stage);

  const geometries: THREE.BufferGeometry[] = [];
  const placed = square(state.style);
  const results = await Promise.all(placed.map((p, i) => pool.submit({ kind: 'blueprint', blueprint: p.blueprint, revision: i + 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision })));
  let triangles = stage.geometry.index!.count / 3;
  const houses: WindowHouse[] = [];
  results.forEach((result, i) => {
    const p = placed[i]!;
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The square could not be laid: ${p.blueprint.id}.`);
    const geometry = geometryFromChunks(result.chunks, p.lattice);
    geometries.push(geometry);
    triangles += result.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0);
    const mesh = new THREE.Mesh(geometry, p.lattice === 'terrain' ? meadow.material : clay.material);
    mesh.position.set(...p.position); mesh.rotation.y = p.yaw; mesh.frustumCulled = false;
    scene.add(mesh);
    if (p.lattice === 'build' && p.blueprint.kind !== 'civic') shadows.register(mesh);
    if (p.blueprint.kind === 'home') houses.push({ slot: houses.length, blueprint: p.blueprint, position: p.position, yaw: p.yaw });
  });
  // SIMULATED neighbours at home: the bench's lit windows are not anyone's presence.
  const windows = createWindowLights(scene, houses);
  windows.setFrame(KingdomPresenceFrameSchema.parse({ version: 1, kingdomId: '1', epoch: 'anvil-bench', sequence: 1, asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: houses.map(h => ({ slot: h.slot, present: h.slot !== 2, publicName: null, since: 0 })) }));
  windows.update(30, state.hour);

  const heroBox = new THREE.Box3().setFromObject(hero.root);
  let cameraDistance = 0;
  const aim = () => {
    const width = host.clientWidth, height = host.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    if (state.view === 'anvil-close') {
      // Three-quarter from the mark's side and the heel: cheek, hardy hole and the horn's whole length.
      const target = heroBox.getCenter(new THREE.Vector3()).setY(.82);
      const direction = new THREE.Vector3(-.62, .62, 1).normalize();
      cameraDistance = fitDistance(heroBox, target, direction, vfov, hfov, camera.aspect < 1 ? .94 : .9);
      camera.position.copy(target).addScaledVector(direction, cameraDistance);
      camera.lookAt(target);
    } else {
      // A fixed street camera more than 12 m away across the cobbles, at a standing eye height.
      camera.position.set(-7.5, 2.6, 12.8);
      camera.lookAt(new THREE.Vector3(.4, portrait ? 2.6 : 2.2, -3));
      cameraDistance = Math.hypot(camera.position.x, camera.position.z);
    }
    camera.updateProjectionMatrix();
  };
  const frame = () => {
    aim();
    atmosphere.update(state.hour, state.time, camera, new THREE.Vector3(0, 60, -200), 0);
    shadows.updateSunDirection(grade.sunDirection);
    renderer.render(scene, camera);
    renderer.getContext().finish();
    window.__chatdomAnvilHero = { ...state, width: host.clientWidth, height: host.clientHeight, heroTriangles: stage.geometry.index!.count / 3, heroCastMs: Math.round(heroCastMs), triangles, draws: renderer.info.render.calls, cameraDistance: Math.round(cameraDistance * 100) / 100 };
  };
  aim();
  await renderer.compileAsync(scene, camera);
  frame();
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  frame();
  window.addEventListener('resize', () => { window.__chatdomReady = false; frame(); window.__chatdomReady = true; });
  window.addEventListener('pagehide', () => {
    hero.dispose(); windows.dispose(); shadows.dispose(); atmosphere.dispose(); pool.dispose();
    geometries.forEach(g => g.dispose()); clay.dispose(); meadow.dispose(); renderer.dispose();
  }, { once: true });
  element('status').hidden = true;
  window.__chatdomReady = true;
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  window.__chatdomAnvilHeroError = message;
  const status = document.getElementById('status');
  if (status) {
    status.hidden = false; status.setAttribute('role', 'alert');
    status.innerHTML = '<strong>The anvil could not be shown</strong><p></p>';
    status.querySelector('p')!.textContent = message;
  }
  console.error(message);
});
