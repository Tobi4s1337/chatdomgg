import { resolveFamily } from './families';
import { masterLevel, Mix } from './mix';
import { Mixer, noiseBuffer } from './mixer';
import { phraseDelay, phraseFamily, type KingdomPhrase, type KingdomPhraseOptions } from './phrase';
import { fetchSample, SampleBank, type SampleLoader } from './samples';
import type { AudioCue, AudioCueOptions, AudioSettings } from './types';
import { normalizeSettings } from './engine';

/**
 * One timed step: a cue, a consumer phrase, new settings, or `interrupt`, which does exactly what the live instance
 * does when the browser suspends its context (every voice stops, the mix front is replaced) while the render is
 * paused at that moment.
 */
export type ScriptStep =
  | { at: number; cue: AudioCue; options?: AudioCueOptions }
  | { at: number; phrase: KingdomPhrase; options?: KingdomPhraseOptions }
  | { at: number; settings: Partial<AudioSettings> }
  | { at: number; interrupt: true };

export interface OfflineRender {
  buffer: AudioBuffer;
  /** What each cue or phrase step returned, in script order, exactly as a live call would have. */
  played: { at: number; cue: string; played: boolean }[];
}

/**
 * Renders a timed script through the same mix path, families and mixer the live instance uses, in an
 * OfflineAudioContext. The render suspends at each step's time, so budgets and cleanup run in render time.
 */
export async function renderKingdomAudio(script: readonly ScriptStep[], options: {
  duration: number; sampleRate?: number; settings?: Partial<AudioSettings>; random?: () => number; loadSample?: SampleLoader;
}): Promise<OfflineRender> {
  const sampleRate = options.sampleRate ?? 48000, random = options.random ?? Math.random;
  const context = new OfflineAudioContext(2, Math.ceil(options.duration * sampleRate), sampleRate);
  const samples = new SampleBank(options.loadSample ?? fetchSample);
  await samples.load(context);
  let settings = normalizeSettings({ muted: false, volume: 0.65 }, options.settings ?? {});
  const mix = new Mix(context, settings, random);
  const mixer = new Mixer(context, mix, { noise: noiseBuffer(context, random), samples, random });
  const played: OfflineRender['played'] = [];

  const quantum = 128 / sampleRate, groups = new Map<number, ScriptStep[]>();
  for (const step of script) {
    const slot = Math.round(Math.ceil(step.at / quantum) * quantum * sampleRate);
    groups.set(slot, [...(groups.get(slot) ?? []), step]);
  }
  for (const [slot, steps] of groups) {
    void context.suspend(slot / sampleRate).then(() => {
      for (const step of steps) {
        if ('settings' in step) {
          const previous = settings;
          settings = normalizeSettings(settings, step.settings);
          mixer.applySettings(previous, settings);
        } else if ('interrupt' in step) {
          mixer.interrupt();
        } else if ('phrase' in step) {
          const family = phraseFamily(step.phrase), options = step.options ?? {}, delay = phraseDelay(options);
          const place: AudioCueOptions = {};
          if (options.pan !== undefined) place.pan = options.pan;
          if (options.distance !== undefined) place.distance = options.distance;
          played.push({ at: step.at, cue: family.key, played: delay !== undefined && masterLevel(settings) > 0 && mixer.play(family, place, delay) });
        } else {
          const family = resolveFamily(step.cue, step.options ?? {});
          played.push({ at: step.at, cue: step.cue, played: masterLevel(settings) > 0 && mixer.play(family, step.options ?? {}) });
        }
      }
      return context.resume();
    });
  }
  const buffer = await context.startRendering();
  mixer.close();
  return { buffer, played };
}
