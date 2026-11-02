import * as THREE from 'three';
import { MATERIALS, MAT, createHome, createHearthHome, createMarketStall, createMarketWell, createTideHome, createTree, STYLES } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, createWindowLights, geometryFromChunks, getEnvironment, type WindowHouse } from '@chatdom/render';
import { KingdomPresenceFrameSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createForgeEmitters } from '../../emitters';
import { createCodexEngraving } from '../../engraving';
import { createAnvilHero } from '../index';
import { CHEEK_Z, H } from '../sculpt';
import { aimDragon, createForgedPieceMaterial, placeRoofDragon } from './dragon-scene';
import { BENCH_STYLES, BUILT_VIEWS, parseBench, type BenchState, type BenchStyle } from './params';

export interface AnvilBenchReport extends BenchState {
  width: number;
  height: number;
  heroTriangles: number;
  heroCastMs: number;
  triangles: number;
  draws: number;
  cameraDistance: number;
  /** Dragon views: which side of the host's ridge the chimney socket chose, and the mounted piece's boxes. */
  dragon: { side: 'street' | 'lane'; boxes: number } | null;
  /**
   * The unchanged engraving, mounted through the hero's contract: how far its plate sits behind the
   * cheek (metres), and where the SVG's 24-unit box lands on screen (CSS pixels, for the comparison crop).
   */
  mark: { setBack: number; rect: { x: number; y: number; width: number; height: number } };
}

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomAnvilHero?: AnvilBenchReport;
    __chatdomAnvilHeroError?: string;
  }
}

/** The engraving's SVG units to metres before the mount's uniform scale (engraving/index.ts). */
const SVG_UNIT = .32 / 24;
const VIEW_TITLES: Record<BenchState['view'], string> = {
  'anvil-close': 'The anvil, close', 'anvil-square': 'The anvil, from across the square', 'anvil-mark': 'The mark in the cheek, face on',
  'dragon-close': 'The sleeping dragon chimney, close', 'dragon-square': 'The sleeping dragon chimney, from the square',
};
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

interface Placed { blueprint: VoxelBlueprint; position: Vec3; yaw: number; lattice: 'build' | 'terrain'; forged?: boolean }
/** The home across the square that carries the forged dragon chimney in the dragon views. */
const DRAGON_HOST = 3;

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
    const query = new URLSearchParams({ view: state.view, style: state.style, hour: String(state.hour), heat: String(state.heat), time: String(state.time), shaping: state.shaping ? '1' : '0', ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)])) });
    a.href = `?${query}`; a.textContent = label;
    if (current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  };
  for (const view of BUILT_VIEWS) link(view, { view }, view === state.view);
  for (const style of BENCH_STYLES) link(style, { style }, style === state.style);
  for (const [label, heat, shaping] of [['cold', 0, false], ['shaping .6', .6, true], ['pour .85', .85, false], ['strike 1', 1, false]] as const) link(label, { heat, shaping }, state.heat === heat && state.shaping === shaping);
}

