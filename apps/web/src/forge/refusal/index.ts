import type * as THREE from 'three';
import type { ForgePublicBeat } from '@chatdom/shared';
import { createForgeMoodLayers } from './layers';
import { FORGE_MOOD_DURATION, captionPose } from './timeline';

export { FORGE_MOOD_DURATION, FORGE_MOOD_PHASES } from './timeline';
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

const isRefusalBeat = (beat: unknown): beat is ForgeRefusalBeat => {
  if (typeof beat !== 'object' || beat === null) return false;
  const { kind, variant } = beat as { kind?: unknown; variant?: unknown };
  return kind === 'refusal' && (variant === 0 || variant === 1 || variant === 2);
};

/**
 * The forge's public mood: a small soot cough, a sulk and a clean settle at the anvil.
 * The host admits, delays and frames the beat; this only draws it from elapsed seconds.
 */
export function createForgeRefusalPresentation(options: {
  root: THREE.Group;
  anvil: readonly [number, number, number];
  caption: HTMLElement;
}): ForgeRefusalPresentation {
  const { root, caption } = options;
  const layers = createForgeMoodLayers(options.anvil);
  root.add(layers.group);
  caption.textContent = '';
  caption.hidden = true;
  caption.setAttribute('aria-live', 'polite');
  caption.setAttribute('aria-atomic', 'true');

  let line: string | null = null;
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
      clearCaption();
      layers.pose(0);
    },
    update(elapsedSeconds) {
      if (disposed || line === null) return;
      if (typeof elapsedSeconds !== 'number' || Number.isNaN(elapsedSeconds) || elapsedSeconds >= FORGE_MOOD_DURATION) { finish(); return; }
      const t = Math.max(0, elapsedSeconds);
      layers.pose(t);
      const pose = captionPose(t);
      if (pose.visible) {
        // One polite update per beat: the text is written once and only its visibility changes.
        if (caption.textContent !== line) caption.textContent = line;
        caption.hidden = false;
        caption.style.opacity = pose.opacity.toFixed(3);
        caption.style.transform = `translateY(${pose.rise.toFixed(2)}px)`;
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
