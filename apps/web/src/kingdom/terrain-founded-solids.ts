/* global Worker:readonly */
import type { RealmFoundedScene } from '@chatdom/world';
import { foundedPlacedSolidsInput } from '@chatdom/world/founded-collision';
import { compilePlacedSolids, packCollisionBoxes, unpackCollisionBoxes, type CollisionBox, type PlacedSolidsInput } from '@chatdom/voxel/collision';

/**
 * The founded scene's placed solids (every home, prop and the anvil as disjoint boxes) are the heaviest part of
 * compiling its collision world. They are a pure function of the scene, so one worker compiles them while the
 * opening samples the ground and the land downloads; the scene then builds the world from them with
 * `compileFoundedSceneWithSolids`, which equals `compileFoundedScene`. Without workers they compile here.
 */
export type FoundedSolidsReply = { readonly boxes: Float64Array } | { readonly error: string };

export function compileFoundedSolidsPacked(input: PlacedSolidsInput): Float64Array {
  return packCollisionBoxes(compilePlacedSolids(input));
}

export function prepareFoundedSolids(scene: RealmFoundedScene, options: { readonly signal?: AbortSignal } = {}): Promise<readonly CollisionBox[]> {
  const input = foundedPlacedSolidsInput(scene), signal = options.signal;
  if (typeof Worker === 'undefined') return Promise.resolve(compilePlacedSolids(input));
  if (signal?.aborted) return Promise.reject(new DOMException('The kingdom closed', 'AbortError'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./terrain-founded-solids-worker.ts', import.meta.url), { type: 'module', name: 'founded-solids' }); }
    catch (error) { reject(error); return; }
    let finished = false;
    const finish = () => { finished = true; worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (finished) return; finish(); reject(error); };
    const abort = () => fail(new DOMException('The kingdom closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<FoundedSolidsReply>) => {
      if (finished) return;
      if ('error' in event.data) { fail(new Error(event.data.error)); return; }
      try { const boxes = unpackCollisionBoxes(event.data.boxes); finish(); resolve(boxes); }
      catch (error) { fail(error); }
    };
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The solids worker failed')); };
    worker.onmessageerror = () => fail(new Error('The solids worker sent unreadable boxes'));
    worker.postMessage(input);
  });
}