async function main() {
  window.__chatdomReady = false;
  const state = parseBench(window.location.search);
  renderNav(state);
  const dragonView = state.view === 'dragon-close' || state.view === 'dragon-square';
  element('title').textContent = VIEW_TITLES[state.view];
  const heatCaption = state.heat > 0 ? `heat preview ${state.heat}${state.shaping ? ', shaping' : ''} at ${state.time} s` : 'cold iron';
  element('caption').textContent = `${STYLE_NAMES[state.style]} · ${String(state.hour).padStart(2, '0')}:00 · ${dragonView ? 'smoke preview · a forged piece, no owner' : heatCaption} · lit windows preview`;
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
  const camera = new THREE.PerspectiveCamera(state.view === 'anvil-close' ? 34 : state.view === 'anvil-mark' ? 30 : state.view === 'dragon-close' ? (portrait ? 52 : 40) : portrait ? 58 : 42, host.clientWidth / host.clientHeight, .1, 600);
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
  // The official mark, unchanged, remounted exactly as the kingdom's Forge does (ritual-view.ts).
  const engraving = createCodexEngraving(hero.root);
  engraving.root.position.copy(hero.engravingMount.position);
  engraving.root.rotation.copy(hero.engravingMount.rotation);
  engraving.root.scale.setScalar(hero.engravingMount.scale);
  const input = { time: state.time, heat: state.heat, shaping: state.shaping };
  hero.update(input);
  engraving.update(input);
  const stage = hero.root.getObjectByName('forge-anvil-hero:stage') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  if (!stage) throw new Error('The anvil returned no stage mesh.');
  shadows.bindReceiver(stage.material);
  shadows.register(stage);

  const geometries: THREE.BufferGeometry[] = [];
  const placed = square(state.style);
  // The dragon views put the real chimney assembly on a real home, drawn as the kingdom draws forged pieces.
  const dragon = dragonView ? placeRoofDragon(state.style, placed[DRAGON_HOST]!) : null;
  if (dragon) placed.push({ ...dragon.piece, yaw: 0, lattice: 'build', forged: true });
  const forged = dragon ? createForgedPieceMaterial(clay.material) : null;
  if (dragon?.side === 'lane') element('title').textContent = `The sleeping dragon chimney, ${state.view === 'dragon-close' ? 'close' : 'from the lane'} behind the house`;
  const emitters = dragon ? createForgeEmitters(scene) : null;
  const results = await Promise.all(placed.map((p, i) => pool.submit({ kind: 'blueprint', blueprint: p.blueprint, revision: i + 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision })));
  let triangles = stage.geometry.index!.count / 3;
  const houses: WindowHouse[] = [];
  results.forEach((result, i) => {
    const p = placed[i]!;
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The square could not be laid: ${p.blueprint.id}.`);
    const geometry = geometryFromChunks(result.chunks, p.lattice);
    geometries.push(geometry);
    triangles += result.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0);
    const mesh = new THREE.Mesh(geometry, p.lattice === 'terrain' ? meadow.material : p.forged && forged ? forged : clay.material);
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
  // Check the mount the way a viewer would: the plate's front against the cheek, in the hero's own space.
  hero.root.updateMatrixWorld(true);
  const plateBox = new THREE.Box3();
  engraving.root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.computeBoundingBox(); plateBox.union(o.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().copy(hero.root.matrixWorld).invert().multiply(o.matrixWorld))); } });
  const setBack = CHEEK_Z * H - plateBox.max.z;
  if (!(setBack > 0 && setBack < .001)) throw new Error(`The mark's plate sits ${(setBack * 1000).toFixed(2)} mm behind the cheek; it must sit flush, just inside its window.`);
  const markUnit = SVG_UNIT * hero.engravingMount.scale, mount = hero.engravingMount.position;
  const markCorners = [[0, 0], [24, 0], [0, 24], [24, 24]].map(([u, v]) => hero.root.localToWorld(new THREE.Vector3(mount.x + (u! - 12) * markUnit, mount.y - (v! - 12) * markUnit, plateBox.max.z)));
  const markRect = () => {
    const xs: number[] = [], ys: number[] = [];
    for (const corner of markCorners) { const p = corner.clone().project(camera); xs.push((p.x + 1) / 2 * host.clientWidth); ys.push((1 - p.y) / 2 * host.clientHeight); }
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, width: Math.round((Math.max(...xs) - x) * 10) / 10, height: Math.round((Math.max(...ys) - y) * 10) / 10 };
  };
  let cameraDistance = 0;
  const aim = () => {
    const width = host.clientWidth, height = host.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    if (dragon) {
      cameraDistance = aimDragon(camera, state.view, dragon, portrait);
    } else if (state.view === 'anvil-mark') {
      // Face on to the cheek and a few degrees above it, so the cut's lower walls show: the SVG's box fills half the frame.
      const target = hero.root.localToWorld(new THREE.Vector3(mount.x, mount.y, plateBox.max.z));
      const span = 24 * markUnit * 2;
      cameraDistance = Math.max(span / 2 / Math.tan(vfov / 2), span / 2 / Math.tan(hfov / 2));
      camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(.1), Math.cos(.1)).multiplyScalar(cameraDistance));
      camera.lookAt(target);
    } else if (state.view === 'anvil-close') {
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
    // The existing chimney smoke, seeked to the bench time; no sparks, no ritual.
    emitters?.update({ time: state.time, anvil: new THREE.Vector3(0, 1.6, 0), activity: 0, landed: dragon ? [{ position: dragon.emitter, kind: 'smoke' }] : [] });
    renderer.render(scene, camera);
    renderer.getContext().finish();
    window.__chatdomAnvilHero = { ...state, width: host.clientWidth, height: host.clientHeight, heroTriangles: stage.geometry.index!.count / 3, heroCastMs: Math.round(heroCastMs), triangles, draws: renderer.info.render.calls, cameraDistance: Math.round(cameraDistance * 100) / 100, dragon: dragon ? { side: dragon.side, boxes: dragon.piece.blueprint.boxes.length } : null, mark: { setBack: Math.round(setBack * 1e5) / 1e5, rect: markRect() } };
  };
  aim();
  await renderer.compileAsync(scene, camera);
  frame();
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  frame();
  window.addEventListener('resize', () => { window.__chatdomReady = false; frame(); window.__chatdomReady = true; });
  window.addEventListener('pagehide', () => {
    engraving.dispose(); hero.dispose(); emitters?.dispose(); forged?.dispose(); windows.dispose(); shadows.dispose(); atmosphere.dispose(); pool.dispose();
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
