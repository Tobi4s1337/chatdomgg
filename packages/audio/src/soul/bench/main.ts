import { renderSoulAudio } from '../offline';
import { soulAt, type SoulBiome } from '../../../../world/src/soul';
import type { SoulProfile } from '../index';

Object.assign(window, { renderSoulCase: async (biome: SoulBiome, hour: number, profile: SoulProfile, duration = 8, presence = 12, duck = false) => {
  const epoch = Date.UTC(2026, 6, 15, hour);
  const { buffer, inspection } = await renderSoulAudio({ duration, sampleRate: 24000, frame: t => ({ frame: soulAt({ seed: 42, biome, population: 12 }, epoch + t * 1000), biome, profile, presence }), ...(duck ? { at: [{ t: 1, run: (audio: import('../index').SoulAudio) => audio.duck({ depthDb: 12, seconds: 5 }) }] } : {}) });
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  let peak = 0, sum = 0; for (const c of channels) for (const x of c) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  let middle = 0; for (const c of channels) for (let i = 2 * buffer.sampleRate; i < 5 * buffer.sampleRate; i++) middle += c[i]! ** 2;
  const middleRms = Math.sqrt(middle / (6 * buffer.sampleRate));
  const bytes = new Uint8Array(44 + buffer.length * 4), view = new DataView(bytes.buffer);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let i = 0; i < buffer.length; i++) for (let ch = 0; ch < 2; ch++) view.setInt16(44 + i * 4 + ch * 2, Math.round(Math.max(-1, Math.min(1, channels[ch]![i]!)) * 32767), true);
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { wav: btoa(binary), peak, rms: Math.sqrt(sum / (buffer.length * 2)), middleRms, inspection };
} });
Object.assign(window, { renderSoulStall: async () => {
  const epoch = Date.UTC(2026, 6, 15, 12), biome = 'woodland' as const;
  const { buffer, inspection } = await renderSoulAudio({ duration: 8, sampleRate: 24000, frame: t => t < 3 ? { frame: soulAt({ seed: 42, biome, population: 10 }, epoch + t * 1000), biome, presence: 10 } : null });
  const rms = (start: number, end: number) => { const c = buffer.getChannelData(0); let sum = 0; for (let i = start * buffer.sampleRate; i < end * buffer.sampleRate; i++) sum += c[i]! ** 2; return Math.sqrt(sum / ((end - start) * buffer.sampleRate)); };
  return { before: rms(1, 3), after: rms(6, 8), inspection };
} });
Object.assign(window, { renderSoulLifecycle: async () => {
  const epoch = Date.UTC(2026, 6, 15, 12), biome = 'coastal' as const;
  const { buffer, inspection } = await renderSoulAudio({ duration: 12, sampleRate: 24000,
    frame: t => ({ frame: soulAt({ seed: 42, biome, population: 10 }, epoch + (t >= 8 ? t + 86400 : t) * 1000), biome, presence: 10 }),
    at: [{ t: 3, run: audio => audio.setMuted(true) }, { t: 6, run: audio => audio.setMuted(false) }],
  });
  const rms = (start: number, end: number) => { const c = buffer.getChannelData(0); let sum = 0; for (let i = start * buffer.sampleRate; i < end * buffer.sampleRate; i++) sum += c[i]! ** 2; return Math.sqrt(sum / ((end - start) * buffer.sampleRate)); };
  return { before: rms(1, 3), muted: rms(4, 6), resumed: rms(7, 8), afterSeek: rms(9, 11), inspection };
} });
