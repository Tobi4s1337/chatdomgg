// Offline review harness for the real hosted baked land owner. This is land only, not a native kingdom scene.
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createVoxelMaterial, getEnvironment } from '@chatdom/render';
import type { SettlementPlan } from '@chatdom/world';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import { prepareHostedGrandLand, createHostedGrandMaterial, type HostedGrandLand } from '../../../apps/web/src/kingdom/grand-land';
import { grandRecipeFor } from '../../../apps/web/src/kingdom/grand-land/recipes';
import { createWaterSurface, type WaterSurface } from '../../../apps/web/src/places/water/surface/surface';

type StartupOwner = HostedGrandLand & { markPresented(): void; stats: HostedGrandLand['stats'] & { startupPhase: string; fadingRegions: number } };
type BenchWindow = Window & { __chatdomReady?: boolean; __startupLand?: typeof api };
const bench = window as BenchWindow;
const canvas = document.querySelector('canvas') ?? document.body.appendChild(document.createElement('canvas'));
document.body.style.margin = '0'; canvas.style.display = 'block';
let current: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  land: StartupOwner; water: WaterSurface; atmosphere: ReturnType<typeof createAtmosphere>;
  native: ReturnType<typeof createVoxelMaterial>; width: number; height: number; presented: boolean } | undefined;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function pump(until: (land: StartupOwner) => boolean, label: string) {
  const state = current; if (!state) throw new Error('Initialize the bench first');
  const start = performance.now();
  while (!until(state.land)) {
    if (state.land.stats.phase === 'failed' || state.land.stats.phase === 'disposed') throw new Error(`Land stopped during ${label}`);
    if (performance.now() - start > 60_000) throw new Error(`Timed out during ${label}: ${JSON.stringify(state.land.stats)}`);
    state.land.update(performance.now());
    await pause();
  }
}
function metrics() {
  const state = current; if (!state) throw new Error('Initialize the bench first');
  const root = state.scene.getObjectByName('installed-grand-land');
  const levels: Record<string, number> = {};
  let faceMeshes = 0;
  for (const group of root?.children ?? []) {
    const level = Math.round(Math.log2(group.scale.x / 0.5));
    levels[level] = (levels[level] ?? 0) + 1;
    group.traverse(object => { if (object instanceof THREE.Mesh) faceMeshes++; });
  }
  return { stats: { ...state.land.stats }, levels, faceMeshes,
    render: { calls: state.renderer.info.render.calls, triangles: state.renderer.info.render.triangles },
    width: state.width, height: state.height, presented: state.presented };
}
function drawFrame() {
  const state = current; if (!state) throw new Error('Initialize the bench first');
  const env = getEnvironment(17.5);
  state.native.setEnvironment(env); state.renderer.toneMappingExposure = env.exposure;
  state.atmosphere.update(17.5, 30, state.camera, new THREE.Vector3(0, -1000, 0), 0);
  state.water.update({ time: 30, environment: env, camera: state.camera, sources: [] });
  state.renderer.render(state.scene, state.camera); state.renderer.getContext().finish();
  bench.__chatdomReady = true;
  return metrics();
}
function dispose() {
  const state = current; current = undefined; bench.__chatdomReady = false;
  if (!state) return;
  state.water.dispose(); state.land.dispose(); state.atmosphere.dispose(); state.native.dispose(); state.renderer.dispose();
}
async function init(width: number, height: number) {
  dispose();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid dimensions');
  const response = await fetch('/fixture.json'); if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`);
  const { plan, receipt } = await response.json() as { plan: SettlementPlan; receipt: RealmFoundedManifest };
  const recipe = grandRecipeFor(receipt.kingdomId); if (!recipe) throw new Error('Fixture has no pinned grand recipe');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(`Startup bench shader: ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)} ${gl.getProgramInfoLog(program)}`);
  };
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), portrait = width < height;
  const camera = new THREE.PerspectiveCamera(portrait ? 58 : 52, width / height, 0.1, 10000);
  const market = plan.nodes.find(node => node.id === plan.market.nodeId)?.position;
  if (!market) throw new Error('Fixture market node is missing');
  camera.position.set(market[0] + (portrait ? 150 : -110), market[1] + (portrait ? 36 : 40), market[2] + 160);
  camera.lookAt(plan.castle.centre[0], plan.castle.centre[1] + 9, portrait ? -35 : market[2] - 8);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const native = createVoxelMaterial(MATERIALS, 'terrain'), atmosphere = createAtmosphere(scene);
  const environment = getEnvironment(17.5); scene.fog = new THREE.FogExp2(environment.fog, environment.fogDensity);
  const land = await prepareHostedGrandLand({ scene, camera, renderer, plan, receipt, kingdomId: receipt.kingdomId, recipe,
    materialFactory: palette => createHostedGrandMaterial(palette, native) }) as StartupOwner;
  const water = createWaterSurface({ bodies: [], reaches: [], ground: land.water.ground, raster: land.water.raster, quality: 'reduced' });
  scene.add(water.root);
  current = { renderer, scene, camera, land, water, atmosphere, native, width, height, presented: false };
  await pump(owner => owner.stats.phase === 'ready' && owner.stats.startupPhase === 'awaiting-presentation', 'first coverage');
  await land.ready;
  return metrics();
}
function drawStartup() {
  const state = current; if (!state) throw new Error('Initialize the bench first');
  if (state.presented) throw new Error('Startup was already acknowledged');
  const beforeAcknowledgement = drawFrame();
  state.land.markPresented(); state.presented = true;
  return beforeAcknowledgement;
}
async function advanceToMidFade() {
  const state = current; if (!state?.presented) throw new Error('Draw startup before refining');
  await pump(land => land.stats.fadingRegions > 0, 'first fade');
  const started = performance.now();
  while (performance.now() - started < 200) { state.land.update(performance.now()); await pause(); }
  return drawFrame();
}
async function advanceToSettled() {
  const state = current; if (!state?.presented) throw new Error('Draw startup before refining');
  await pump(land => land.stats.startupPhase === 'settled' && land.stats.fadingRegions === 0, 'settled refinement');
  return drawFrame();
}
const api = { init, drawStartup, advanceToMidFade, advanceToSettled, dispose };
bench.__startupLand = api;
