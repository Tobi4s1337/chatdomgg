/**
 * Screen-error level choice for grand regions (spec 56 "LOD, continuity and shadows"), kept free of three.js
 * so it can be tested. `pixels(level)` is the projected cell size at the region's nearest point.
 */
export interface LodState {
  /** The level on screen now, or null while nothing covers the region. */
  shown: number | null;
  ideal: number;
  desired: number;
  /** When the region first qualified to coarsen (0 = not waiting). */
  coarsenSince: number;
}

export const LOD_REFINE = 1.2;
export const LOD_COARSEN = 0.8;
export const LOD_COARSEN_MS = 500;

/** The coarsest level whose cells are at most `target` px; level 0 when even that is too coarse. */
export function finestNeeded(pixels: (level: number) => number, target: number, levels: number): number {
  let level = levels - 1;
  while (level > 0 && pixels(level) > target) level--;
  return level;
}

/** Refine at once above 1.2× target; coarsen only when the next level stays below 0.8× for half a second. */
export function chooseLevel(state: LodState, pixels: (level: number) => number, target: number, levels: number, now: number): number {
  const ideal = finestNeeded(pixels, target, levels);
  const current = state.shown;
  if (current === null) { state.coarsenSince = 0; return state.ideal = ideal; }
  if (ideal < current) {
    state.coarsenSince = 0;
    return state.ideal = pixels(current) > target * LOD_REFINE ? ideal : current;
  }
  if (ideal > current) {
    if (!(pixels(current + 1) < target * LOD_COARSEN)) { state.coarsenSince = 0; return state.ideal = current; }
    if (!state.coarsenSince) { state.coarsenSince = now; return state.ideal = current; }
    return state.ideal = now - state.coarsenSince >= LOD_COARSEN_MS ? ideal : current;
  }
  state.coarsenSince = 0;
  return state.ideal = current;
}

/** Neighbouring regions differ by at most one level: a coarse region next to a fine one is refined. */
export function balanceLevels(states: readonly LodState[], neighbours: readonly (readonly number[])[], levels: number): void {
  for (const state of states) state.desired = state.ideal;
  for (let pass = 0; pass < levels; pass++) {
    let changed = false;
    states.forEach((state, i) => {
      for (const n of neighbours[i]!) if (state.desired > states[n]!.desired + 1) { state.desired = states[n]!.desired + 1; changed = true; }
    });
    if (!changed) return;
  }
}
