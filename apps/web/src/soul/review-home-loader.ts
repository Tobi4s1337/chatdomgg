import * as THREE from 'three';
import type { VoxelBlueprint, VoxelMaterial } from '@chatdom/shared';
import type { buildSoulReviewHome } from './review-home';

type Home = ReturnType<typeof buildSoulReviewHome>;
export type HomeBuffer = { position: Float32Array; normal: Float32Array; color?: Float32Array };
export type HomeRequest = { id: number; blueprint: VoxelBlueprint; materials: readonly VoxelMaterial[]; roofMaterial: number };
export type HomeResponse = { id: number; surfaces: { material: number; data: HomeBuffer }[]; snow: HomeBuffer }
  | { id: number; error: string };

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

function unpack(data: HomeBuffer): THREE.BufferGeometry {
  if (!data || !(data.position instanceof Float32Array) || !(data.normal instanceof Float32Array)
    || data.position.length % 3 !== 0 || data.normal.length !== data.position.length
    || (data.color !== undefined && (!(data.color instanceof Float32Array) || data.color.length !== data.position.length))) {
    throw new Error('Invalid home geometry from worker.');
  }
  const geometry = new THREE.BufferGeometry();
  try {
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    if (data.color) geometry.setAttribute('color', new THREE.BufferAttribute(data.color, 3));
    return geometry;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

/** One worker is reused for serial home builds; disposal settles any pending caller. */
export function createSoulReviewHomeLoader(options: { createWorker?: () => WorkerLike } = {}): {
  load(blueprint: VoxelBlueprint, materials: readonly VoxelMaterial[], roofMaterial: number): Promise<Home | null>;
  dispose(): void;
} {
  const worker = options.createWorker?.() ?? new Worker(new URL('./review-home-worker.ts', import.meta.url), { type: 'module' });
  let disposed = false;
  let nextId = 0;
  let pending: { id: number; resolve: (result: Home | null) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  const close = () => {
    if (disposed) return;
    disposed = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  const fail = (error: Error) => {
    const active = pending;
    pending = undefined;
    if (active) clearTimeout(active.timer);
    close();
    active?.reject(error);
  };
  worker.onmessage = (event: MessageEvent<HomeResponse>) => {
    const response = event.data;
    if (!pending || !response || response.id !== pending.id) return;
    if ('error' in response) { fail(new Error(response.error)); return; }
    const created: THREE.BufferGeometry[] = [];
    try {
      const surfaces = response.surfaces.map(({ material, data }) => {
        const geometry = unpack(data);
        created.push(geometry);
        return { material, geometry };
      });
      const snow = unpack(response.snow);
      created.push(snow);
      const active = pending;
      pending = undefined;
      clearTimeout(active.timer);
      active.resolve({ surfaces, snow });
    } catch (error) {
      for (const geometry of created) geometry.dispose();
      fail(error instanceof Error ? error : new Error('Invalid home worker response.'));
    }
  };
  worker.onerror = (event) => { fail(new Error(event.message || 'Home worker failed.')); };
  worker.onmessageerror = () => { fail(new Error('Home worker response could not be read.')); };
  return {
    load(blueprint, materials, roofMaterial) {
      if (disposed) return Promise.reject(new Error('Home loader is disposed.'));
      if (pending) return Promise.reject(new Error('Home loader already has an active job.'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('Home worker timed out.')), 30_000);
        pending = { id, resolve, reject, timer };
        try { worker.postMessage({ id, blueprint, materials, roofMaterial } satisfies HomeRequest); }
        catch (error) { fail(error instanceof Error ? error : new Error('Could not start home worker.')); }
      });
    },
    dispose() {
      const active = pending;
      pending = undefined;
      if (active) clearTimeout(active.timer);
      close();
      active?.resolve(null);
    },
  };
}
