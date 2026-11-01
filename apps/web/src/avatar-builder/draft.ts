import type { CitizenLook } from '../../../../packages/content/src/avatar-style';

/*
 * The builder's draft: the look being edited, with undo and redo. A draft is never a saved look; only the
 * look authority saves. Edits that belong together (dragging through a colour wheel) merge into one step.
 */

export interface LookHistory {
  readonly past: readonly CitizenLook[];
  readonly present: CitizenLook;
  readonly future: readonly CitizenLook[];
  /** The merge key of the last edit, so a run of the same edit is one undo step. */
  readonly lastKey: string | null;
}

/** How many steps undo remembers. */
export const HISTORY_DEPTH = 120;

export const startHistory = (look: CitizenLook): LookHistory => ({ past: [], present: look, future: [], lastKey: null });

const same = (a: CitizenLook, b: CitizenLook) => JSON.stringify(a) === JSON.stringify(b);

/** Records an edit. A no-op edit is not a step; an edit with the same `mergeKey` as the last replaces it. */
export function commit(h: LookHistory, look: CitizenLook, mergeKey: string | null = null): LookHistory {
  if (same(look, h.present)) return h;
  if (mergeKey && mergeKey === h.lastKey && h.past.length) return { ...h, present: look, future: [] };
  return { past: [...h.past, h.present].slice(-HISTORY_DEPTH), present: look, future: [], lastKey: mergeKey };
}

export function undo(h: LookHistory): LookHistory {
  const previous = h.past[h.past.length - 1];
  return previous ? { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastKey: null } : h;
}

export function redo(h: LookHistory): LookHistory {
  const next = h.future[0];
  return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1), lastKey: null } : h;
}

export const isUnchanged = (look: CitizenLook, saved: CitizenLook): boolean => same(look, saved);

/** Accept canonicalisation only if the draft is still the submitted look. */
export function reconcileSave(history: LookHistory, submitted: CitizenLook, canonical: CitizenLook): LookHistory {
  return same(history.present, submitted) ? { ...history, present: canonical, lastKey: null } : history;
}

/** Ignore a completion from a previous authority, external saved look, or disposed builder. */
export function createSaveGuard() {
  let generation = 0, disposed = false;
  return {
    ticket: () => generation,
    alive: () => !disposed,
    current: (ticket: number) => !disposed && ticket === generation,
    invalidate: () => { generation++; },
    dispose: () => { disposed = true; generation++; },
  };
}
