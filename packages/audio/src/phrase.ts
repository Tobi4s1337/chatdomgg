import type { CueFamily } from './families';
import type { VoiceGraph } from './voice';

/**
 * A consumer's own short phrase (a Forge phase, for one), played through the kingdom's one context, mixer and mix
 * path: counted in the 16-voice / 64-source budget, faded on mute, stopped on interruption, closed on disposal,
 * and rendered offline exactly like the built-in cues. The consumer authors synthesis with the same voice tools the
 * cues use; it never receives the context, the master or the output.
 */
export interface KingdomPhrase {
  /** Names the phrase, for example `forge:strike`. Variation memory and duplicate coalescing are per key. */
  key: string;
  /**
   * How protected it is in the mix. `ceremony` (the default) sits with a window lighting: it may fill the mix up to
   * 40 sources. `beacon` is for a kingdom-wide moment and may reach 58; controls always keep room above both.
   */
  tier?: 'ceremony' | 'beacon';
  /** How many authored variations `build` knows; never the same one twice in a row. Default 1, at most 8. */
  variations?: number;
  /**
   * Schedules the phrase's layers from `voice.t` (the phrase's own start, in context seconds). Every layer must end
   * within `PHRASE_LIMITS.seconds` of it, using at most `PHRASE_LIMITS.sources` oscillators and noise sources.
   */
  build(voice: PhraseVoice, variation: number): void;
}

/** The authoring tools a phrase gets: envelopes, partials, filters and noise on its own voice, nothing beyond it. */
export type PhraseVoice = Pick<VoiceGraph, 't' | 'out' | 'room' | 'gain' | 'filter' | 'chain' | 'osc' | 'noise'
  | 'envelope' | 'partial' | 'bloom' | 'pan'>;

export interface KingdomPhraseOptions {
  /** Seconds from now, at most `PHRASE_LIMITS.delay`; lets a consumer line a phrase up with its own frame clock. */
  delay?: number;
  pan?: number;
  distance?: number;
}

/** One phrase: at most 24 sources over 6 s, scheduled at most 2 s ahead. Larger phrases throw; nothing is queued. */
export const PHRASE_LIMITS = { sources: 24, seconds: 6, delay: 2 } as const;

const TIERS = new Set(['ceremony', 'beacon']);

/** Checks a phrase and turns it into a family the mixer plays. Malformed phrases throw rather than play silently. */
export function phraseFamily(phrase: KingdomPhrase): CueFamily {
  if (!phrase || typeof phrase.key !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,47}$/.test(phrase.key)) {
    throw new TypeError('kingdom audio: a phrase needs a key of lower-case letters, digits, ":", "_" or "-"');
  }
  if (typeof phrase.build !== 'function') throw new TypeError(`kingdom audio: phrase ${phrase.key} has no build`);
  const tier = phrase.tier ?? 'ceremony';
  if (!TIERS.has(tier)) throw new TypeError(`kingdom audio: phrase tier must be ceremony or beacon, not ${String(tier)}`);
  const variations = phrase.variations ?? 1;
  if (!Number.isInteger(variations) || variations < 1 || variations > 8) {
    throw new RangeError(`kingdom audio: phrase ${phrase.key} needs 1 to 8 variations`);
  }
  return {
    key: `phrase:${phrase.key}`, tier, variations, samples: [],
    bounds: { sources: PHRASE_LIMITS.sources, seconds: PHRASE_LIMITS.seconds },
    build: (voice, variation) => phrase.build(voice, variation),
  };
}

/** The phrase's delay, clamped to [0, 2] s, or undefined for a non-finite value (the call then returns false). */
export function phraseDelay(options: KingdomPhraseOptions): number | undefined {
  const delay = options.delay ?? 0;
  return Number.isFinite(delay) ? Math.min(PHRASE_LIMITS.delay, Math.max(0, delay)) : undefined;
}
