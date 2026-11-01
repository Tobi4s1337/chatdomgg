import { createSoulAudio, type SoulAudio, type SoulAudioInspection, type SoulAudioOptions, type SoulAudioUpdate } from './index';

/** Browser-callable render through the same graph and frame updates as the live soundscape. */
export async function renderSoulAudio(options: { duration: number; frame(t: number): SoulAudioUpdate | null; sampleRate?: number; fps?: number; master?: number; audio?: SoulAudioOptions; at?: readonly { t: number; run(audio: SoulAudio): void }[] }): Promise<{ buffer: AudioBuffer; inspection: SoulAudioInspection }> {
  const rate = options.sampleRate ?? 48000, fps = options.fps ?? 30;
  if (!(options.duration > 0 && options.duration <= 600) || !(fps > 0 && fps <= 120)) throw new RangeError('soul audio: invalid render duration or frame rate');
  const context = new OfflineAudioContext(2, Math.ceil(options.duration * rate), rate);
  const master = context.createGain(); master.gain.value = options.master ?? .4225; master.connect(context.destination);
  const sound = createSoulAudio(context, master, { ...options.audio, rendering: true });
  const initial = options.frame(0); if (initial) sound.update(initial);
  let failure: unknown;
  const quantum = 128 / rate, steps = new Map<number, (() => void)[]>();
  const add = (t: number, action: () => void) => {
    const time = Math.ceil(t / quantum) * quantum;
    if (time <= 0 || time >= options.duration) return;
    steps.set(time, [...(steps.get(time) ?? []), action]);
  };
  for (let i = 1; i / fps < options.duration; i++) {
    const t = i / fps;
    add(t, () => { const frame = options.frame(t); if (frame) sound.update(frame); });
  }
  for (const action of options.at ?? []) add(action.t, () => action.run(sound));
  for (const [time, actions] of steps) {
    void context.suspend(time).then(() => { for (const action of actions) try { action(); } catch (error) { failure ??= error; } void context.resume(); });
  }
  const buffer = await context.startRendering(), inspection = sound.inspect(); sound.dispose();
  if (failure) throw failure;
  return { buffer, inspection };
}
