/** Timers the overlay can run on instead of the window's, so a review recording sees every beat on the stage's clock. */
export interface FishingUiTimers {
  set(run: () => void, ms: number): number;
  clear(id: number): void;
}

/** Fires each timer once the stage clock passed to `at` reaches it, in due order. */
export function createSteppedTimers(start = 0) {
  let now = start, next = 1;
  const due = new Map<number, { readonly at: number; readonly run: () => void }>();
  return {
    set(run: () => void, ms: number) { const id = next++; due.set(id, { at: now + Math.max(0, ms), run }); return id; },
    clear(id: number) { due.delete(id); },
    at(clock: number) {
      now = Math.max(now, clock);
      for (;;) {
        let first: [number, { readonly at: number; readonly run: () => void }] | null = null;
        for (const entry of due) if (entry[1].at <= now && (!first || entry[1].at < first[1].at)) first = entry;
        if (!first) return;
        due.delete(first[0]); first[1].run();
      }
    },
  } satisfies FishingUiTimers & { at(clock: number): void };
}
