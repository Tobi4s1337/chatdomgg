import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import type { StyleKey } from '../../../../packages/content/src/materials';
import { createPierFurnishings, type PierFurnishingKind } from '../../../../packages/content/src/pier';
import type { PierBench, PierBenchWindow } from './bench';

const NAMES: Record<PierFurnishingKind, string> = {
  lantern: 'Lantern post', rack: 'Rod rack', lectern: 'Almanac lectern', board: 'Catch board', bench: 'Bench', mooring: 'Mooring post', bucket: 'Bait bucket',
};
const STYLE_NAMES: Record<StyleKey, string> = { hearth: 'Hearth', tide: 'Tide', grove: 'Grove' };
export const FURNISHING_ANGLES = ['Three-quarter', 'Profile', 'Reverse'] as const;
const YAWS = [.5, Math.PI / 2, Math.PI + .6] as const;
/** Build cells are 0.125 m. */
const CELL = .125;

export function furnishingSheet(query: URLSearchParams): { style: StyleKey; title: string; columns: readonly string[] } {
  const style = query.get('style') ?? 'grove';
  if (style !== 'hearth' && style !== 'tide' && style !== 'grove') throw new Error('Choose Hearth, Tide or Grove.');
  return { style, title: `${STYLE_NAMES[style]} pier furnishings · dusk`, columns: createPierFurnishings(style).map(piece => NAMES[piece.kind]) };
}

/**
 * One kit's seven pier furnishings from three angles in one still, through the production voxel worker, material,
 * sun and shadows. Each piece is fitted to its own cell; its height in metres is in the stats.
 */
export async function mountFurnishingSheet(canvas: HTMLCanvasElement, query: URLSearchParams): Promise<PierBench> {
  const W = window as PierBenchWindow;
  W.__chatdomReady = false;
  const { style } = furnishingSheet(query);
  const pieces = createPierFurnishings(style);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 60);
  const material = createVoxelMaterial(MATERIALS, 'build');
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-3, -3, -3), new THREE.Vector3(3, 3, 3)), resolution: 1024 });
  shadows.bindReceiver(material.material);
  const pool = new VoxelWorkerPool({ size: 1, maxQueue: 8 });
  const models: { mesh: THREE.Mesh; radius: number; triangles: number; id: string; height: number }[] = [];
  let disposed = false, raf = 0, hour = 18.6;
  const stats: Record<string, unknown> = { ready: false, view: 'furnishings', style };
  try {
    for (const { blueprint } of pieces) {
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (!result || result.kind !== 'asset' || !result.chunks.length) throw new Error('A pier furnishing could not be meshed.');
      const geometry = geometryFromChunks(result.chunks, 'build');
      const [sx, sy, sz] = blueprint.size.map(cells => cells * CELL) as [number, number, number];
      const mesh = new THREE.Mesh(geometry, material.material);
      // Packed production attributes: centre the piece on the origin through its transform.
      mesh.position.set(-sx / 2, -sy / 2, -sz / 2);
      models.push({ mesh, radius: Math.hypot(sx, sy, sz) / 2, triangles: (geometry.index?.count ?? 0) / 3, id: blueprint.id, height: sy });
    }
  } catch (error) {
    pool.dispose(); shadows.dispose(); material.dispose(); renderer.dispose(); models.forEach(model => model.mesh.geometry.dispose()); throw error;
  }
  const background = new THREE.Color('#32383c');
  const draw = () => {
    raf = 0; if (disposed) return;
    const width = canvas.clientWidth, height = canvas.clientHeight, header = 72, footer = 8;
    renderer.setSize(width, height, false);
    const grade = getEnvironment(hour);
    material.setEnvironment(grade); renderer.toneMappingExposure = grade.exposure;
    renderer.setScissorTest(false); renderer.setClearColor(background); renderer.clear(); renderer.setScissorTest(true);
    const cellWidth = width / models.length, rowHeight = (height - header - footer) / YAWS.length;
    const measured = [];
    for (const [column, model] of models.entries()) {
      scene.add(model.mesh); model.mesh.updateMatrixWorld(true);
      const detach = shadows.register(model.mesh);
      shadows.updateSunDirection(grade.sunDirection);
      const cost = { id: model.id, triangles: model.triangles, height: model.height, colorDraws: 0 };
      for (const [row, yaw] of YAWS.entries()) {
        const viewHeight = Math.max(20, rowHeight - 34), aspect = cellWidth / viewHeight;
        const half = model.radius * 1.04 / Math.min(1, aspect);
        camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half;
        camera.position.set(Math.sin(yaw) * 12, 5.2, Math.cos(yaw) * 12); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        const x = Math.round(column * cellWidth), y = Math.round(height - header - row * rowHeight - viewHeight);
        renderer.setViewport(x, y, Math.ceil(cellWidth), Math.ceil(viewHeight)); renderer.setScissor(x, y, Math.ceil(cellWidth), Math.ceil(viewHeight));
        renderer.render(scene, camera);
        cost.colorDraws += renderer.info.render.calls;
      }
      measured.push(cost);
      detach(); scene.remove(model.mesh);
    }
    renderer.setScissorTest(false); renderer.getContext().finish();
    Object.assign(stats, { ready: true, hour, models: measured, viewsPerModel: YAWS.length,
      triangles: measured.reduce((sum, cost) => sum + cost.triangles, 0), colorDraws: measured.reduce((sum, cost) => sum + cost.colorDraws, 0) });
    W.__chatdomReady = true;
  };
  const reset = () => { stats.ready = false; W.__chatdomReady = false; if (!raf) raf = requestAnimationFrame(draw); };
  const observer = new ResizeObserver(reset); observer.observe(canvas);
  const setHour = (value: number) => { if (!Number.isFinite(value) || value < 0 || value >= 24) throw new Error('Choose a valid hour.'); hour = value; reset(); };
  setHour(Number(query.get('hour') ?? 18.6));
  return { site: null, stats, view() { throw new Error('Open another review URL to change the sheet.'); }, hour: setHour,
    asset() { throw new Error('Choose a kit through its review URL.'); },
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(raf); observer.disconnect(); pool.dispose(); shadows.dispose(); material.dispose(); models.forEach(model => model.mesh.geometry.dispose()); renderer.dispose(); W.__chatdomReady = false; },
  };
}
