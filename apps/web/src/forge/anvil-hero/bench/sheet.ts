import * as THREE from 'three';
import { MATERIALS, STYLES } from '@chatdom/content';
import { createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool } from '@chatdom/voxel';
// Until main selects it, the bench reaches the replacement by its source path (spec 25).
import { createAnvilHeroDragon } from '../../../../../../packages/content/src/anvil-hero';
import { BENCH_STYLES } from './params';

/**
 * Three kits by four angles in one canvas. The first three angles are the content workshop's own
 * front, side and back; the fourth is the near flank the street sees. Same mesher, material,
 * exposure and dusk grade as the workshop.
 */
const ANGLES = [
  { id: 'front', direction: new THREE.Vector3(1, .85, 1.5) },
  { id: 'side', direction: new THREE.Vector3(1.8, .8, -.16) },
  { id: 'back', direction: new THREE.Vector3(-1, .85, -1.5) },
  { id: 'street flank', direction: new THREE.Vector3(-.12, .32, 1) },
] as const;

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomAnvilHeroSheet?: { triangles: Record<string, number>; boxes: Record<string, number>; hour: number };
    __chatdomAnvilHeroError?: string;
  }
}

async function main() {
  window.__chatdomReady = false;
  const params = new URLSearchParams(window.location.search);
  for (const key of params.keys()) if (key !== 'hour') throw new Error(`Unknown sheet input "${key}". Use hour.`);
  const hourText = params.get('hour') ?? '19';
  if (!/^(?:1?\d|2[0-3])$/.test(hourText)) throw new Error(`Unknown hour "${hourText}". Choose a whole hour 0..23.`);
  const hour = Number(hourText);
  const grid = document.getElementById('grid')!;
  for (const style of BENCH_STYLES) for (const angle of ANGLES) {
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    caption.textContent = `${STYLES[style].name} · ${angle.id}`;
    figure.append(caption); grid.append(figure);
  }
  document.getElementById('caption')!.textContent += ` · ${String(hour).padStart(2, '0')}:00`;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = () => { throw new Error('A dragon sheet shader could not compile.'); };
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor('#34333c');
  renderer.setScissorTest(true);
  grid.prepend(renderer.domElement);
  const material = createVoxelMaterial(MATERIALS, 'build');
  material.setEnvironment(getEnvironment(hour));
  const pool = new VoxelWorkerPool({ size: 2 });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 100);

  const models = await Promise.all(BENCH_STYLES.map(async (style, i) => {
    const motif = createAnvilHeroDragon(style);
    const blueprint: VoxelBlueprint = { version: 1, id: `forge-anvil-hero-dragon-${style}`, kind: 'prop', styleId: STYLES[style].id, lattice: 'build', size: motif.size, boxes: motif.boxes, windows: [] };
    const result = await pool.submit({ kind: 'blueprint', blueprint, revision: i + 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
    if (result?.kind !== 'asset' || !result.chunks.length) throw new Error(`The ${style} dragon could not be carved.`);
    const geometry = geometryFromChunks(result.chunks, 'build');
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material.material));
    const bounds = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(...motif.size).multiplyScalar(VOXEL_METRES.build));
    return { style, scene, geometry, bounds, boxes: motif.boxes.length, triangles: result.chunks.reduce((n, c) => n + c.mesh.indices.length / 3, 0) };
  }));

  const draw = () => {
    const width = grid.clientWidth, height = grid.clientHeight;
    renderer.setSize(width, height);
    const figures = [...grid.querySelectorAll('figure')], origin = grid.getBoundingClientRect();
    figures.forEach((figure, n) => {
      const model = models[Math.floor(n / ANGLES.length)]!, angle = ANGLES[n % ANGLES.length]!;
      const rect = figure.getBoundingClientRect(), x = rect.left - origin.left, y = height - (rect.bottom - origin.top);
      renderer.setViewport(x, y, rect.width, rect.height); renderer.setScissor(x, y, rect.width, rect.height);
      // The workshop's framing: look at the centre from twice the diagonal, fit the projected box.
      const centre = model.bounds.getCenter(new THREE.Vector3()), radius = model.bounds.getSize(new THREE.Vector3()).length();
      camera.position.copy(centre).addScaledVector(angle.direction.clone().normalize(), radius * 2);
      camera.lookAt(centre); camera.updateMatrixWorld(true);
      const projected = new THREE.Box3();
      for (const px of [model.bounds.min.x, model.bounds.max.x]) for (const py of [model.bounds.min.y, model.bounds.max.y]) for (const pz of [model.bounds.min.z, model.bounds.max.z]) projected.expandByPoint(new THREE.Vector3(px, py, pz).applyMatrix4(camera.matrixWorldInverse));
      const aspect = rect.width / rect.height, half = Math.max(projected.max.y - projected.min.y, (projected.max.x - projected.min.x) / aspect) * .59;
      camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
      camera.updateProjectionMatrix();
      renderer.render(model.scene, camera);
    });
    renderer.getContext().finish();
  };
  draw();
  for (const model of models) await renderer.compileAsync(model.scene, camera);
  draw();
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  draw();
  window.__chatdomAnvilHeroSheet = { hour, triangles: Object.fromEntries(models.map(m => [m.style, m.triangles])), boxes: Object.fromEntries(models.map(m => [m.style, m.boxes])) };
  window.addEventListener('resize', () => { window.__chatdomReady = false; draw(); window.__chatdomReady = true; });
  window.addEventListener('pagehide', () => { models.forEach(m => m.geometry.dispose()); material.dispose(); pool.dispose(); renderer.dispose(); }, { once: true });
  document.getElementById('status')!.hidden = true;
  window.__chatdomReady = true;
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  window.__chatdomAnvilHeroError = message;
  const status = document.getElementById('status');
  if (status) {
    status.hidden = false; status.setAttribute('role', 'alert');
    status.innerHTML = '<strong>The dragons could not be shown</strong><p></p>';
    status.querySelector('p')!.textContent = message;
  }
  console.error(message);
});
