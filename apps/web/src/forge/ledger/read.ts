import { FORGE_LEDGER_LIMITS, FORGE_LEDGER_ROUTE, ForgeLedgerViewSchema, KingdomIdSchema, type ForgeLedgerView, type KingdomId } from '@chatdom/shared';

/*
 * "The forge remembers", read from the realm's public route. The same reader serves the wall at the forge and the
 * ledger page. It never sends a session: the ledger is the same for everyone.
 */

/** What a read can say: the ledger, or that this kingdom has no forge (yet). Anything else throws. */
export type ForgeLedgerAnswer = { readonly kind: 'ledger'; readonly view: ForgeLedgerView } | { readonly kind: 'no-forge' };
export type ForgeLedgerRead = (kingdomId: KingdomId, signal: AbortSignal) => Promise<ForgeLedgerAnswer>;

export const browserForgeLedgerRead: ForgeLedgerRead = async (kingdomId, signal) => {
  const response = await fetch(`${FORGE_LEDGER_ROUTE}?${new URLSearchParams({ kingdomId })}`, {
    method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' }, signal,
  });
  if (response.status === 404) return { kind: 'no-forge' };
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!response.ok || !/^application\/(?:[\w.-]+\+)?json$/i.test(contentType)) throw new Error('The forge’s memory could not be read.');
  const view = parseForgeLedger(await response.json(), kingdomId);
  if (!view) throw new Error('The forge’s memory could not be read.');
  return { kind: 'ledger', view };
};

/** A body counts only when it matches the contract and is about the kingdom asked for. */
export function parseForgeLedger(body: unknown, kingdomId: KingdomId): ForgeLedgerView | null {
  const parsed = ForgeLedgerViewSchema.safeParse(body);
  return parsed.success && parsed.data.kingdomId === kingdomId ? parsed.data : null;
}

/** Loading until the first answer; a failure keeps what was shown and says so only when nothing was. */
export type ForgeLedgerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ledger'; readonly view: ForgeLedgerView }
  | { readonly kind: 'no-forge' }
  | { readonly kind: 'unavailable' };

export interface ForgeLedgerWatch {
  state(): ForgeLedgerState;
  /** Replays the current state at once, then every change. */
  subscribe(listener: (state: ForgeLedgerState) => void): () => void;
  dispose(): void;
}

/**
 * Read now, then every `FORGE_LEDGER_LIMITS.pollMs` while the owner is open. Reads never overlap. A newer piece
 * appears on its own; an answer older than the one shown never rolls the ledger back.
 */
export function watchForgeLedger(kingdomId: string, options: { readonly read?: ForgeLedgerRead; readonly pollMs?: number } = {}): ForgeLedgerWatch {
  const read = options.read ?? browserForgeLedgerRead, pollMs = options.pollMs ?? FORGE_LEDGER_LIMITS.pollMs;
  const id = KingdomIdSchema.safeParse(kingdomId), abort = new AbortController(), listeners = new Set<(state: ForgeLedgerState) => void>();
  let state: ForgeLedgerState = id.success ? { kind: 'loading' } : { kind: 'no-forge' };
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  const publish = (next: ForgeLedgerState) => { state = next; for (const listener of [...listeners]) listener(next); };
  const tick = async () => {
    timer = undefined;
    if (disposed || !id.success) return;
    try {
      const answer = await read(id.data, abort.signal);
      if (disposed) return;
      if (answer.kind === 'no-forge') { if (state.kind !== 'no-forge') publish(answer); }
      else if (state.kind !== 'ledger' || answer.view.at >= state.view.at) {
        if (state.kind !== 'ledger' || sameLedger(state.view, answer.view) === false) publish({ kind: 'ledger', view: answer.view });
        else state = { kind: 'ledger', view: answer.view };
      }
    } catch { if (!disposed && state.kind === 'loading') publish({ kind: 'unavailable' }); }
    if (!disposed) timer = setTimeout(() => void tick(), pollMs);
  };
  void tick();
  return {
    state: () => state,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener); listener(state);
      return () => { listeners.delete(listener); };
    },
    dispose() { disposed = true; abort.abort(); if (timer) clearTimeout(timer); listeners.clear(); },
  };
}

/** Same pieces, names and order: nothing a reader would see has changed. */
export function sameLedger(a: ForgeLedgerView, b: ForgeLedgerView): boolean {
  return a.total === b.total && a.entries.length === b.entries.length
    && a.entries.every((entry, i) => { const other = b.entries[i]!; return entry.id === other.id && entry.maker.name === other.maker.name && entry.copies === other.copies; });
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const DAY_SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
/** "Wished for by Wren · 2 November 2026" — the line under every remembered piece. */
export function forgeLedgerByline(entry: ForgeLedgerView['entries'][number], now = Date.now(), short = false): string {
  const at = new Date(entry.forgedAt), year = new Date(now).getFullYear() === at.getFullYear();
  const day = short || year ? DAY_SHORT.format(at) : DAY.format(at);
  // The line may break only after the dot: a date never splits across lines and never starts one alone.
  return `${entry.maker.name}\u00a0· ${day.replaceAll(' ', '\u00a0')}`;
}

/** The copies line, only once copies exist. */
export function forgeLedgerCopies(entry: ForgeLedgerView['entries'][number]): string | null {
  return entry.copies ? `On ${entry.copies} homes` : null;
}

/** One quiet sentence over the list. */
export function forgeLedgerSummary(view: ForgeLedgerView): string {
  if (view.total === 0) return 'Nothing has been forged here yet. The first wish made at the anvil will be remembered here.';
  const count = view.total === 1 ? 'One piece has' : `${view.total} pieces have`;
  return view.entries.length < view.total ? `${count} been forged in this kingdom. The newest ${view.entries.length} are shown.` : `${count} been forged in this kingdom.`;
}
