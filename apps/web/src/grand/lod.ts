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

/** A region as the main-view budget sees it. `quads[level]` estimates what the main view submits at that level. */
export interface BudgetRegion {
  readonly state: LodState;
  readonly visible: boolean;
  /** Pinned to its only level (the installed town): counted, never coarsened. */
  readonly pinned: boolean;
  readonly quads: readonly number[];
  /** Projected cell size in pixels at the region's nearest point. */
  readonly pixels: (level: number) => number;
}
export interface LodBudget {
  /** Main-view land quads the estimate must fit. */
  readonly quads: number;
  /** No region is coarsened past this projected cell size, whatever the budget. */
  readonly maxPixels: number;
}
export interface BudgetFit { readonly estimated: number; readonly coarsened: number; readonly fits: boolean }

/** Estimated main-view quads of the visible regions at their balanced levels. */
export function budgetQuads(regions: readonly BudgetRegion[]): number {
  let total = 0;
  for (const region of regions) if (region.visible) total += region.quads[region.state.desired] ?? 0;
  return total;
}

/**
 * Spec 56's main-view triangle budget, met by coarsening where it shows least. After the screen-error choice and
 * balancing, while the visible land's estimate is over the budget, the visible region whose next level has the
 * smallest projected cell (the farthest, least visible detail) moves one level coarser, and the whole set is
 * balanced again. A region that balancing holds back (a finer neighbour) waits until a neighbour coarsens. Near
 * land, the pinned town and anything that would pass `maxPixels` never coarsen, so the budget can stay unmet.
 * For a still camera the result depends only on the camera, so it never flickers between frames.
 */
export function fitLodBudget(regions: readonly BudgetRegion[], neighbours: readonly (readonly number[])[], budget: LodBudget, levels: number): BudgetFit {
  const states = regions.map(region => region.state);
  let estimated = budgetQuads(regions), coarsened = 0;
  const held = new Set<number>();
  while (estimated > budget.quads) {
    let pick = -1, smallest = Infinity;
    regions.forEach((region, index) => {
      const level = region.state.desired;
      if (!region.visible || region.pinned || held.has(index) || level >= levels - 1) return;
      const pixels = region.pixels(level + 1);
      if (pixels <= budget.maxPixels && pixels < smallest) { smallest = pixels; pick = index; }
    });
    if (pick < 0) break;
    const state = states[pick]!, before = state.desired;
    state.ideal = Math.max(state.ideal, before + 1);
    balanceLevels(states, neighbours, levels);
    if (state.desired === before) { held.add(pick); continue; }
    held.clear(); coarsened++;
    estimated = budgetQuads(regions);
  }
  return { estimated, coarsened, fits: estimated <= budget.quads };
}
