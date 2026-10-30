import {
  noteHz, renderKingdomAudio,
  type KingdomPhrase, type KingdomPhraseOptions, type PaletteNote, type PhraseVoice,
} from '@chatdom/audio';
import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import type { ForgePhase } from '@chatdom/shared';

type ForgeSoundPhase = ForgePhase | 'refusal';
interface ForgeSoundOutput {
  phrase(phrase: KingdomPhrase, options?: KingdomPhraseOptions): boolean;
}

/** Original Forge instruments. Every layer belongs to a counted, bounded shared-engine phrase. */
function buildForgePhase(voice: PhraseVoice, phase: ForgeSoundPhase, variation: number): void {
  const colour = [1, 0.94, 1.06][variation]!;
  voice.room = phase === 'strike' ? 0.22 : 0.14;
  const body = voice.filter('lowpass', (phase === 'refusal' ? 950 : 4200) * colour, 0.6);
  body.connect(voice.out);

  function tone(note: PaletteNote, delay: number, length: number, gain: number, type: OscillatorType = 'sine') {
    const at = voice.t + delay, envelope = voice.gain(0);
    voice.envelope(envelope.gain, at, 0.008 * colour, gain, length / 7);
    voice.chain(voice.osc(type, noteHz(note), at, at + length + 0.02), envelope, body);
  }

  if (phase === 'words') {
    const notes: readonly PaletteNote[] = ['D3', 'A3', 'B3', 'D4', 'F#4'];
    notes.forEach((note, i) => tone(note, i * 0.19, 0.7, 0.035, 'triangle'));
  }
  if (phase === 'blueprint') {
    for (const note of ['D4', 'A4', 'D5'] as const) tone(note, 0, 1.8, 0.035);
  }
  if (phase === 'pour') {
    const notes: readonly PaletteNote[] = ['D2', 'E2', 'F#2', 'A2', 'B2'];
    for (let i = 0; i < 16; i++) tone(notes[i % notes.length]!, i * 0.32, 0.18, 0.026, 'triangle');
  }
  if (phase === 'seal') {
    tone('D3', 0, 0.12, 0.12, 'triangle');
    tone('D4', 0.04, 0.2, 0.045);
  }
  if (phase === 'strike') {
    tone('D2', 0, 0.35, 0.22, 'triangle');
    for (const note of ['A4', 'D6', 'F#7'] as const) tone(note, 0.01, 1.1, 0.045);
    const contact = voice.gain(0);
    voice.envelope(contact.gain, voice.t, 0.002, 0.05, 0.018);
    voice.chain(voice.noise(voice.t, voice.t + 0.16), voice.filter('bandpass', 1800 * colour, 0.7), contact, body);
  }
  if (phase === 'cool') {
    const notes: readonly PaletteNote[] = ['D6', 'B5', 'A5', 'F#5', 'E5', 'D5'];
    notes.forEach((note, i) => tone(note, i * 0.3, 0.5, 0.022));
  }
  if (phase === 'flight') {
    const notes: readonly PaletteNote[] = ['D4', 'E4', 'F#4', 'A4', 'B4', 'D5', 'E5', 'F#5'];
    notes.forEach((note, i) => tone(note, i * 0.22, 0.65, 0.028));
  }
  if (phase === 'landed') {
    for (const note of ['D3', 'F#3', 'A3', 'D4'] as const) tone(note, 0, 2.5, 0.042, 'triangle');
  }
  if (phase === 'refusal') {
    tone('D2', 0, 0.23, 0.075, 'sawtooth');
    tone('A1', 0.23, 0.45, 0.045, 'triangle');
  }
}

const FORGE_PHRASES: Readonly<Record<ForgeSoundPhase, KingdomPhrase>> = Object.fromEntries(
  [...FORGE_STAGE_TIMING.map(([phase]) => phase), 'refusal' as const].map(phase => [phase, {
    key: `forge:${phase}`, tier: 'ceremony', variations: 3,
    build: (voice: PhraseVoice, variation: number) => buildForgePhase(voice, phase, variation),
  } satisfies KingdomPhrase]),
) as Record<ForgeSoundPhase, KingdomPhrase>;

/** The scene owns phase/dedupe scheduling; this bridge never queues a missed sound or exposes raw nodes. */
export function playForgeSound(output: ForgeSoundOutput | null, phase: ForgeSoundPhase, offset = 0): boolean {
  return output?.phrase(FORGE_PHRASES[phase], { delay: offset }) ?? false;
}

/** The film uses exactly the live phase phrases and shared mix, rendered offline to a stereo PCM WAV. */
export async function renderForgeRitualAudio(): Promise<number[]> {
  const script = FORGE_STAGE_TIMING.map(([phase, at]) => ({ at, phrase: FORGE_PHRASES[phase] }));
  const rendered = await renderKingdomAudio(script, { duration: 22, sampleRate: 48000 });
  if (rendered.played.length !== script.length || rendered.played.some(step => !step.played)) {
    throw new Error('The Forge soundtrack could not render every ritual phase.');
  }
  const { buffer: audio } = rendered, channels = audio.numberOfChannels, rate = audio.sampleRate;
  const channelData = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
  const buffer = new ArrayBuffer(44 + audio.length * channels * 2), view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data');
  view.setUint32(40, audio.length * channels * 2, true);
  for (let frame = 0; frame < audio.length; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = Math.max(-1, Math.min(1, channelData[channel]![frame]!));
    view.setInt16(44 + (frame * channels + channel) * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return Array.from(new Uint8Array(buffer));
}
