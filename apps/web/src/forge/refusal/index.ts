import type * as THREE from 'three';
import type { ForgePublicBeat } from '@chatdom/shared';
import { createForgeMoodLayers } from './layers';
import { FORGE_MOOD_DURATION, captionPose, type ForgeMoodMotion } from './timeline';

export { FORGE_MOOD_DURATION, FORGE_MOOD_PHASES, type ForgeMoodMotion } from './timeline';
export { FORGE_MOOD_EMBERS, FORGE_MOOD_SOOT } from './layers';

/** Host class for the dedicated caption node; styles live in `./caption.css`. */
export const FORGE_MOOD_CAPTION_CLASS = 'forge-mood-line';

/** One shared pool for every cause. The supplied variant is the only selector. */
export const FORGE_MOOD_LINES = ['The forge is in a mood tonight.', 'The bellows need a little breather.', 'Even the anvil has its moments.'] as const;

export type ForgeRefusalBeat = Extract<ForgePublicBeat, { kind: 'refusal' }>;

export interface ForgeRefusalPresentation {
  play(beat: ForgeRefusalBeat): void;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

/** Exactly the refusal arm and nothing riding along with it: anything richer is not a public beat. */
const isRefusalBeat = (beat: unknown): beat is ForgeRefusalBeat => {
  if (typeof beat !== 'object' || beat === null || Array.isArray(beat)) return false;
  const keys = Object.keys(beat);
  if (keys.length !== 2 || !keys.includes('kind') || !keys.includes('variant')) return false;
  const { kind, variant } = beat as { kind?: unknown; variant?: unknown };
  return kind === 'refusal' && (variant === 0 || variant === 1 || variant === 2);
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The viewer's setting at the moment a beat is admitted; a beat never changes style halfway. */
function prefersReducedMotion(motion: ForgeMoodMotion) {
  if (motion !== 'auto') return motion === 'reduced';
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * The forge's public mood: a small soot cough, a sulk and a clean settle at the anvil.
 * The host admits, delays and frames the beat; this only draws it from elapsed seconds.
 */
export function createForgeRefusalPresentation(options: {
  root: THREE.Group;
  anvil: readonly [number, number, number];
  caption: HTMLElement;
  /** Defaults to `auto`. Only a review bench forces a choice. */
  motion?: ForgeMoodMotion;
}): ForgeRefusalPresentation {
  const { root, caption, motion = 'auto' } = options;
  const layers = createForgeMoodLayers(options.anvil);
  root.add(layers.group);
  caption.textContent = '';
  caption.hidden = true;
  caption.setAttribute('aria-live', 'polite');
  caption.setAttribute('aria-atomic', 'true');

  let line: string | null = null;
  let reduced = false;
  let disposed = false;

  function clearCaption() {
    caption.textContent = '';
    caption.hidden = true;
    caption.style.removeProperty('opacity');
    caption.style.removeProperty('transform');
  }

  function finish() {
    line = null;
    layers.hide();
    clearCaption();
  }

  return {
    play(beat) {
      // An active beat is never extended or queued; malformed input is ignored outright.
      if (disposed || line !== null || !isRefusalBeat(beat)) return;
      line = FORGE_MOOD_LINES[beat.variant];
      reduced = prefersReducedMotion(motion);
      clearCaption();
      layers.pose(0, reduced);
    },
    update(elapsedSeconds) {
      if (disposed || line === null) return;
      // Past the end, or a sample that is no time at all (NaN, ±Infinity, not a number): the beat is over.
      if (typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds >= FORGE_MOOD_DURATION) { finish(); return; }
      const t = Math.max(0, elapsedSeconds);
      layers.pose(t, reduced);
      const pose = captionPose(t, reduced);
      if (pose.visible) {
        // One polite update per beat: the text is written once and only its visibility changes.
        if (caption.textContent !== line) caption.textContent = line;
        caption.hidden = false;
        caption.style.opacity = pose.opacity.toFixed(3);
        if (reduced) caption.style.removeProperty('transform');
        else caption.style.transform = `translateY(${pose.rise.toFixed(2)}px)`;
      } else {
        caption.hidden = true;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      finish();
      layers.dispose();
      caption.removeAttribute('aria-live');
      caption.removeAttribute('aria-atomic');
    },
  };
}
