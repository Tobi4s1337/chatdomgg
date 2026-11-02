/* global Worker:readonly */
import type { GroundDressingPlan } from './plan';
import { planAdoptedCoverFor, type AdoptedCoverReply, type AdoptedCoverRequest } from './adopted-cover-request';

export type { AdoptedCoverRequest } from './adopted-cover-request';

/** Plans in a worker; without workers (tests, very old browsers) it plans here. Rejects on abort or failure. */
export function prepareAdoptedCover(request: AdoptedCoverRequest, options: { readonly signal?: AbortSignal } = {}): Promise<GroundDressingPlan> {
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('The kingdom closed', 'AbortError'));
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => planAdoptedCoverFor(request));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./adopted-cover-worker.ts', import.meta.url), { type: 'module', name: 'adopted-cover' }); }
    catch (error) { reject(error); return; }
    let finished = false;
    const finish = () => { finished = true; worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (finished) return; finish(); reject(error); };
    const abort = () => fail(new DOMException('The kingdom closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<AdoptedCoverReply>) => {
      if (finished) return;
      if ('error' in event.data) { fail(new Error(event.data.error)); return; }
      finish(); resolve(event.data.plan);
    };
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The cover worker failed')); };
    worker.onmessageerror = () => fail(new Error('The cover worker sent an unreadable plan'));
    // The heights are copied: the scene keeps its own window for the ground material.
    worker.postMessage(request);
  });
}
