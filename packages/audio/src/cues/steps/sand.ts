import { action, grains } from '../materials/handling';
import { at, swish, type GrainTable, type GroundTake } from './ground';

/**
 * Sand. Built rather than recorded: no CC0 single step on dry sand in the packs we use was clean enough. A recorded
 * step on a dirt path (Kenney RPG Audio), played a little slower and heavily darkened, gives a sole sinking in with
 * no hard heel; an original swish is the sand pushed out from under it, and fine grains run off the edge of the shoe.
 */

const STEPS: readonly GroundTake[] = [
  { sample: 'step-soil-c', rate: 0.92, ring: 0, level: 1 },
  { sample: 'step-soil-a', rate: 0.9, ring: 0, level: 0.8 },
  { sample: 'step-earth-a', rate: 0.94, ring: 0, level: 0.9 },
];

const RUNNING: readonly GrainTable[] = [
  [[0.03, 0.007], [0.042, 0.009], [0.051, 0.006], [0.063, 0.008], [0.077, 0.005], [0.09, 0.006], [0.108, 0.004], [0.13, 0.003], [0.16, 0.002]],
  [[0.026, 0.008], [0.036, 0.006], [0.048, 0.009], [0.06, 0.005], [0.071, 0.007], [0.088, 0.004], [0.104, 0.004], [0.125, 0.002]],
  [[0.034, 0.008], [0.045, 0.007], [0.057, 0.008], [0.066, 0.005], [0.082, 0.006], [0.097, 0.004], [0.118, 0.003], [0.145, 0.002]],
];

/** A foot sinking into dry sand: a soft, dark contact, sand pushed aside, grains running off the shoe. */
export const SAND_STEP = action(STEPS, -2.8, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.01;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 80, 0.6), voice.filter('peaking', 260, 0.9, 2),
    voice.filter('lowpass', 1900, 0.6), voice.gain(0.24 * take.level), voice.out);
  swish(voice, t + 0.004, 0.022, 2600, 1700, 0.08, 4400, 0.7);
  grains(voice, at(t, RUNNING[variation]!), 3600, 0.8, 0.0035);
});
