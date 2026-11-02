import * as THREE from 'three';
import { createForgeHearth, createForgeWorkshop, FORGE_HEARTH_PIVOT, FORGE_WORKSHOP_HEARTH_PIVOT, MAT, MATERIALS, STYLES } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { ForgeLedgerViewSchema, KingdomIdSchema, VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { mountForgeLedgerPage } from '../forge/ledger/page';
import { createForgeLedgerWall } from '../forge/ledger/wall';
import { createForgeRitualView } from '../forge/ritual-view';
import type { ForgeLedgerRead } from '../forge/ledger/read';
import fiftyTown from './fifty-town.json?raw';

/*
 * Review bench for "the forge remembers". Its stored ledger is the real public answer of the realm's ledger route
 * over the town the FW11 fifty forged in (work/evidence/forge-wish/fw12-ledger/). `?live=<kingdomId>` reads the route
 * instead. view=page|wall · shot=street|close · hour=<0..24> · empty=1
 */
declare global { interface Window { __chatdomReady?: boolean } }
const params = new URLSearchParams(location.search);
const view = params.get('view') === 'wall' ? 'wall' : 'page';
const live = params.get('live');
const stored = ForgeLedgerViewSchema.parse(JSON.parse(fiftyTown));
const kingdomId = live && KingdomIdSchema.safeParse(live).success ? live : stored.kingdomId;
const read: ForgeLedgerRead | undefined = live ? undefined
  : async () => ({ kind: 'ledger', view: params.get('empty') === '1' ? { ...stored, total: 0, entries: [] } : stored });
const now = () => stored.at;
const bench = document.getElementById('bench')!;
document.body.dataset.view = view;

if (view === 'page') {
  // A stand-in for play's ledger leaf (its board, folio and page title), so the page is judged where it will live.
  const leaf = document.createElement('section');
  leaf.className = 'bench-leaf';
  leaf.innerHTML = '<header class="bench-leaf-head"><p class="bench-eyebrow">Folio v</p><h2 class="bench-title">The forge remembers</h2></header>';
  const body = document.createElement('div');
  body.className = 'bench-leaf-body';
  leaf.append(body);
  bench.append(leaf);
  mountForgeLedgerPage(body, kingdomId, { ...(read ? { read } : {}), now });
  const settle = () => {
    const state = body.querySelector<HTMLElement>('.forge-ledger')?.dataset.state;
    if (state && state !== 'loading') setTimeout(() => { window.__chatdomReady = true; }, 400);
    else requestAnimationFrame(settle);
  };
  void document.fonts.ready.then(settle);
} else void wall();

async function wall() {
  const CELL = VOXEL_METRES.build, hour = Number(params.get('hour') ?? '19.6'), shot = params.get('shot') === 'close' ? 'close' : 'street';
  const grade = getEnvironment(Number.isFinite(hour) ? hour : 19.6);
  document.body.style.background = `linear-gradient(180deg, ${grade.zenith} 0%, ${grade.horizon} 62%, ${grade.fog} 100%)`;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  bench.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .05, 400);
  const pool = new VoxelWorkerPool({ size: 2 }), material = createVoxelMaterial(MATERIALS, 'build');
  material.setEnvironment(grade);
  const mesh = async (blueprint: VoxelBlueprint) => {
    const out = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (out?.kind !== 'asset') throw new Error(`The voxel worker did not return ${blueprint.id}.`);
    return new THREE.Mesh(geometryFromChunks(out.chunks, 'build'), material.material);
  };
  // The forge square as the founded land lays it out: anvil at (0, 8), the hearth and its open smithy to the east.
  const anvil = new THREE.Vector3(0, 0, 8);
  const square = 160;
  const plaza: VoxelBlueprint = { version: 1, id: 'ledger-bench-square', kind: 'prop', lattice: 'build', styleId: STYLES.hearth.id, size: [square, 2, square], windows: [],
    boxes: [{ from: [0, 0, 0], to: [square, 1, square], material: MAT.earth }, { from: [0, 1, 0], to: [square, 2, square], material: MAT.paving }] };
  const place = (blueprint: VoxelBlueprint, pivot: readonly number[], x: number, z: number, turn: number) => mesh(blueprint).then(m => {
    const yaw = turn * Math.PI / 2, offset = new THREE.Vector3(pivot[0]! * CELL, 0, pivot[2]! * CELL).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.position.set(x - offset.x, 0, z - offset.z); m.rotation.y = yaw; scene.add(m);
  });
  const ground = await mesh(plaza);
  ground.position.set(-square * CELL / 2, -2 * CELL, -square * CELL / 2 + 6); scene.add(ground);
  await Promise.all([place(createForgeHearth('hearth'), FORGE_HEARTH_PIVOT, 5.5, 5, 3), place(createForgeWorkshop('hearth'), FORGE_WORKSHOP_HEARTH_PIVOT, 5.5, 5, 3)]);
  const ritual = createForgeRitualView(scene, material);
  ritual.root.position.copy(anvil); ritual.update(null); ritual.setEnvironment(grade);
  // The wall stands across the square from the smithy, turned toward the anvil's approach.
  const wallAt = new THREE.Vector3(-6.2, 0, 6.4), wallYaw = .62;
  const ledger = createForgeLedgerWall({ scene, pool, material, position: [wallAt.x, 0, wallAt.z], yaw: wallYaw, style: 'hearth', kingdomId, ...(read ? { read } : {}), now });
  ledger.setEnvironment(grade);
  await ledger.ready;
  const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), wallYaw);
  const aim = () => {
    const width = innerWidth, height = innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const portrait = width / height < .8;
    if (shot === 'close') {
      // Close: the whole wall in frame, at the distance a citizen stops to read the plaques.
      const target = wallAt.clone().add(new THREE.Vector3(0, 2.2, 0));
      camera.position.copy(target).addScaledVector(front, portrait ? 13 : 7.6).add(new THREE.Vector3(0, -.35, 0));
      camera.lookAt(target);
    } else {
      // Street distance: standing at the anvil's approach and a little back, the wall and the smithy together.
      // A phone's narrow frame keeps the wall whole and lets the anvil fall to its edge.
      const target = wallAt.clone().lerp(anvil, portrait ? .1 : .42).add(new THREE.Vector3(0, portrait ? 2 : 1.6, portrait ? 0 : -.6));
      const eye = wallAt.clone().addScaledVector(front, portrait ? 17 : 11.5).add(new THREE.Vector3(portrait ? .8 : 2.4, 1.7, 0));
      camera.position.copy(eye); camera.lookAt(target);
    }
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  aim();
  addEventListener('resize', aim);
  requestAnimationFrame(() => { aim(); requestAnimationFrame(() => { aim(); window.__chatdomReady = true; }); });
}
