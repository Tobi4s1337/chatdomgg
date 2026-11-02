import stampSheetUrl from './assets/stamps.webp?url';
import type { SheetMessage } from './map/bake.worker';

/**
 * The first frame's head start. Before it can draw anything, a map needs the preview pointer, the world file that
 * pointer names, and the still's bakers with their stamp sheet decoded. None of them needs the scene's code, so they
 * are asked for here, the moment `mountAtlas` runs, and travel beside the scene chunk instead of after it. (Measured
 * on a real GPU with a phone profile, the pointer used to be asked for a second after the map mounted, and the
 * stamp sheet only once the world had been read.)
 *
 * The scene takes each answer once, by URL, through `take`; the still takes the bakers once, through `bakers`.
 * Anything not taken is dropped by `done`: reads in flight are aborted and bakers are terminated. A head start
 * that fails is never an error: the reader simply asks again, the ordinary way. This module has no runtime imports
 * beyond two asset URLs, so the embed's entry stays small.
 */
export interface HeadStart {
  /** The early answer for this URL, once, bound to `init.signal`; null when there is none (fetch as usual). */
  take(url: string, init?: RequestInit): Promise<Response> | null;
  /** The still's bakers, already loading the stamp sheet; given once (the still owns and terminates them after). */
  bakers(): Worker[];
  /** Drop whatever was not taken. Safe to call more than once. */
  done(): void;
}

interface Early { response: Promise<Response>; controller: AbortController }
interface Baker { worker: Worker; failed: boolean }

/** A pointer's preview ID as it may appear in a URL path; anything else gets no early world read. */
const PREVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
/** As many bakers as the still makes for itself (`still/bake.ts`). */
export const bakerCount = (cores: number | undefined): number => Math.max(1, Math.min(4, (cores || 2) - 1));

export function headStart(base: string, options: { fetch?: typeof fetch; bakers?: boolean } = {}): HeadStart {
  const fetcher = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const early = new Map<string, Early>();
  const workers: Baker[] = [];
  let finished = false;

  const ask = (url: string): Early => {
    const controller = new AbortController();
    // The same request the scene's reader makes (`data/preview.ts` getBytes), so its answer can stand in for it.
    const response = fetcher(url, { signal: controller.signal, credentials: 'omit' });
    response.catch(() => undefined);
    const entry = { response, controller };
    early.set(url, entry);
    return entry;
  };

  // The pointer, then the world it names: two round trips that no longer wait for the scene's code.
  const pointer = ask(`${base}/v1/preview`);
  void pointer.response
    .then(async (response) => {
      if (!response.ok || finished) return;
      const value = await response.clone().json() as { id?: unknown };
      if (finished || typeof value?.id !== 'string' || !PREVIEW_ID.test(value.id)) return;
      ask(`${base}/v1/preview/${value.id}/world.json`);
    })
    .catch(() => undefined);

  if (options.bakers !== false && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    const count = bakerCount(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
    for (let i = 0; i < count; i++) {
      try {
        const worker = new Worker(new URL('./map/bake.worker.ts', import.meta.url), { type: 'module', name: `atlas-still-baker-${i}` });
        const baker: Baker = { worker, failed: false };
        // A baker that cannot start is not handed over: the still would otherwise wait out its silence.
        worker.onerror = (event) => {
          event.preventDefault();
          baker.failed = true;
        };
        worker.onmessageerror = () => { baker.failed = true; };
        worker.postMessage({ type: 'sheet', stampsUrl: stampSheetUrl } satisfies SheetMessage);
        workers.push(baker);
      } catch {
        break;
      }
    }
  }

  return {
    take(url, init) {
      const entry = early.get(url);
      if (!entry || finished) return null;
      early.delete(url);
      const signal = init?.signal;
      if (signal?.aborted) entry.controller.abort();
      else signal?.addEventListener('abort', () => entry.controller.abort(), { once: true });
      // A head start that failed (or was dropped) is asked again exactly as the reader would have asked it.
      return entry.response.catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return fetcher(url, init);
      });
    },
    bakers() {
      const handed: Worker[] = [];
      for (const baker of workers.splice(0)) {
        if (baker.failed || finished) {
          baker.worker.terminate();
          continue;
        }
        baker.worker.onerror = null;
        baker.worker.onmessageerror = null;
        handed.push(baker.worker);
      }
      return handed;
    },
    done() {
      if (finished) return;
      finished = true;
      for (const entry of early.values()) entry.controller.abort();
      early.clear();
      for (const baker of workers.splice(0)) baker.worker.terminate();
    },
  };
}
