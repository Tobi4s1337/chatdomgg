import { action, grains, hand, lift, weight, type Take } from './handling';

/**
 * Stone: flagstones underfoot and a dressed block set into a wall. The contact is a recorded step on hard stone;
 * played slower it becomes the heavier block. Original layers add the weight a stone has and the grit that lives
 * on it, so it reads as stone rather than as a harder wood.
 */

const STEPS: readonly Take[] = [
  { sample: 'step-stone-a', rate: 1, ring: 0 },
  { sample: 'step-stone-b', rate: 0.97, ring: 0 },
  { sample: 'step-stone-c', rate: 1.03, ring: 0 },
];

const GRIT = [
  [[0.011, 0.012], [0.024, 0.008]],
  [[0.009, 0.01], [0.019, 0.007], [0.031, 0.005]],
  [[0.014, 0.011], [0.027, 0.006]],
] as const;

/** A sole on a flagstone: the recorded contact with its hiss softened, the stone's weight, a little grit. */
export const STONE_STEP = action(STEPS, -1.2, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.035;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 85, 0.6), voice.filter('peaking', 3300, 0.8, -4),
    voice.filter('lowpass', 6800, 0.5), voice.gain(0.42), voice.out);
  weight(voice, t, 0.075, 260, 0.016);
  grains(voice, GRIT[variation]!.map(([at, level]) => [t + at, level] as const), 4200, 1.2, 0.002);
});

const BLOCKS: readonly Take[] = [
  { sample: 'step-stone-a', rate: 0.76, ring: 0 },
  { sample: 'step-stone-c', rate: 0.8, ring: 0 },
  { sample: 'step-stone-b', rate: 0.72, ring: 0 },
];

const SETTLE = [
  [[0.017, 0.022], [0.033, 0.015], [0.052, 0.01], [0.081, 0.006]],
  [[0.014, 0.02], [0.029, 0.016], [0.046, 0.009], [0.07, 0.007], [0.095, 0.004]],
  [[0.02, 0.024], [0.041, 0.012], [0.064, 0.008]],
] as const;

/**
 * A stone block set into place: the palm, the last centimetre slid across its bed, the heavy contact and the grit
 * settling round it.
 */
export const STONE_PLACE = action(BLOCKS, 1.8, (voice, take, variation) => {
  const t = voice.t, contact = t + 0.046;
  voice.room = 0.05;
  hand(voice, t, 0.045, 1400);

  const scrape = voice.gain(0);
  voice.bloom(scrape.gain, t + 0.012, 0.03, 0.028, 0.012);
  voice.chain(voice.noise(t + 0.012, t + 0.12), voice.filter('bandpass', 1150, 0.7), voice.filter('lowpass', 3600, 0.5), scrape, voice.out);

  voice.chain(voice.sample(take.sample, contact, take.rate), voice.filter('highpass', 70, 0.6), voice.filter('peaking', 3000, 0.8, -5),
    voice.filter('lowpass', 5200, 0.5), voice.gain(0.5), voice.out);
  weight(voice, contact, 0.15, 230, 0.026);
  grains(voice, SETTLE[variation]!.map(([at, level]) => [contact + at, level] as const), 3600, 1, 0.003);
});

const LIFTS: readonly Take[] = [
  { sample: 'step-stone-b', rate: 1.06, ring: 0 },
  { sample: 'step-stone-a', rate: 1.1, ring: 0 },
  { sample: 'step-stone-c', rate: 1.02, ring: 0 },
];

const FALL = [
  [[0.07, 0.012], [0.11, 0.008], [0.16, 0.005]],
  [[0.06, 0.01], [0.095, 0.009], [0.13, 0.006], [0.175, 0.004]],
  [[0.08, 0.011], [0.125, 0.006]],
] as const;

/** The block lifted from its bed: a light unseating tap, the lift, and a few grains falling back. */
export const STONE_REMOVE = action(LIFTS, 4.5, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.04;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 300, 0.6), voice.filter('lowpass', 4200, 0.5),
    voice.gain(0.34), voice.out);
  weight(voice, t, 0.05, 260, 0.014);
  lift(voice, t + 0.025, 0.02, 420, 1300, 0.16);
  grains(voice, FALL[variation]!.map(([at, level]) => [t + at, level * 1.4] as const), 3100, 1.1, 0.0025);
});

/** Two small stones in the palm, knocked together: a smaller, brighter contact twice. */
export const STONE_MATERIAL = action(LIFTS, 10.5, (voice, take) => {
  const t = voice.t;
  voice.room = 0.03;
  hand(voice, t, 0.022, 1700);
  const knock = voice.gain(1);
  voice.chain(knock, voice.filter('highpass', 420, 0.6), voice.filter('peaking', 3600, 0.8, -3), voice.filter('lowpass', 6200, 0.5), voice.out);
  voice.chain(voice.sample(take.sample, t + 0.018, take.rate * 1.45), voice.gain(0.13), knock);
  voice.chain(voice.sample(take.sample, t + 0.085, take.rate * 1.55), voice.gain(0.075), knock);
});
