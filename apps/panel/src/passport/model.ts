// The passport panel's own small decisions, kept free of JSX and CSS so they can be tested on their own.
import type { PageDensity, PassportReadState } from '@chatdom/ui/passport';

/**
 * One stamp to a leaf: at the panel's width a stamp beside its caption would squeeze a long kingdom name into a
 * column of fragments. Alone on its leaf the stamp is pressed large and every word underneath reads whole. Lists
 * keep three entries, so a leaf of ordinary names never needs to scroll.
 */
export const PANEL_DENSITY = { stamps: 1, entries: 3 } as const satisfies PageDensity;

/** Whether what is on screen came from SIMULATED authorities: the surface says so, or the book itself does. */
export function simulatedOrigin(state: PassportReadState, surface: boolean): boolean {
  if (surface) return true;
  if (state.kind === 'visible') return state.book.origin === 'simulated';
  return state.kind === 'hidden' && state.origin === 'simulated';
}
