import { afterEach, expect, it, vi } from 'vitest';
import { generateKingdom } from '@chatdom/world';
import { createLightField } from '../kingdom/light-field';
import { resolveLightFieldConfig, type LightFieldRequest, type LightFieldResponse } from '../kingdom/light-field-worker';

afterEach(() => vi.unstubAllGlobals());

it('keeps a pending publication light solve on the new occupancy and rejects responses from the old worker', () => {
  class TestWorker {
    static instances: TestWorker[] = [];
    onmessage: ((event: MessageEvent<LightFieldResponse>) => void) | null = null;
    onerror = null; onmessageerror = null;
    posted: LightFieldRequest[] = []; terminated = false;
    constructor() { TestWorker.instances.push(this); }
    postMessage(request: LightFieldRequest) { this.posted.push(request); }
    terminate() { this.terminated = true; }
    respond(data: LightFieldResponse) { this.onmessage?.({ data } as MessageEvent<LightFieldResponse>); }
  }
  vi.stubGlobal('Worker', TestWorker);
  const layout = generateKingdom({ seed: 'published-home', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const options = { mode: 'beacon', position: [0, 20, 0] as const } as const;
  const config = resolveLightFieldConfig(layout, options), onVolume = vi.fn();
  const field = createLightField(layout, [], onVolume, undefined, options);
  try {
    const old = TestWorker.instances[0]!;
    old.respond({ kind: 'ready' });
    field.update([0, 20, 0], [{ position: [0, 20, 0], strength: 1 }]);
    const late = old.onmessage!;
    field.update([0, 20, 0], [{ position: [0, 20, 0], strength: .5 }]);
    field.replaceHouses([]);
    expect(old.terminated).toBe(true);
    const current = TestWorker.instances[1]!;
    late({ data: { kind: 'error', revision: null, message: 'The retired worker failed.' } } as MessageEvent<LightFieldResponse>);
    late({ data: { kind: 'ready' } } as MessageEvent<LightFieldResponse>);
    expect(field.stats.failed).toBe(false); expect(current.posted).toHaveLength(1);
    current.respond({ kind: 'ready' });
    const solve = current.posted[1]!;
    expect(solve).toMatchObject({ kind: 'solve', revision: 3, emitters: [{ level: 8 }] });
    if (solve.kind !== 'solve') throw new Error('Expected the replacement solve');
    current.respond({ kind: 'volume', revision: solve.revision, solveMs: 1, occupancyBuilds: 1,
      volume: { revision: solve.revision, origin: solve.origin, size: config.size, cellSize: config.cellSize,
        light: new Uint8Array(config.cells), surfaceSamples: new Uint8Array(config.size.reduce((n, axis) => n * (axis + 1), 1)),
        visited: 0, estimatedPeakBytes: 1 } });
    expect(onVolume).toHaveBeenCalledTimes(1);
    expect(field.stats).toMatchObject({ requestedRevision: 3, publishedRevision: 3, busy: false, queued: false, discardedJobs: 1 });
  } finally { field.dispose(); }
});
