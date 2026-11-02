import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { FISH_SPECIES } from '../../../../packages/content/src/fish';
import { itemModels } from '../bag';
import type { PierBench, PierBenchWindow } from './bench';

export function fishSheet(query: URLSearchParams): readonly { id: string; name: string }[] {
  const group = query.get('group') ?? '0';
  if (group === 'rod') return [{ id: 'tool:rod.willow', name: 'Willow Rod' }];
  if (!/^[0-2]$/.test(group)) throw new Error('Choose fish sheet 0, 1, 2 or rod.');
  return FISH_SPECIES.slice(Number(group) * 4, Number(group) * 4 + 4);
}

/** Three production-material views per model in one still. No kingdom is joined and no item is granted. */
export async function mountFishBench(canvas: HTMLCanvasElement, query: URLSearchParams): Promise<PierBench> {
  const W = window as PierBenchWindow;
  W.__chatdomReady = false;
  const entries = fishSheet(query);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#32383c');
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 40);
  const material = createVoxelMaterial(MATERIALS, 'avatar');
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-3, -3, -3), new THREE.Vector3(3, 3, 3)), resolution: 1024 });
  shadows.bindReceiver(material.material);
  const pool = new VoxelWorkerPool({ size: 1, maxQueue: 4 });
  const models: { mesh: THREE.Mesh; extent: number; triangles: number; id: string }[] = [];
  let disposed = false, raf = 0, hour = 18.6;
  const stats: Record<string, unknown> = { ready: false, view: 'fish', group: query.get('group') ?? '0' };
  try {
    for (const entry of entries) {
      const asset = itemModels.create(entry.id);
      if (!asset) throw new Error('This item model is not registered.');
      const result = await pool.submit({ kind: 'asset', asset, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error('A fish could not be meshed.');
      const geometry = geometryFromChunks(result.chunks, 'avatar');
      // The production mesh has packed attributes, not CPU positions. Centre through its transform.
      const mesh = new THREE.Mesh(geometry, material.material);
      mesh.position.set(-asset.size[0] * .03125, -asset.size[1] * .03125, -asset.size[2] * .03125);
      models.push({ mesh, extent: Math.max(...asset.size) * .0625, triangles: (geometry.index?.count ?? 0) / 3, id: entry.id });
    }
  } catch (error) {
    pool.dispose(); shadows.dispose(); material.dispose(); renderer.dispose(); models.forEach(model => model.mesh.geometry.dispose()); throw error;
  }
  const draw = () => {
    raf = 0; if (disposed) return;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    const grade = getEnvironment(hour);
    material.setEnvironment(grade); renderer.toneMappingExposure = grade.exposure; shadows.updateSunDirection(grade.sunDirection);
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    const rowHeight = (height - 48) / entries.length, cellWidth = width / 3;
    const measured = [];
    for (const [row, model] of models.entries()) {
      scene.add(model.mesh); model.mesh.updateMatrixWorld(true);
      const detach = shadows.register(model.mesh);
      const shadowUpdated = shadows.updateSunDirection(grade.sunDirection);
      const cost = { id: model.id, triangles: model.triangles, colorDraws: 0, colorTriangles: 0,
        shadowDraws: shadowUpdated ? shadows.stats.drawCalls : 0, shadowTriangles: shadowUpdated ? shadows.stats.triangles : 0 };
      for (let col = 0; col < 3; col++) {
        const viewHeight = Math.max(20, rowHeight - 30), aspect = cellWidth / viewHeight;
        const half = model.extent * .65 / Math.min(1, aspect);
        camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
        const yaw = [.5, Math.PI / 2, Math.PI + .6][col]!;
        camera.position.set(Math.sin(yaw) * 6, 3, Math.cos(yaw) * 6); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        const x = Math.round(col * cellWidth), y = Math.round(height - 48 - row * rowHeight - viewHeight);
        renderer.setViewport(x, y, Math.ceil(cellWidth), Math.ceil(viewHeight)); renderer.setScissor(x, y, Math.ceil(cellWidth), Math.ceil(viewHeight));
        renderer.render(scene, camera);
        cost.colorDraws += renderer.info.render.calls; cost.colorTriangles += renderer.info.render.triangles;
      }
      measured.push(cost);
      detach(); scene.remove(model.mesh);
    }
    renderer.setScissorTest(false); renderer.getContext().finish();
    Object.assign(stats, { ready: true, hour, models: measured, viewsPerModel: 3,
      colorDraws: measured.reduce((sum, cost) => sum + cost.colorDraws, 0), shadowDraws: measured.reduce((sum, cost) => sum + cost.shadowDraws, 0) });
    W.__chatdomReady = true;
  };
  const reset = () => { stats.ready = false; W.__chatdomReady = false; if (!raf) raf = requestAnimationFrame(draw); };
  const observer = new ResizeObserver(reset); observer.observe(canvas);
  const setHour = (value: number) => { if (!Number.isFinite(value) || value < 0 || value >= 24) throw new Error('Choose a valid hour.'); hour = value; reset(); };
  setHour(Number(query.get('hour') ?? 18.6));
  return { site: null, stats, view() { throw new Error('Open another review URL to change the sheet.'); }, hour: setHour,
    asset() { throw new Error('Choose a sheet through its review URL.'); },
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(raf); observer.disconnect(); pool.dispose(); shadows.dispose(); material.dispose(); models.forEach(model => model.mesh.geometry.dispose()); renderer.dispose(); W.__chatdomReady = false; },
  };
}
