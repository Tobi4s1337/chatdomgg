import { action, grains, weight } from '../materials/handling';
import { at, type GrainTable, type GroundTake } from './ground';

/**
 * Gravel. There is no clean CC0 recording of a single step on gravel in the packs we use, so this one is built: a
 * recorded crunchy step on a gritty dirt path (Kenney RPG Audio) gives the heel and the body of the crunch, and two
 * original grain layers add the stones: coarse ones shifting against each other and small pebbles ticking.
 */

const STEPS: readonly GroundTake[] = [
  { sample: 'step-soil-e', rate: 1.06, ring: 0, level: 0.6 },
  { sample: 'step-soil-d', rate: 1.02, ring: 0, level: 1 },
  { sample: 'step-soil-b', rate: 1.09, ring: 0, level: 1 },
];

const STONES: readonly GrainTable[] = [
  [[0.004, 0.034], [0.013, 0.026], [0.024, 0.03], [0.038, 0.02], [0.055, 0.014], [0.078, 0.008]],
  [[0.003, 0.03], [0.011, 0.032], [0.02, 0.022], [0.033, 0.025], [0.049, 0.015], [0.07, 0.009]],
  [[0.005, 0.036], [0.016, 0.024], [0.028, 0.026], [0.043, 0.017], [0.062, 0.011], [0.09, 0.006]],
];

const PEBBLES: readonly GrainTable[] = [
  [[0.007, 0.02], [0.012, 0.016], [0.019, 0.022], [0.027, 0.014], [0.034, 0.017], [0.046, 0.011], [0.061, 0.009], [0.084, 0.006], [0.11, 0.004]],
  [[0.005, 0.018], [0.01, 0.021], [0.017, 0.013], [0.025, 0.019], [0.036, 0.012], [0.044, 0.014], [0.059, 0.008], [0.077, 0.006], [0.1, 0.004]],
  [[0.008, 0.022], [0.015, 0.015], [0.021, 0.019], [0.031, 0.016], [0.04, 0.011], [0.052, 0.012], [0.068, 0.007], [0.092, 0.005]],
];

/** A foot on loose gravel: the recorded crunch, the stones shifting under the sole and pebbles ticking off it. */
export const GRAVEL_STEP = action(STEPS, -4.2, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.02;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 110, 0.6), voice.filter('peaking', 1400, 0.9, 3),
    voice.filter('lowpass', 6000, 0.5), voice.gain(0.34 * take.level), voice.out);
  weight(voice, t, 0.04, 300, 0.016);
  grains(voice, at(t, STONES[variation]!), 1500, 1.1, 0.004);
  grains(voice, at(t, PEBBLES[variation]!), 3400, 1.4, 0.0018);
});
