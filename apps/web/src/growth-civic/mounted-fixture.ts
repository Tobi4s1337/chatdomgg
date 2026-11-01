import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { KingdomIdSchema, type GrowthCivicPlace, type GrowthSceneFeed, type GrowthSceneFrame, type VoxelBlueprint } from '@chatdom/shared';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { createForgeHearth } from '../../../../packages/content/src/forge-square/index';
import { FORGE_EXTENSION_HEARTH_OFFSET } from '../../../../packages/content/src/growth-civic/forge-extension';
import { createHumpbackBridge } from '../../../../packages/content/src/places/water/bridge/bridge';
import { createGrowthCivicAdapter } from './adapter';

const places: GrowthCivicPlace[] = ['market', 'tavern', 'forge', 'castle-court', 'bridge'];
const status = document.querySelector<HTMLElement>('.status')!;
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#263c40');
const camera = new THREE.OrthographicCamera(-20 * innerWidth / innerHeight, 20 * innerWidth / innerHeight, 20, -20, .1, 150);
camera.position.set(32, 35, 48); camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xdce6d4, 0x555044, 2));
const sun = new THREE.DirectionalLight(0xffd5a0, 2); sun.position.set(-10, 25, 20); scene.add(sun);
const material = createVoxelMaterial(MATERIALS, 'build'); material.setEnvironment(getEnvironment(18));
const pool = new VoxelWorkerPool({ size: 2, maxQueue: 64 });
const anchors: Record<GrowthCivicPlace, THREE.Matrix4> = {
  market: new THREE.Matrix4().makeTranslation(-14, 0, -5),
  tavern: new THREE.Matrix4().makeTranslation(-4, 0, -5),
  forge: new THREE.Matrix4().makeTranslation(6, 0, -5),
  'castle-court': new THREE.Matrix4().makeTranslation(-13, 0, 5),
  bridge: new THREE.Matrix4().makeTranslation(-2, -1.75, 7),
};
// The sites are independent local coordinate systems; rotate the forge and court slightly.
anchors.forge.multiply(new THREE.Matrix4().makeRotationY(-.12));
anchors['castle-court'].multiply(new THREE.Matrix4().makeRotationY(.08));
const ground = new THREE.Mesh(new THREE.CylinderGeometry(24, 24.6, 1.4, 64), new THREE.MeshStandardMaterial({ color: 0x53634e, roughness: 1 }));
ground.position.y = -.75; scene.add(ground);
const river = new THREE.Mesh(new THREE.PlaneGeometry(7, 42), new THREE.MeshStandardMaterial({ color: 0x658f94, roughness: .38, metalness: .12 }));
river.rotation.x = -Math.PI / 2; river.position.set(7, -.04, 1); scene.add(river);
let receive: ((frame: GrowthSceneFrame) => void) | undefined;
const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe(fn) { receive = fn; return () => { receive = undefined; }; } };
let readySequence = 0, failure = '';
async function mesh(blueprint: VoxelBlueprint) {
  const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
  if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error(`Cannot mesh ${blueprint.id}`);
  const geometry = geometryFromChunks(result.chunks, 'build');
  return { object: new THREE.Mesh(geometry, material.material), dispose() { geometry.dispose(); } };
}
const adapter = createGrowthCivicAdapter({ feed, style: 'hearth', anchors, bridgeSite: { water: 6, bank: 14 },
  buildMesh: mesh,
  onWaiting() { status.textContent = 'Mounting the quarter…'; },
  onReady(frame) { readySequence = frame.sequence; },
  createLight(light) {
    const glow = new THREE.MeshBasicMaterial({ color: light.kind === 'hearth' ? 0xd96a30 : 0xf0bc71, toneMapped: false });
    const object = new THREE.Group();
    const geometries: THREE.PlaneGeometry[] = [];
    const pane = (dx: number, dy: number, width: number, height: number) => {
      const geometry = new THREE.PlaneGeometry(width * .125, height * .125); geometries.push(geometry);
      const plane = new THREE.Mesh(geometry, glow);
      plane.position.set((light.centre[0] + dx) * .125, (light.centre[1] + dy) * .125,
        light.centre[2] * .125 + (light.kind === 'lantern' ? .13 : .015)); object.add(plane);
    };
    if (light.kind === 'window') {
      pane(-2, -2, 2, 4); pane(1.5, -2, 3, 4); pane(-2, 2.5, 2, 3); pane(1.5, 2.5, 3, 3);
    } else pane(0, 0, light.kind === 'lantern' ? 2 : 5, 3);
    return { object, dispose() { for (const geometry of geometries) geometry.dispose(); glow.dispose(); } };
  },
  createWater(water) {
    const [x, y, z] = water.from, [X, , Z] = water.to;
    const geometry = new THREE.PlaneGeometry((X - x) * .125, (Z - z) * .125);
    const surface = new THREE.MeshBasicMaterial({ color: 0x709ca8, transparent: true, opacity: .8, side: THREE.DoubleSide });
    const object = new THREE.Mesh(geometry, surface); object.rotation.x = -Math.PI / 2;
    object.position.set((x + X) * .0625, y * .125 + .01, (z + Z) * .0625);
    return { object, dispose() { geometry.dispose(); surface.dispose(); } };
  },
  onUnavailable(reason) { failure = reason; },
});
adapter.attach(scene);
function frame(sequence: number, level: number): GrowthSceneFrame {
  return { version: 1, kingdomId: KingdomIdSchema.parse('1'), origin: 'simulated', sequence, asOf: sequence, homes: [],
    civic: { market: level, tavern: level, forge: level, bridge: level, 'castle-court': level }, beats: [] };
}
function render() { renderer.render(scene, camera); }
async function waitForMounts(sequence: number) {
  const start = performance.now();
  while (readySequence < sequence || places.some(place => adapter.group.getObjectByName(`growth-${place}`)?.children.length === 0)) {
    if (failure) throw new Error(`Civic adapter unavailable: ${failure}`);
    if (performance.now() - start > 120000) throw new Error('Timed out mounting civic forms');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  // Allow adapter continuations to attach their meshes after the worker promises resolve.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
try {
  const [hearth, bridge] = await Promise.all([mesh(createForgeHearth('hearth')), mesh(createHumpbackBridge('hearth', 6, 14).blueprint)]);
  const forgeRoot = new THREE.Group(); forgeRoot.matrixAutoUpdate = false; forgeRoot.matrix.copy(anchors.forge);
  hearth.object.position.set(...FORGE_EXTENSION_HEARTH_OFFSET.map(n => n * .125) as [number, number, number]); forgeRoot.add(hearth.object); scene.add(forgeRoot);
  const bridgeRoot = new THREE.Group(); bridgeRoot.matrixAutoUpdate = false; bridgeRoot.matrix.copy(anchors.bridge); bridgeRoot.add(bridge.object); scene.add(bridgeRoot);
  receive!(frame(1, 1)); await waitForMounts(1); render();
  receive!(frame(2, 4)); await waitForMounts(2); render();
  status.innerHTML = 'Snapshot 1 → 2 &nbsp;·&nbsp; all five sites replaced<br>Market · tavern · forge · court · bridge';
  (window as typeof window & { __chatdomReady?: boolean }).__chatdomReady = true;
} catch (error) { status.textContent = `Fixture failed: ${String(error)}`; throw error; }
