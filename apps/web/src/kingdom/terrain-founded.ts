/* global Worker:readonly */
import { terrainHeight, type SettlementPlan } from '@chatdom/world';
import { foundedTerrainFrame } from '@chatdom/world/founded-collision';

/**
 * The installed ground the opening needs before it can place anything: the founded collision grid (half-metre
 * cell centres, the walking floor) and the metre height texture the ground material shades with. Both are pure
 * functions of the plan. Computing them is the heaviest work of opening a kingdom, so it runs in workers split
 * into row bands while the main thread builds the scene and the land downloads. The same code runs either side,
 * so the values are identical to sampling on the main thread.
 */
export interface FoundedGroundWindow { readonly origin: readonly [number, number]; readonly width: number; readonly depth: number }
export interface FoundedGroundBand {
  readonly part: number; readonly parts: number;
  /** Collision rows [from, to) of the founded frame, or null when the plan has no installed sampler. */
  readonly floor: { readonly from: number; readonly to: number; readonly heights: Float32Array } | null;
  /** Height-texture rows [from, to) of the window. */
  readonly height: { readonly from: number; readonly to: number; readonly heights: Float32Array };
}
export interface FoundedGround {
  /** Absolute rounded floor tops in the exact layout of `sampleFoundedTerrain`, or null without a sampler. */
  readonly floor: Float32Array | null;
  readonly height: Float32Array;
  readonly window: FoundedGroundWindow;
}
export interface FoundedGroundRequest { readonly plan: SettlementPlan; readonly window: FoundedGroundWindow; readonly part: number; readonly parts: number }

/** The metre height window the scene's ground material samples: the plan's bounds and a 20 m skirt. */
export function foundedGroundWindow(plan: SettlementPlan): FoundedGroundWindow {
  const origin: [number, number] = [Math.floor(plan.bounds.minX) - 20, Math.floor(plan.bounds.minZ) - 20];
  return { origin, width: Math.ceil(plan.bounds.maxX - origin[0]) + 21, depth: Math.ceil(plan.bounds.maxZ - origin[1]) + 21 };
}

function band(total: number, part: number, parts: number): [number, number] {
  return [Math.floor(total * part / parts), Math.floor(total * (part + 1) / parts)];
}

/** One band of both grids. Mirrors `sampleFoundedTerrain` and the scene's height loop exactly. */
export function sampleFoundedGroundBand({ plan, window, part, parts }: FoundedGroundRequest): FoundedGroundBand {
  if (!Number.isInteger(parts) || parts < 1 || !Number.isInteger(part) || part < 0 || part >= parts) throw new RangeError('A ground band needs a part of its parts');
  const frame = foundedTerrainFrame(plan);
  let floor: FoundedGroundBand['floor'] = null;
  if (frame) {
    const [from, to] = band(frame.rows, part, parts), heights = new Float32Array((to - from) * frame.columns);
    for (let row = from; row < to; row++) for (let column = 0; column < frame.columns; column++) {
      heights[column + frame.columns * (row - from)] = frame.sample(column, row);
    }
    floor = { from, to, heights };
  }
  const [from, to] = band(window.depth, part, parts), heights = new Float32Array((to - from) * window.width);
  for (let z = from; z < to; z++) for (let x = 0; x < window.width; x++) {
    heights[x + (z - from) * window.width] = terrainHeight(plan, window.origin[0] + x, window.origin[1] + z);
  }
  return { part, parts, floor, height: { from, to, heights } };
}

/** Joins every band of one request, checking that each row was produced exactly once. */
export function joinFoundedGround(plan: SettlementPlan, window: FoundedGroundWindow, bands: readonly FoundedGroundBand[]): FoundedGround {
  const frame = foundedTerrainFrame(plan);
  const height = new Float32Array(window.width * window.depth), floor = frame ? new Float32Array(frame.columns * frame.rows) : null;
  let heightRows = 0, floorRows = 0;
  for (const part of [...bands].sort((a, b) => a.part - b.part)) {
    if (part.parts !== bands.length) throw new Error('A founded ground band belongs to another split');
    const [from, to] = band(window.depth, part.part, part.parts);
    if (part.height.from !== from || part.height.to !== to || part.height.heights.length !== (to - from) * window.width) throw new Error('A founded ground band has the wrong height rows');
    height.set(part.height.heights, from * window.width); heightRows += to - from;
    if (frame && floor) {
      const [start, end] = band(frame.rows, part.part, part.parts);
      if (!part.floor || part.floor.from !== start || part.floor.to !== end || part.floor.heights.length !== (end - start) * frame.columns) throw new Error('A founded ground band has the wrong floor rows');
      floor.set(part.floor.heights, start * frame.columns); floorRows += end - start;
    } else if (part.floor) throw new Error('A founded ground band sampled a floor this plan does not have');
  }
  if (heightRows !== window.depth || (frame && floorRows !== frame.rows)) throw new Error('The founded ground bands do not cover their window');
  return { floor, height, window };
}

/**
 * Samples the installed ground in up to three workers. Without workers (tests, very old browsers) it samples
 * here. Rejects on abort or a worker failure; there is no partial result.
 */
export function prepareFoundedGround(plan: SettlementPlan, options: { readonly signal?: AbortSignal; readonly parts?: number } = {}): Promise<FoundedGround> {
  const window = foundedGroundWindow(plan);
  if (typeof Worker === 'undefined') return Promise.resolve(joinFoundedGround(plan, window, [sampleFoundedGroundBand({ plan, window, part: 0, parts: 1 })]));
  const parts = options.parts ?? Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('The kingdom closed', 'AbortError'));
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [], bands: FoundedGroundBand[] = [];
    let finished = false;
    const stop = () => { for (const worker of workers) worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (finished) return; finished = true; stop(); reject(error); };
    const abort = () => fail(new DOMException('The kingdom closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    for (let part = 0; part < parts; part++) {
      let worker: Worker;
      try { worker = new Worker(new URL('./terrain-founded-worker.ts', import.meta.url), { type: 'module', name: 'founded-ground' }); }
      catch (error) { fail(error); return; }
      workers.push(worker);
      worker.onmessage = (event: MessageEvent<FoundedGroundBand | { readonly error: string }>) => {
        if (finished) return;
        if ('error' in event.data) { fail(new Error(event.data.error)); return; }
        bands.push(event.data); worker.terminate();
        if (bands.length < parts) return;
        try { const ground = joinFoundedGround(plan, window, bands); finished = true; stop(); resolve(ground); }
        catch (error) { fail(error); }
      };
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The ground worker failed')); };
      worker.onmessageerror = () => fail(new Error('The ground worker sent an unreadable band'));
      worker.postMessage({ plan, window, part, parts } satisfies FoundedGroundRequest);
    }
  });
}
