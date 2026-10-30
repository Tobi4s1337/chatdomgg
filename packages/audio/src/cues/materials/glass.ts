import { noteHz, type PaletteNote } from '../../palette';
import { SAMPLES, type SampleId } from '../../samples';
import type { VoiceGraph } from '../../voice';
import { action, damp, dampedLength, hand, lift, weight, type Take } from './handling';

/**
 * Glass: a thick glass floor tile and a glass block set into a wall. These are the same panes the windows light
 * with, so the resonance is tuned into the palette; here it is struck by something solid and held back by a hand,
 * a restrained ring under a weighty contact rather than a chime.
 */

interface GlassTake extends Take { note: PaletteNote }

function tuned(take: GlassTake): number {
  return noteHz(take.note) / SAMPLES[take.sample].peakHz;
}

function pane(voice: VoiceGraph, sample: SampleId, at: number, rate: number, level: number, hold: number, tau: number): void {
  voice.chain(voice.sample(sample, at, rate, 0, dampedLength(hold, tau)), voice.filter('highpass', 320, 0.6),
    voice.filter('peaking', 3800, 0.8, -4), voice.filter('lowpass', 5200, 0.5), voice.gain(level), damp(voice, at, hold, tau), voice.out);
}

const STEPS: readonly GlassTake[] = [
  { sample: 'glass-tap-a', rate: 1, ring: noteHz('F#3'), note: 'E5' },
  { sample: 'glass-tap-b', rate: 1, ring: noteHz('A3'), note: 'F#5' },
  { sample: 'glass-tap-c', rate: 1, ring: noteHz('E3'), note: 'A5' },
];
const HEELS = ['step-stone-b', 'step-stone-c', 'step-stone-a'] as const;

/** A sole on a thick glass tile: a hard, clean contact without grit, and a short, damped ring of the slab. */
export const GLASS_STEP = action(STEPS, 0.5, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.05;
  voice.chain(voice.sample(HEELS[variation]!, t, 1.04), voice.filter('highpass', 120, 0.6), voice.filter('lowpass', 3200, 0.5),
    voice.gain(0.3), voice.out);
  pane(voice, take.sample, t + 0.002, tuned(take), 0.14, 0.02, 0.032);
  voice.partial(voice.out, 'sine', take.ring, t + 0.002, 0.002, 0.016, 0.03);
}, [...HEELS]);

const BLOCKS: readonly GlassTake[] = [
  { sample: 'glass-block-a', rate: 1, ring: noteHz('F#3'), note: 'F#5' },
  { sample: 'glass-block-b', rate: 1, ring: noteHz('A3'), note: 'A5' },
  { sample: 'glass-block-c', rate: 1, ring: noteHz('E3'), note: 'E5' },
];

/** A glass block set into place: the palm, its weight meeting the bed, and its ring allowed briefly before the hand stills it. */
export const GLASS_PLACE = action(BLOCKS, 1.3, (voice, take) => {
  const t = voice.t, contact = t + 0.03;
  voice.room = 0.07;
  hand(voice, t, 0.045, 1600);
  pane(voice, take.sample, contact, tuned(take), 0.3, 0.11, 0.07);
  weight(voice, contact, 0.1, 340, 0.02);
  const body = voice.filter('lowpass', 900, 0.5);
  body.connect(voice.out);
  voice.partial(body, 'sine', take.ring * 2, contact, 0.002, 0.018, 0.06);
});

/** The block lifted out: its ring touched once and stilled at once, then the lift. */
export const GLASS_REMOVE = action(BLOCKS, 3.3, (voice, take) => {
  const t = voice.t;
  voice.room = 0.05;
  pane(voice, take.sample, t, tuned(take), 0.17, 0.03, 0.035);
  lift(voice, t + 0.03, 0.02, 520, 1600, 0.15);
});

const TOUCHES: readonly GlassTake[] = [
  { sample: 'glass-tap-b', rate: 1, ring: 0, note: 'A5' },
  { sample: 'glass-tap-c', rate: 1, ring: 0, note: 'B5' },
  { sample: 'glass-tap-a', rate: 1, ring: 0, note: 'F#5' },
];

/** A fingertip along a glass piece and a nail's light touch on it, stilled almost at once. */
export const GLASS_MATERIAL = action(TOUCHES, 10.8, (voice, take) => {
  const t = voice.t;
  voice.room = 0.04;
  hand(voice, t, 0.02, 2400);
  pane(voice, take.sample, t + 0.02, tuned(take), 0.08, 0.03, 0.03);
});
