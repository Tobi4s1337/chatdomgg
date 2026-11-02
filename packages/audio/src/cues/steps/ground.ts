import type { Take } from '../materials/handling';
import type { VoiceGraph } from '../../voice';

/**
 * Layers the outdoor grounds share, authored here. A ground keeps its own recording; these are the air and water a
 * foot moves through outdoors: stalks brushing past, sand pushed aside, water thrown up and bubbles rising.
 */

/**
 * A take of a ground step with its own level: the recordings are normalised by peak, not by loudness, so each take
 * carries the trim (linear gain) that brings it level with its siblings, measured on the rendered steps.
 */
export interface GroundTake extends Take { level: number }

/** Grains as authored tables: `[seconds after contact, level]`. */
export type GrainTable = readonly (readonly [at: number, level: number])[];

/** Grains of one take, moved to the contact. */
export function at(contact: number, table: GrainTable, scale = 1): (readonly [number, number])[] {
  return table.map(([time, level]) => [contact + time, level * scale] as const);
}

/**
 * Something soft brushing past: band-limited noise that swells and dies while its band slides from `from` to `to`
 * Hz. Stalks of tall grass, sand pushed out from under a sole, the swirl of water round an ankle.
 */
export function swish(voice: VoiceGraph, start: number, level: number, from: number, to: number, length: number, top = 4200, q = 0.8): void {
  const amp = voice.gain(0), band = voice.filter('bandpass', from, q);
  voice.bloom(amp.gain, start, length * 0.4, level, length * 0.3);
  band.frequency.setValueAtTime(from, start);
  band.frequency.exponentialRampToValueAtTime(to, start + length);
  voice.chain(voice.noise(start, start + length * 2.6), band, voice.filter('lowpass', top, 0.5), amp, voice.out);
}

/** One bubble or drop: when, the pitch it starts at and rises to, and how loud. */
export type Bubble = readonly [start: number, from: number, to: number, level: number];

/**
 * Bubbles in water, all on one oscillator: each is a short sine whose pitch rises as it nears the surface. Bubbles
 * off a foot are a few millimetres across (500 Hz to 1.4 kHz, `tau` 12 ms); drops falling back make smaller,
 * quicker ones (1.4 to 3.6 kHz, `tau` 6 ms). Starts should be at least five `tau` apart.
 */
export function bubbles(voice: VoiceGraph, list: readonly Bubble[], tau = 0.012, rise = 0.03): void {
  const first = list[0]!, last = list[list.length - 1]!;
  const amp = voice.gain(0), tone = voice.osc('sine', first[1], first[0], last[0] + tau * 8 + rise);
  for (const [start, from, to, level] of list) {
    tone.frequency.setValueAtTime(from, start);
    tone.frequency.exponentialRampToValueAtTime(to, start + rise);
    voice.envelope(amp.gain, start, 0.002, level, tau);
  }
  voice.chain(tone, voice.filter('highpass', 300, 0.6), amp, voice.out);
}
