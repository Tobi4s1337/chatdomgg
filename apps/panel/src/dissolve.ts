import { createEffect, createSignal, on, type Accessor } from 'solid-js';

/**
 * A painting that replaces another rises out of it instead of cutting in. The view keeps the replaced painting as an
 * underlay, hides the new one until it has loaded and been drawn once, then fades it in over the old one. The adapter
 * keeps the replaced painting's blob readable until the next swap, so the underlay always has something to show.
 */
export interface Shown { readonly url: string }

export type DissolveStep<T extends Shown> =
  | { readonly kind: 'keep' }
  | { readonly kind: 'cut' }
  | { readonly kind: 'dissolve'; readonly under: T | null };

export interface DissolveRules {
  /** The view is on screen, so a fade can be seen. */
  readonly active: boolean;
  /** The viewer asked for reduced motion. */
  readonly calm: boolean;
  /** A first painting also fades in, out of whatever the view draws behind it. */
  readonly fromNothing?: boolean;
}

/** What a change from `shown` to `next` does. Only a changed picture moves anything. */
export function dissolveStep<T extends Shown>(shown: T | null, next: T | null, rules: DissolveRules): DissolveStep<T> {
  if (next?.url === shown?.url) return { kind: 'keep' };
  if (!next || !rules.active || rules.calm) return { kind: 'cut' };
  if (shown) return { kind: 'dissolve', under: shown };
  return rules.fromNothing ? { kind: 'dissolve', under: null } : { kind: 'cut' };
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createDissolve<T extends Shown>(current: Accessor<T | null>, active: () => boolean, options: { fromNothing?: boolean } = {}) {
  const [under, setUnder] = createSignal<T | null>(null);
  const [settling, setSettling] = createSignal(false);
  let shown: T | null = null;
  createEffect(on(current, next => {
    const step = dissolveStep(shown, next, { active: active(), calm: reducedMotion(), ...options });
    if (step.kind === 'dissolve') { setUnder(() => step.under); setSettling(true); }
    else if (step.kind === 'cut') { setUnder(null); setSettling(false); }
    shown = next;
  }));
  return {
    under,
    settling,
    /** The new painting's load handler. Two frames, so it has been drawn once before its fade begins. */
    reveal: () => { if (settling()) requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false))); },
    /** The new painting's transitionend handler: once it is fully in, the underlay goes. */
    settled: (event: TransitionEvent) => { if (event.propertyName === 'opacity' && !settling()) setUnder(null); },
  };
}
