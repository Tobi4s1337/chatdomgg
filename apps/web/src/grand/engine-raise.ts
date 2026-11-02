import { landMaterials } from '../../../../packages/world/src/grand/kits';
import { skyOcclusionMap } from '../../../../packages/world/src/grand/sky-map';
import type { GrandLand } from '../../../../packages/world/src/grand/types';
import { GrandEngine } from './engine';
import type { GrandWorkerReply, GrandWorkerRequest } from './worker';

/**
 * The bench's engine: it raises the land from its seed in workers in this browser and meshes it there. Only the
 * staged bench (`/-/grand-bench`) uses it; every public view draws baked land through `GrandEngine` alone.
 */
export class GrandRaisedEngine extends GrandEngine {
  async start(): Promise<void> {
    // Spec 56: the pool starts at min(4, max(1, cores − 2)); the land itself is raised by the first worker.
    const count = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `grand-land-${i}` });
      worker.onmessage = (event: MessageEvent<GrandWorkerReply>) => this.receive(worker, event.data);
      worker.onerror = event => this.failure?.(event.message || 'A land worker stopped.');
      this.workers.push(worker);
    }
    this.stats.workers = count;
    const started = performance.now();
    this.workers[0]!.postMessage({ type: 'generate', seed: this.seed } satisfies GrandWorkerRequest);
    await new Promise<void>(resolve => { this.landResolve = resolve; });
    this.stats.generateMillis = performance.now() - started;
    this.raf = requestAnimationFrame(this.frame);
  }

  protected override adoptRaised(land: GrandLand): void { this.adopt(land, landMaterials(land), skyOcclusionMap(land)); }
}
