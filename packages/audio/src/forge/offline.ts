import { createForgeAudioGraph, inspectForgeAudio, type ForgeAudio, type ForgeAudioInspection } from './audio';

/**
 * Renders the Forge layer through exactly the live adapters, nodes and mix in an OfflineAudioContext. `drive` is
 * called at every host frame (default 60 per second) with the adapters, as a host's render loop would call them.
 * For the bench and the demo; consumers only need `createForgeAudio`.
 */
export interface ForgeRender {
  buffer: AudioBuffer;
  inspections: ForgeAudioInspection[];
}

export async function renderForgeAudio(options: {
  duration: number; sampleRate?: number; fps?: number; adapters?: number;
  drive(t: number, adapters: readonly ForgeAudio[]): void;
}): Promise<ForgeRender> {
  const rate = options.sampleRate ?? 48000, fps = options.fps ?? 60, count = options.adapters ?? 1;
  if (!(options.duration > 0 && options.duration <= 180)) throw new RangeError('forge audio: render 0–180 s');
  const context = new OfflineAudioContext(2, Math.ceil(options.duration * rate), rate);
  const destination = context.createGain();
  destination.connect(context.destination);
  const adapters = Array.from({ length: count }, () => createForgeAudioGraph({ context, destination }, true));
  const quantum = 128 / rate;
  let last = -1, failure: unknown = null;
  for (let i = 1; i * (1 / fps) < options.duration; i++) {
    const at = Math.round(i / fps / quantum) * quantum;
    if (at <= last || at >= options.duration) continue;
    last = at;
    void context.suspend(at).then(() => {
      try { options.drive(at, adapters); } catch (error) { failure ??= error; }
      void context.resume();
    });
  }
  const buffer = await context.startRendering();
  if (failure) throw failure;
  const inspections = adapters.map(adapter => inspectForgeAudio(adapter));
  for (const adapter of adapters) adapter.dispose();
  return { buffer, inspections };
}

/** Interleaved 16-bit PCM WAV of a rendered or recorded buffer. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0, count = channels.length;
  const bytes = new ArrayBuffer(44 + frames * count * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, frames * count * 2, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < count; channel++) {
    const sample = Math.max(-1, Math.min(1, channels[channel]![frame]!));
    view.setInt16(44 + (frame * count + channel) * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Uint8Array(bytes);
}
