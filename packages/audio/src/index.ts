import { createAudioEngine } from './engine';
import type { AudioSettings, KingdomAudio } from './types';

export type {
  AudioControlSurface, AudioCue, AudioCueOptions, AudioMaterial, AudioSettings, KingdomAudio, KingdomAudioState,
} from './types';
export { AUDIO_CONTROL_SURFACES, AUDIO_CUES, AUDIO_MATERIALS } from './types';
export { FINISHED_FAMILIES } from './families';
export { inspectKingdomAudio, playKingdomPhrase, type KingdomAudioInspection } from './engine';
export { PHRASE_LIMITS, type KingdomPhrase, type KingdomPhraseOptions, type PhraseVoice } from './phrase';
export { noteHz, type PaletteNote } from './palette';

/**
 * The kingdom's sound. Creating it makes no context and no sound; the first `unlock()` from a user gesture does.
 * Defaults: `{ muted: false, volume: 0.65 }`, status `locked`.
 */
export function createKingdomAudio(settings?: Partial<AudioSettings>): KingdomAudio {
  return createAudioEngine(settings);
}
export { renderKingdomAudio, type OfflineRender, type ScriptStep } from './offline';
