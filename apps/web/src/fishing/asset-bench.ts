import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { createAtmosphere, createSunShadows, createVoxelMaterial, geometryFromChunks, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool } from '@chatdom/voxel';
import { BLUEPRINTS } from '../../../../packages/content/src/pier';
import type { PierBench, PierBenchWindow } from './bench';

type Angle = 'front' | 'side' | 'back';
/** Isolated content review, using the production voxel worker, material, sun and shadows. */
export async function mountPierAssetBench(canvas: HTMLCanvasElement, query: URLSearchParams): Promise<PierBench> {
  const W = window as PierBenchWindow;
  W.__chatdomReady = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
  const material = createVoxelMaterial(MATERIALS, 'build'), atmosphere = createAtmosphere(scene);
  const pool = new VoxelWorkerPool({ size: 1, maxQueue: 4 });
  const shadows = createSunShadows(renderer, { bounds: new THREE.Box3(new THREE.Vector3(-6, -1, -6), new THREE.Vector3(6, 6, 6)), resolution: 1024 });
  shadows.bindReceiver(material.material);
  const cache = new Map<string, THREE.BufferGeometry>();
  let detachCaster = () => {};
  let object: THREE.Mesh | undefined, angle: Angle = 'front', extent = 2, frame = 0, raf = 0, disposed = false, loading = false, started = false;
  let hour = 18.6;
  const stats: Record<string, unknown> = { ready: false, view: 'asset' };
  const target = new THREE.Vector3(), beacon = new THREE.Vector3();
  const reset = () => { frame = 0; W.__chatdomReady = false; stats.ready = false; if (started && raf === 0) raf = requestAnimationFrame(draw); };
  const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); reset(); };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const setHour = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value >= 24) throw new Error('Choose an hour in the kingdom day.');
    hour = value; const grade = getEnvironment(hour); material.setEnvironment(grade); renderer.toneMappingExposure = grade.exposure; shadows.updateSunDirection(grade.sunDirection); reset();
  };
  const select = async (id: string, nextAngle: Angle) => {
    const blueprint = BLUEPRINTS.find(blueprint => blueprint.id === id);
    if (!blueprint) throw new Error('This furnishing is not in the pier catalogue.');
    loading = true; reset();
    let geometry = cache.get(id);
    if (!geometry) {
      const result = await pool.submit({ kind: 'blueprint', blueprint, revision: 1, materials: MATERIALS.materials, materialRevision: MATERIALS.revision });
      if (result?.kind !== 'asset' || !result.chunks.length) throw new Error('This furnishing could not be meshed.');
      geometry = geometryFromChunks(result.chunks, 'build'); cache.set(id, geometry);
    }
    if (disposed) return;
    if (object) { scene.remove(object); detachCaster(); }
    object = new THREE.Mesh(geometry, material.material); object.position.set(-blueprint.size[0] * .0625, 0, -blueprint.size[2] * .0625); scene.add(object); object.updateMatrixWorld(true); detachCaster = shadows.register(object);
    extent = Math.max(...geometry.boundingBox!.getSize(target).toArray()); angle = nextAngle;
    Object.assign(stats, { asset: id, angle, triangles: (geometry.index?.count ?? 0) / 3, boxes: blueprint.boxes.length });
    loading = false; reset();
  };
  const draw = () => {
    if (disposed) return;
    const distance = extent * 2.45, yaw = angle === 'side' ? Math.PI * .65 : angle === 'back' ? Math.PI * 1.15 : Math.PI * .15;
    camera.position.set(Math.sin(yaw) * distance, extent * .9, Math.cos(yaw) * distance); target.set(0, extent * .45, 0); camera.lookAt(target); camera.updateMatrixWorld();
    atmosphere.update(hour, 30, camera, beacon, 0); renderer.render(scene, camera);
    Object.assign(stats, { hour, calls: renderer.info.render.calls });
    if (!loading && object && ++frame > 2) {
      if (!stats.ready) renderer.getContext().finish();
      W.__chatdomReady = true; stats.ready = true;
      if (query.get('still') === '1') { raf = 0; return; }
    }
    raf = requestAnimationFrame(draw);
  };
  setHour(Number(query.get('hour') ?? 18.6));
  await select(query.get('asset') ?? BLUEPRINTS[0]!.id, query.get('angle') === 'side' || query.get('angle') === 'back' ? query.get('angle') as Angle : 'front');
  started = true; raf = requestAnimationFrame(draw);
  return { site: null, stats, view(value) { if (value !== 'asset') throw new Error('Open the pier view to leave the furnishing review.'); }, hour: setHour,
    asset(id, nextAngle) { void select(id, nextAngle).catch(error => { W.__chatdomPierError = String(error); }); },
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(raf); observer.disconnect(); pool.dispose(); shadows.dispose(); atmosphere.dispose(); material.dispose(); cache.forEach(geometry => geometry.dispose()); renderer.dispose(); scene.clear(); W.__chatdomReady = false; },
  };
}
