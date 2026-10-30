import { CASTLE_BEACON } from './cues/beacon';
import { BRASS_CONTROL, PARCHMENT_CONTROL, WOOD_CONTROL } from './cues/control';
import { WINDOW_LIGHT } from './cues/light';
import { STREET_WAVE } from './cues/wave';
import type { SampleId } from './samples';
import { AUDIO_CONTROL_SURFACES, AUDIO_CUES, AUDIO_MATERIALS, type AudioCue, type AudioCueOptions } from './types';
import type { VoiceGraph } from './voice';

/**
 * Mix tiers, from most to least protected. A tier may only grow the mix up to its own ceiling, so footsteps can
 * never take the voices that a control press or the castle beacon needs.
 */
export type MixTier = 'control' | 'beacon' | 'ceremony' | 'build' | 'step';

export interface CueFamily {
  /** Variation memory and duplicate coalescing are per key: one family on one surface. */
  key: string;
  tier: MixTier;
  variations: number;
  samples: readonly SampleId[];
  build(voice: VoiceGraph, variation: number): void;
}

const FAMILIES: Partial<Record<string, Omit<CueFamily, 'key'>>> = {
  'wood:wood': { tier: 'control', ...WOOD_CONTROL },
  'wood:brass': { tier: 'control', ...BRASS_CONTROL },
  'wood:parchment': { tier: 'control', ...PARCHMENT_CONTROL },
  light: { tier: 'ceremony', ...WINDOW_LIGHT },
  wave: { tier: 'ceremony', ...STREET_WAVE },
  beacon: { tier: 'beacon', ...CASTLE_BEACON },
};

/** Cue families that are finished and audible in this build, as `cue` or `cue:surface`. */
export const FINISHED_FAMILIES: readonly string[] = Object.keys(FAMILIES);

const MATERIAL_CUES = new Set<AudioCue>(['step', 'place', 'remove', 'material']);

/** Resolves a call to its family. Unknown values and families that are not finished yet throw, never fake success. */
export function resolveFamily(kind: AudioCue, options: AudioCueOptions): CueFamily {
  if (!AUDIO_CUES.includes(kind)) throw new TypeError(`kingdom audio: unknown cue ${String(kind)}`);
  if (options.material !== undefined && !AUDIO_MATERIALS.includes(options.material)) {
    throw new TypeError(`kingdom audio: unknown material ${String(options.material)}`);
  }
  if (options.ui !== undefined && !AUDIO_CONTROL_SURFACES.includes(options.ui)) {
    throw new TypeError(`kingdom audio: unknown control surface ${String(options.ui)}`);
  }
  const key = kind === 'wood' ? `wood:${options.ui ?? 'wood'}`
    : MATERIAL_CUES.has(kind) ? `${kind}:${options.material ?? 'wood'}` : kind;
  const family = FAMILIES[key];
  if (!family) throw new Error(`kingdom audio: the ${key} sound is not finished yet`);
  return { key, ...family };
}
