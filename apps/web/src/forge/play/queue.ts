import {
  FORGE_QUEUE_LIMITS, FORGE_QUEUE_ROUTE, ForgeQueueViewSchema, KingdomIdSchema,
  type ForgeQueueState, type ForgeQueueView, type KingdomId,
} from '@chatdom/shared';

/*
 * The anvil's line, as the Forge says it. Several wishes are drafted at once, but the stream sees one ritual at a
 * time, in arrival order; this module reads that line from the realm while a Forge surface is open and turns it into
 * one short sentence (and, for the broadcaster only, the makers' names in order). It never carries a wish's words.
 */

/** Reads the raw body of the queue route. Anything it throws, or any body that fails the contract, is ignored. */
export type ForgeQueueRead = (kingdomId: KingdomId, signal: AbortSignal) => Promise<unknown>;

/** Same-origin GET; the session cookie travels on its own so the realm can answer `yours` and `makers`. */
export const browserForgeQueueRead: ForgeQueueRead = async (kingdomId, signal) => {
  const response = await fetch(`${FORGE_QUEUE_ROUTE}?${new URLSearchParams({ kingdomId })}`, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal,
  });
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!response.ok || !/^application\/(?:[\w.-]+\+)?json$/i.test(contentType)) throw new Error('The anvil’s line could not be read.');
  return response.json();
};

/** A body counts only when it matches the contract and is about the kingdom asked for. */
export function parseForgeQueue(body: unknown, kingdomId: KingdomId): ForgeQueueView | null {
  const parsed = ForgeQueueViewSchema.safeParse(body);
  return parsed.success && parsed.data.kingdomId === kingdomId ? parsed.data : null;
}

export interface ForgeQueueWatch {
  /** The last view the realm gave, or null before the first good read. A failed read never clears it. */
  view(): ForgeQueueView | null;
  /** Replays the current view (if any) at once, then every newer one. */
  subscribe(listener: (view: ForgeQueueView) => void): () => void;
  dispose(): void;
}

export interface ForgeQueueWatchOptions {
  readonly read?: ForgeQueueRead;
  readonly pollMs?: number;
}

/**
 * Poll the line every `FORGE_QUEUE_LIMITS.pollMs` while the surface that owns this watch is open. Reads never
 * overlap: the next one is scheduled when the last one settles. Disposing aborts a read in flight and stops for good.
 * Failures stay quiet: the last good view stays on screen and no error is shown.
 */
export function watchForgeQueue(kingdomId: string, options: ForgeQueueWatchOptions = {}): ForgeQueueWatch {
  const read = options.read ?? browserForgeQueueRead;
  const pollMs = options.pollMs ?? FORGE_QUEUE_LIMITS.pollMs;
  const id = KingdomIdSchema.safeParse(kingdomId);
  const abort = new AbortController();
  const listeners = new Set<(view: ForgeQueueView) => void>();
  let view: ForgeQueueView | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const tick = async () => {
    timer = undefined;
    if (disposed || !id.success) return;
    try {
      const next = parseForgeQueue(await read(id.data, abort.signal), id.data);
      // An answer older than the one on screen (a slow read overtaken by a newer one) never rolls the line back.
      if (!disposed && next && (!view || next.at >= view.at)) {
        view = next;
        for (const listener of [...listeners]) listener(next);
      }
    } catch { /* Quiet by design: keep the last view. */ }
    if (!disposed) timer = setTimeout(() => void tick(), pollMs);
  };
  void tick();
  return {
    view: () => view,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      if (view) listener(view);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort(); clearTimeout(timer); timer = undefined; listeners.clear();
    },
  };
}

