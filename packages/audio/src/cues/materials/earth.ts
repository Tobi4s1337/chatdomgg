import { action, grains, hand, lift, weight, type Take } from './handling';

/**
 * Earth: a packed path underfoot and a clod of soil pressed into a garden bed. Recorded steps on a gritty path and
 * a recorded soft impact give the contact; original crumbling grains make it soil rather than a cushion.
 */

const STEPS: readonly Take[] = [
  { sample: 'step-earth-a', rate: 1, ring: 0 },
  { sample: 'step-earth-b', rate: 1.02, ring: 0 },
  { sample: 'step-earth-c', rate: 0.98, ring: 0 },
];

/** A foot on a packed path: the recorded heel and toe with the brightest grit taken down, and the ground's give. */
export const EARTH_STEP = action(STEPS, -3.3, (voice, take) => {
  const t = voice.t;
  voice.room = 0.02;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 80, 0.6), voice.filter('peaking', 4600, 0.8, -5),
    voice.filter('lowpass', 6000, 0.5), voice.gain(0.36), voice.out);
  weight(voice, t, 0.05, 300, 0.024);
});

const CLODS: readonly Take[] = [
  { sample: 'soft-a', rate: 1.08, ring: 0 },
  { sample: 'soft-b', rate: 1.02, ring: 0 },
  { sample: 'soft-c', rate: 1.12, ring: 0 },
];

const CRUMBLE = [
  [[0.012, 0.03], [0.026, 0.022], [0.041, 0.018], [0.063, 0.011], [0.09, 0.007], [0.12, 0.004]],
  [[0.009, 0.026], [0.02, 0.024], [0.037, 0.015], [0.055, 0.012], [0.08, 0.008], [0.105, 0.005]],
  [[0.015, 0.032], [0.031, 0.019], [0.05, 0.014], [0.072, 0.009], [0.1, 0.005]],
] as const;

/** A clod of soil set down and patted: the soft weight of it landing, soil crumbling off its edges, a palm's pat. */
export const EARTH_PLACE = action(CLODS, -4.8, (voice, take, variation) => {
  const t = voice.t, contact = t + 0.024;
  voice.room = 0.03;
  hand(voice, t, 0.035, 1300);
  voice.chain(voice.sample(take.sample, contact, take.rate), voice.filter('highpass', 90, 0.7), voice.filter('peaking', 240, 0.9, 5),
    voice.filter('lowpass', 1500, 0.5), voice.gain(0.42), voice.out);
  grains(voice, CRUMBLE[variation]!.map(([at, level]) => [contact + at, level] as const), 2300, 0.8, 0.0045);
  weight(voice, contact + 0.11, 0.05, 650, 0.018);
});

const TRICKLE = [
  [[0.05, 0.02], [0.075, 0.016], [0.105, 0.012], [0.14, 0.009], [0.18, 0.006], [0.23, 0.003]],
  [[0.045, 0.018], [0.065, 0.017], [0.095, 0.011], [0.13, 0.008], [0.17, 0.005]],
  [[0.055, 0.022], [0.085, 0.013], [0.12, 0.01], [0.16, 0.007], [0.21, 0.004]],
] as const;

/** Soil lifted out: it lets go of the ground, rises, and a little trickles back down. */
export const EARTH_REMOVE = action(CLODS, -0.7, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.03;
  // The clod lets go of the bed: a soft, small version of it landing, and the suck of soil parting.
  voice.chain(voice.sample(take.sample, t, take.rate * 1.3), voice.filter('highpass', 110, 0.6), voice.filter('lowpass', 1200, 0.5),
    voice.gain(0.22), voice.out);
  const release = voice.gain(0);
  voice.bloom(release.gain, t, 0.02, 0.12, 0.026);
  voice.chain(voice.noise(t, t + 0.2), voice.filter('lowpass', 900, 0.7), voice.filter('highpass', 90, 0.6), release, voice.out);
  lift(voice, t + 0.02, 0.025, 420, 1250, 0.15);
  grains(voice, TRICKLE[variation]!.map(([at, level]) => [t + at, level * 2.4] as const), 2600, 0.9, 0.004);
});

const RUB = [
  [[0.01, 0.016], [0.022, 0.012], [0.03, 0.014], [0.045, 0.009], [0.06, 0.007], [0.08, 0.004]],
  [[0.012, 0.014], [0.019, 0.013], [0.034, 0.011], [0.048, 0.008], [0.07, 0.005]],
  [[0.008, 0.015], [0.026, 0.013], [0.039, 0.01], [0.052, 0.009], [0.075, 0.005]],
] as const;

/** A pinch of soil rubbed between finger and thumb. */
export const EARTH_MATERIAL = action(CLODS, 1.1, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.02;
  hand(voice, t, 0.024, 1250);
  voice.chain(voice.sample(take.sample, t + 0.01, take.rate * 1.45), voice.filter('highpass', 120, 0.6), voice.filter('lowpass', 1400, 0.5),
    voice.gain(0.16), voice.out);
  grains(voice, RUB[variation]!.map(([at, level]) => [t + at, level] as const), 3000, 0.9, 0.003);
});
