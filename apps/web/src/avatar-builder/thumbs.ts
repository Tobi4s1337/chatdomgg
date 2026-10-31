import type { CitizenLook } from '../../../../packages/content/src/avatar-style';
import { createPortraitRenderer, type PortraitRenderer, type PortraitView } from './portrait-renderer';

/*
 * Builder tiles are small renders of the actual piece on your own citizen, lit like the portrait (Artstyle §11:
 * items are shown as small renders of the actual voxel item). One renderer paints them all, one at a time
 * between frames so the page stays responsive; requests a tab no longer shows are dropped, and finished
 * pictures are kept for when the same look comes round again (undo, flipping tabs).
 */

export interface ThumbRequest {
  readonly look: CitizenLook;
  readonly view: PortraitView;
  readonly size: number;
  readonly dim?: boolean | undefined;
  /** Gradient behind the citizen (the portrait) rather than transparent (a tile on parchment). */
  readonly backdrop?: boolean | undefined;
}

export interface ThumbPainter {
  /** Resolves with a data URL; rejects with an AbortError if `signal` aborts first. */
  paint(request: ThumbRequest, signal?: AbortSignal): Promise<string>;
  dispose(): void;
}

const CACHE = 600;

export function createThumbPainter(): ThumbPainter {
  let renderer: PortraitRenderer | null = null;
  const cache = new Map<string, string>();
  const queue: { key: string; request: ThumbRequest; signal?: AbortSignal | undefined; resolve(url: string): void; reject(e: unknown): void }[] = [];
  let running = false;

  const pump = () => {
    if (running) return;
    running = true;
    const step = () => {
      // In order, so a grid fills from the top; anything a closed tab or an older look asked for is skipped.
      let job = queue.shift();
      while (job?.signal?.aborted) { job.reject(new DOMException('Not needed any more.', 'AbortError')); job = queue.shift(); }
      if (!job) { running = false; return; }
      const hit = cache.get(job.key);
      if (hit) job.resolve(hit);
      else {
        try {
          renderer ??= createPortraitRenderer();
          const { look, size, view, dim, backdrop } = job.request;
          const url = renderer.render(look, size, { view, dim, transparent: !backdrop }).toDataURL('image/png');
          cache.set(job.key, url);
          if (cache.size > CACHE) cache.delete(cache.keys().next().value!);
          job.resolve(url);
        } catch (error) { job.reject(error); }
      }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  };

  return {
    paint(request, signal) {
      const key = `${request.view}:${request.size}:${request.dim ? 1 : 0}:${request.backdrop ? 1 : 0}:${JSON.stringify(request.look)}`;
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        queue.push({ key, request, signal, resolve, reject });
        pump();
      });
    },
    dispose() {
      queue.length = 0;
      cache.clear();
      renderer?.dispose();
      renderer = null;
    },
  };
}
