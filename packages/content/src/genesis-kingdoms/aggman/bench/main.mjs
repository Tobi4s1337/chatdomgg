/* global innerWidth, innerHeight, location, requestAnimationFrame, URLSearchParams */
// Lane-local piece bench for The_AGGman's hamlet: one bench set (`../<folder>/bench-set.ts`) drawn through the
// production voxel worker, mesher and clay at a fixed dusk grade, on a plain ground and a flat sea. Lantern cells
// show as small warm glows: SIMULATED host behaviour to judge the pieces, never a claim about any kingdom. Served
// by the Vite dev server only (capture.mjs); the app never loads it.
import * as THREE from 'three';
import { VOXEL_METRES } from '@chatdom/shared';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { MATERIALS } from '../../../materials';

const sets = import.meta.glob('../*/bench-set.ts');
const query = new URLSearchParams(location.search);
const C = VOXEL_METRES.build;
const fail = (error) => { console.error('Bench failed', error); document.body.dataset.error = error instanceof Error ? error.message : String(error); };

async function main() {
  const name = query.get('set') ?? '';
  const load = sets[`../${name}/bench-set.ts`];
  if (!load) throw new Error(`No bench set "${name}". Known: ${Object.keys(sets).join(', ')}`);
  const set = (await load()).BENCH_SET;
  const hour = Number(query.get('hour') ?? 19.4), view = query.get('view') ?? 'front';
  document.querySelector('[data-title]').textContent = `${set.name} · ${view} · ${hour}:00`;
  const canvas = document.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  const scene = new THREE.Scene();
  const grade = getEnvironment(hour);
  scene.background = new THREE.Color('#3a3746');
  const clay = createVoxelMaterial(MATERIALS, 'build'); clay.setEnvironment(grade);
  const pool = new VoxelWorkerPool({ size: 3 });
  const bounds = new THREE.Box3();
  const dot = document.createElement('canvas'); dot.width = dot.height = 64;
  const g = dot.getContext('2d'), fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, 'rgba(255,255,255,1)'); fade.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = fade; g.fillRect(0, 0, 64, 64);
  const glowMap = new THREE.CanvasTexture(dot);
  const seas = [];
  let triangles = 0;
  for (const item of set.pieces) {
    const result = await pool.submit({ kind: 'blueprint', blueprint: item.piece.blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`No geometry for ${item.piece.blueprint.id}`);
    const mesh = new THREE.Mesh(geometryFromChunks(result.chunks, 'build'), clay.material);
    const yaw = (item.turn ?? 0) * Math.PI / 2, lift = item.piece.draft !== undefined ? -item.piece.draft * C : 0;
    mesh.position.set(item.at[0] * C, lift, item.at[1] * C); mesh.rotation.y = yaw; scene.add(mesh);
    triangles += result.chunks.reduce((n, chunk) => n + chunk.mesh.indices.length / 3, 0);
    mesh.updateMatrixWorld(true); bounds.expandByObject(mesh);
    if (item.piece.draft !== undefined) seas.push(new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()));
    for (const cell of item.piece.lanterns) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd28a' }));
      glow.position.set((cell[0] + .5) * C, (cell[1] + .5) * C, (cell[2] + .5) * C).applyMatrix4(mesh.matrixWorld); scene.add(glow);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: '#ffb35c', transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(1.1); halo.position.copy(glow.position); scene.add(halo);
    }
  }
  const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: '#4d5a3e' }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.002; scene.add(ground);
  // Floating pieces get a pool of flat sea around them; the ground stays ground for everything else.
  for (const at of seas) {
    const sea = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40), new THREE.MeshBasicMaterial({ color: '#2f4f66' }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(at.x, .001, at.z); scene.add(sea);
  }
  const radius = Math.max(size.x, size.y * 1.4, size.z) * .5 + 1;
  const dir = view === 'side' ? new THREE.Vector3(1.6, .7, -.1) : view === 'back' ? new THREE.Vector3(-.9, .75, -1.5) : view === 'top' ? new THREE.Vector3(.05, 2.4, .5) : new THREE.Vector3(.9, .62, 1.5);
  const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, .05, 800);
  camera.position.copy(centre).add(dir.normalize().multiplyScalar(radius / Math.tan(16 * Math.PI / 180) * Math.max(1, 1.25 * innerHeight / innerWidth)));
  camera.lookAt(centre);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  await new Promise(resolve => requestAnimationFrame(resolve));
  renderer.render(scene, camera); renderer.getContext().finish();
  window.__aggmanBench = { set: set.name, pieces: set.pieces.length, triangles, ids: set.pieces.map(p => p.piece.blueprint.id) };
  window.__chatdomReady = true;
}
main().catch(fail);
