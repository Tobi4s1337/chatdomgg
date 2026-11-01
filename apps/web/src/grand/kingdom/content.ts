import type { ContentReply, ContentRequest } from './content-worker';
import type { KingdomPlacement } from './mount';
import type { GrandKingdomContent } from './pieces';

export interface GrandKingdomComposition {
  readonly content: GrandKingdomContent;
  /** Town walls and banners, placed in settlement metres like the content. */
  readonly dressing: readonly KingdomPlacement[];
  /** Why the walls could not be raised, when they could not; the town still stands. */
  readonly dressingError: string | null;
}

/** A kingdom's exact content and dressing, composed in its own worker so the land keeps rising and drawing meanwhile. */
export function composeGrandKingdom(login: string, signal?: AbortSignal): Promise<GrandKingdomComposition> {
  const worker = new Worker(new URL('./content-worker.ts', import.meta.url), { type: 'module', name: `grand-kingdom-${login}` });
  return new Promise<GrandKingdomComposition>((resolve, reject) => {
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('The kingdom was no longer wanted.')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<ContentReply>) => {
      finish();
      const reply = event.data;
      if (!reply.ok) { reject(new Error(reply.message)); return; }
      if (reply.dressingError) console.warn(`${reply.content.name}’s walls were not raised: ${reply.dressingError}`);
      resolve({ content: reply.content, dressing: reply.dressing, dressingError: reply.dressingError });
    };
    worker.onerror = event => { finish(); reject(new Error(event.message || 'The kingdom could not be composed.')); };
    worker.postMessage({ login } satisfies ContentRequest);
  });
}
