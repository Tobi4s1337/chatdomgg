import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { createSoulReviewHomeLoader, type HomeResponse } from './review-home-loader';

const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'worker-home', styleId: 'hearth', kind: 'home',
  lattice: 'build', size: [1, 1, 1], boxes: [], windows: [] });
class FakeWorker {
  onmessage: ((event: MessageEvent<HomeResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  respond(response: HomeResponse) { this.onmessage?.({ data: response } as MessageEvent<HomeResponse>); }
}
const setup = () => {
  const worker = new FakeWorker();
  const loader = createSoulReviewHomeLoader({ createWorker: () => worker as unknown as Worker });
  return { worker, loader };
};
const buffer = () => ({ position: new Float32Array([1, 2, 3]), normal: new Float32Array([0, 1, 0]) });
afterEach(() => vi.useRealTimers());

describe('home worker loader', () => {
  it('reuses one worker for serial jobs, ignores stale responses, and retains transferred buffers', async () => {
    const { worker, loader } = setup();
    const first = loader.load(blueprint, [], 1);
    await expect(loader.load(blueprint, [], 1)).rejects.toThrow(/active job/);
    worker.respond({ id: 999, surfaces: [], snow: buffer() });
    const positions = new Float32Array([2, 3, 4]);
    worker.respond({ id: 1, surfaces: [{ material: 1, data: { ...buffer(), position: positions, color: new Float32Array([1, 1, 1]) } }], snow: buffer() });
    const home = await first;
    expect(home!.surfaces[0]!.geometry.getAttribute('position').array).toBe(positions);
    expect(home!.surfaces[0]!.geometry.getAttribute('color')).toBeDefined();
    const second = loader.load(blueprint, [], 1);
    worker.respond({ id: 1, surfaces: [], snow: buffer() });
    worker.respond({ id: 2, surfaces: [], snow: buffer() });
    expect(await second).not.toBeNull();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    loader.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    await expect(loader.load(blueprint, [], 1)).rejects.toThrow(/disposed/);
  });

  it('settles active work and terminates once on disposal', async () => {
    const { worker, loader } = setup();
    const result = loader.load(blueprint, [], 1);
    loader.dispose();
    loader.dispose();
    expect(await result).toBeNull();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });

  it('rejects worker failures and closes the worker', async () => {
    const { worker, loader } = setup();
    const result = loader.load(blueprint, [], 1);
    worker.respond({ id: 1, error: 'meshing failed' });
    await expect(result).rejects.toThrow('meshing failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(loader.load(blueprint, [], 1)).rejects.toThrow(/disposed/);
  });

  it('rejects a malformed matching response instead of leaving its caller waiting', async () => {
    const { worker, loader } = setup();
    const result = loader.load(blueprint, [], 1);
    worker.respond(null as unknown as HomeResponse);
    worker.respond({ id: 1, surfaces: [{ material: 1, data: buffer() }],
      snow: { position: new Float32Array([1, 2]), normal: new Float32Array([0, 1]) } });
    await expect(result).rejects.toThrow(/Invalid home geometry/);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(loader.load(blueprint, [], 1)).rejects.toThrow(/disposed/);
  });

  it('times out and cleans up an unresponsive worker', async () => {
    vi.useFakeTimers();
    const { worker, loader } = setup();
    const result = loader.load(blueprint, [], 1);
    const rejection = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
