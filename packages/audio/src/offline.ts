import { resolveFamily } from './families';
import { createMix, masterLevel, rampMaster, RAMP_SECONDS } from './mix';
import { Mixer, noiseBuffer } from './mixer';
import { fetchSample, SampleBank, type SampleLoader } from './samples';
import type { AudioCue, AudioCueOptions, AudioSettings } from './types';
import { normalizeSettings } from './engine';

export type ScriptStep =
  | { at: number; cue: AudioCue; options?: AudioCueOptions }
  | { at: number; settings: Partial<AudioSettings> };

export interface OfflineRender {
  buffer: AudioBuffer;
  /** What each cue step returned, in script order, exactly as a live `cue()` would have. */
  played: { at: number; cue: AudioCue; played: boolean }[];
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
  const mix = createMix(context, settings, random);
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
          rampMaster(mix, context, settings);
          if (masterLevel(settings) === 0 && masterLevel(previous) > 0) mixer.silence(context.currentTime + RAMP_SECONDS + 0.005);
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
