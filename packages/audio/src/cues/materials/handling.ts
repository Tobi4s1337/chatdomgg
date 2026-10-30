import type { SampleId } from '../../samples';
import type { VoiceGraph } from '../../voice';

/**
 * The hands and air every material shares. A surface keeps its own recordings and resonance; these layers are the
 * same palm, the same fingertips and the same lift for all six, so building with stone and with cloth still sounds
 * like one person at work.
 */

/** One authored take of a material action: which recording, how it is played and where its own body rings. */
export interface Take {
  sample: SampleId;
  rate: number;
  /** A resonance of the piece itself, in Hz. */
  ring: number;
}

/** A finished material action: three takes of the same object, built into one voice. */
export interface MaterialAction {
  variations: number;
  samples: readonly SampleId[];
  /** The family's fader in dB, set by listening across all six surfaces (see the README's mix table). */
  fader: number;
  build(voice: VoiceGraph, variation: number): void;
}

export function action<T extends Take>(takes: readonly T[], fader: number,
  build: (voice: VoiceGraph, take: T, variation: number) => void, also: readonly SampleId[] = []): MaterialAction {
  return {
    variations: takes.length,
    samples: [...new Set([...takes.map(take => take.sample), ...also])],
    fader,
    build: (voice, variation) => build(voice, takes[variation]!, variation),
  };
}

/** A palm or fingertips meeting a piece: a short, soft brush of skin-coloured noise, never a click. */
export function hand(voice: VoiceGraph, at: number, level: number, tone = 1600): void {
  const amp = voice.gain(0);
  voice.envelope(amp.gain, at, 0.004, level, 0.014);
  voice.chain(voice.noise(at, at + 0.11), voice.filter('bandpass', tone, 0.8), voice.filter('lowpass', 3800, 0.5), amp, voice.out);
}

/** The piece leaving the ground and the hand: a short breath of air that rises as it goes up. */
export function lift(voice: VoiceGraph, at: number, level: number, from = 480, to = 1500, length = 0.15): void {
  const amp = voice.gain(0), band = voice.filter('bandpass', from, 0.9);
  voice.bloom(amp.gain, at, length * 0.45, level, length * 0.28);
  band.frequency.setValueAtTime(from, at);
  band.frequency.exponentialRampToValueAtTime(to, at + length);
  voice.chain(voice.noise(at, at + length * 2.4), band, voice.filter('lowpass', 2800, 0.5), amp, voice.out);
}

/**
 * Grains through one noise source: grit settling round a stone, soil crumbling off a clod. Each grain is a 2–3 ms
 * opening with its own level, so a whole trickle costs a single source.
 */
export function grains(voice: VoiceGraph, times: readonly (readonly [at: number, level: number])[], tone: number, q: number, tau: number): void {
  const first = times[0]![0], last = times[times.length - 1]![0], amp = voice.gain(0);
  amp.gain.setValueAtTime(0, first);
  for (const [at, level] of times) {
    amp.gain.setTargetAtTime(level, at, 0.0006);
    amp.gain.setTargetAtTime(0, at + 0.0025, tau);
  }
  voice.chain(voice.noise(first, last + tau * 9 + 0.004), voice.filter('bandpass', tone, q), voice.filter('lowpass', 5000, 0.5), amp, voice.out);
}

/** A soft weight under a contact: low-passed noise, felt more than heard. */
export function weight(voice: VoiceGraph, at: number, level: number, tone: number, tau: number): void {
  const amp = voice.gain(0);
  voice.envelope(amp.gain, at, 0.002, level, tau);
  voice.chain(voice.noise(at, at + tau * 8 + 0.01), voice.filter('lowpass', tone, 0.9), voice.filter('highpass', 60, 0.6), amp, voice.out);
}

/** A gain that holds and then lets go: a hand damping a ringing piece, or the end of a sliced recording. */
export function damp(voice: VoiceGraph, at: number, hold: number, tau: number): GainNode {
  const amp = voice.gain(1);
  amp.gain.setValueAtTime(1, at);
  amp.gain.setTargetAtTime(0, at + hold, tau);
  return amp;
}

/** How long a damped layer needs to keep sounding before it is ~60 dB down. */
export function dampedLength(hold: number, tau: number): number {
  return hold + tau * 7;
}