/** `resting`: nothing at the anvil. `working`: a ritual is under way. `slow`: it has run past `slowMs`. */
export type ForgeQueueTone = 'resting' | 'working' | 'slow';
export interface ForgeQueueCopy {
  readonly line: string;
  readonly tone: ForgeQueueTone;
  /** The line speaks about the reader's own wish. */
  readonly yours: boolean;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** Small counts read as words, the way the smith would say them; larger ones keep their numerals. */
const count = (n: number) => WORDS[n] ?? String(n);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether the ritual at the anvil has run long, measured on the realm's own clock so a skewed device cannot lie. */
export function forgeQueueSlow(view: ForgeQueueView): boolean {
  return view.forgingSince !== null && view.at - view.forgingSince >= FORGE_QUEUE_LIMITS.slowMs;
}

/**
 * One short sentence for the line, in the Forge's voice. For the signed-in maker their own place wins; everyone else
 * hears how the anvil stands and how many wait. Null before the realm has answered: say nothing rather than guess.
 * Beside the anvil card's fire line (`where: 'anvil'`) the fire already says whether the smith is at work, so the
 * line only adds who waits; a slow ritual and the maker's own place are always said.
 */
export function forgeQueueCopy(view: ForgeQueueView | null, where: 'panel' | 'anvil' = 'panel'): ForgeQueueCopy | null {
  if (!view) return null;
  const forging = view.forgingSince !== null;
  const slow = forgeQueueSlow(view);
  const tone: ForgeQueueTone = slow ? 'slow' : forging ? 'working' : 'resting';
  if (view.yours) {
    const { position, state } = view.yours;
    if (state === 'forging') {
      return { tone, yours: true, line: slow ? 'Yours is at the anvil, and the smith is taking care with it. A moment more.' : 'Yours is at the anvil now.' };
    }
    if (position <= 1) {
      return { tone, yours: true, line: slow ? 'Yours is next. The smith is taking care with the one before it.' : 'Yours is next.' };
    }
    const ahead = `${capital(count(position))} wishes are ahead of yours.`;
    return { tone, yours: true, line: slow ? `${ahead} The smith is taking care with the one at the anvil.` : ahead };
  }
  // With nothing at the anvil every wish in the line is still waiting its turn.
  const waiting = forging ? view.waiting : Math.max(view.total, view.waiting);
  const wait = waiting === 1 ? 'One wish waits its turn.' : `${capital(count(waiting))} wishes wait their turn.`;
  const care = 'The smith is taking care with this one. A moment more.';
  if (slow) return { tone, yours: false, line: waiting ? `${care} ${wait}` : care };
  if (where === 'anvil') return { tone, yours: false, line: waiting ? wait : forging ? 'No other wish waits its turn.' : 'No wish waits. Yours would go straight to the anvil.' };
  if (forging) return { tone, yours: false, line: waiting ? `The smith is at work. ${wait}` : 'The smith is at work. No other wish waits.' };
  return { tone, yours: false, line: waiting ? wait : 'The anvil rests. The next wish goes straight to it.' };
}

export interface ForgeQueueRow {
  readonly position: number;
  /** The approved name the citizen card shows. */
  readonly name: string;
  readonly state: ForgeQueueState;
  readonly label: 'at the anvil' | 'waiting';
}
export interface ForgeQueueMakers {
  readonly rows: readonly ForgeQueueRow[];
  /** Wishes in the line beyond the names the realm sends. */
  readonly more: number;
}

/** The broadcaster's ordered list: names and places only, never words. Null for everyone else, or an empty line. */
export function forgeQueueMakers(view: ForgeQueueView | null): ForgeQueueMakers | null {
  if (!view?.makers) return null;
  const rows = [...view.makers].sort((a, b) => a.position - b.position)
    .map(maker => ({ position: maker.position, name: maker.name, state: maker.state, label: maker.state === 'forging' ? 'at the anvil' as const : 'waiting' as const }));
  const more = Math.max(0, view.total - rows.length);
  return rows.length || more ? { rows, more } : null;
}

/** How the list closes when the realm sent fewer names than wishes. */
export function forgeQueueMoreLine(more: number): string | null {
  return more > 0 ? `${capital(count(more))} more ${more === 1 ? 'waits' : 'wait'} after these.` : null;
}
