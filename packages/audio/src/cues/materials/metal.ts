import { noteHz, type PaletteNote } from '../../palette';
import { SAMPLES, type SampleId } from '../../samples';
import type { VoiceGraph } from '../../voice';
import { action, damp, dampedLength, hand, lift, weight, type Take } from './handling';

/**
 * Iron: a plate set in a floor and a forged fitting set into a home. A recorded metal strike is tuned down into the
 * palette so it rings like thick, warm iron rather than a tin, and a hand damps it before it can sing. Original
 * inharmonic partials (a plate's modes near 1 : 2.32) carry the size of the piece.
 */

interface IronTake extends Take { note: PaletteNote }

function tuned(take: IronTake): number {
  return noteHz(take.note) / SAMPLES[take.sample].peakHz;
}

/** A recorded strike, tuned, band-limited and damped. */
function strike(voice: VoiceGraph, sample: SampleId, at: number, rate: number, level: number, hold: number, tau: number): void {
  voice.chain(voice.sample(sample, at, rate, 0, dampedLength(hold, tau)), voice.filter('highpass', 220, 0.6),
    voice.filter('lowpass', 3600, 0.5), voice.gain(level), damp(voice, at, hold, tau), voice.out);
}

const STEPS: readonly IronTake[] = [
  { sample: 'iron-c', rate: 1, ring: noteHz('D4'), note: 'D5' },
  { sample: 'iron-e', rate: 1, ring: noteHz('E4'), note: 'E5' },
  { sample: 'iron-b', rate: 1, ring: noteHz('D4'), note: 'D5' },
];
const HEELS = ['step-stone-c', 'step-stone-a', 'step-stone-b'] as const;

/** A heel on an iron plate: the sole's contact, the plate struck under it, and the plate's hollow hum, all short. */
export const METAL_STEP = action(STEPS, -0.6, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.04;
  voice.chain(voice.sample(HEELS[variation]!, t, 0.92), voice.filter('highpass', 90, 0.6), voice.filter('lowpass', 2400, 0.5),
    voice.gain(0.3), voice.out);
  strike(voice, take.sample, t + 0.002, tuned(take), 0.15, 0.03, 0.045);
  const plate = voice.filter('lowpass', 2000, 0.5);
  plate.connect(voice.out);
  voice.partial(plate, 'sine', take.ring, t + 0.002, 0.002, 0.026, 0.05);
  voice.partial(plate, 'sine', take.ring * 2.32, t + 0.002, 0.0015, 0.01, 0.026);
}, [...HEELS]);

const FITTINGS: readonly IronTake[] = [
  { sample: 'iron-a', rate: 1, ring: noteHz('A3'), note: 'D5' },
  { sample: 'iron-d', rate: 1, ring: noteHz('B3'), note: 'E5' },
  { sample: 'iron-b', rate: 1, ring: noteHz('A3'), note: 'B4' },
];

/**
 * An iron fitting set into place: the palm, the strike of iron on its seat with the weight beneath it, a small
 * second clink as it beds in, and the hand damping the ring within a quarter of a second.
 */
export const METAL_PLACE = action(FITTINGS, -0.4, (voice, take) => {
  const t = voice.t, contact = t + 0.03;
  voice.room = 0.05;
  hand(voice, t, 0.045, 1500);
  strike(voice, take.sample, contact, tuned(take), 0.34, 0.09, 0.055);
  weight(voice, contact, 0.1, 320, 0.02);
  const body = voice.filter('lowpass', 700, 0.5);
  body.connect(voice.out);
  voice.partial(body, 'triangle', take.ring, contact, 0.002, 0.05, 0.03);
  const clink = contact + 0.062;
  voice.partial(voice.out, 'sine', noteHz(take.note) * 1.5, clink, 0.001, 0.01, 0.018);
});

const LIGHT: readonly IronTake[] = [
  { sample: 'iron-e', rate: 1, ring: 0, note: 'A5' },
  { sample: 'iron-c', rate: 1, ring: 0, note: 'B5' },
  { sample: 'iron-b', rate: 1, ring: 0, note: 'A5' },
];

/** The fitting lifted off its seat: a light, damped clink and the lift. */
export const METAL_REMOVE = action(LIGHT, 3.8, (voice, take) => {
  const t = voice.t;
  voice.room = 0.04;
  strike(voice, take.sample, t, tuned(take), 0.22, 0.025, 0.03);
  lift(voice, t + 0.03, 0.02, 500, 1600, 0.15);
});

/** A small iron piece turned over in the hand: fingertips and a very short, damped clink. */
export const METAL_MATERIAL = action(LIGHT, 8.1, (voice, take) => {
  const t = voice.t;
  voice.room = 0.03;
  hand(voice, t, 0.022, 2000);
  strike(voice, take.sample, t + 0.02, tuned(take) * 1.12, 0.085, 0.018, 0.022);
});
