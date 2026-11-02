import { action, grains, weight } from '../materials/handling';
import { at, swish, type GroundTake } from './ground';

/**
 * Grass and meadow. Recorded steps on grass give the heel and the crushed blades. Lawn grass is a short, soft
 * contact; meadow grass is the same foot in stalks to the shin, so it is softer at the heel and carries an
 * original swish of stalks parting and springing back after it.
 */

const LAWN: readonly GroundTake[] = [
  { sample: 'step-grass-b', rate: 1, ring: 0, level: 1 },
  { sample: 'step-grass-c', rate: 1.03, ring: 0, level: 1.05 },
  { sample: 'step-grass-e', rate: 0.97, ring: 0, level: 1 },
];

const BLADES = [
  [[0.012, 0.009], [0.027, 0.007], [0.046, 0.004]],
  [[0.01, 0.008], [0.022, 0.008], [0.037, 0.005], [0.058, 0.003]],
  [[0.015, 0.009], [0.033, 0.006], [0.052, 0.003]],
] as const;

/** A foot on short grass: the recorded heel, its top softened, a little weight, and blades crushed under the sole. */
export const GRASS_STEP = action(LAWN, -1.6, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.015;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 90, 0.6), voice.filter('peaking', 3800, 0.8, -4),
    voice.filter('lowpass', 6200, 0.5), voice.gain(0.4 * take.level), voice.out);
  weight(voice, t, 0.045, 280, 0.02);
  grains(voice, at(t, BLADES[variation]!), 2600, 0.9, 0.003);
});

const STALKS: readonly GroundTake[] = [
  { sample: 'step-grass-a', rate: 0.97, ring: 0, level: 1 },
  { sample: 'step-grass-d', rate: 1, ring: 0, level: 1 },
  { sample: 'step-grass-b', rate: 0.93, ring: 0, level: 0.85 },
];

/** Where each take's stalks part (first swish) and spring back (second), and their bands. */
const PARTING = [
  { part: [0, 0.018, 1500, 950], back: [0.085, 0.008, 2200, 1500] },
  { part: [0.004, 0.017, 1400, 900], back: [0.095, 0.0075, 2100, 1450] },
  { part: [0, 0.019, 1600, 1000], back: [0.075, 0.0085, 2400, 1600] },
] as const;

/** A foot through meadow grass: a softer heel, stalks parting round the shin and springing back behind it. */
export const MEADOW_STEP = action(STALKS, -0.2, (voice, take, variation) => {
  const t = voice.t, { part, back } = PARTING[variation]!;
  voice.room = 0.012;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 110, 0.6), voice.filter('lowpass', 3400, 0.5),
    voice.gain(0.34 * take.level), voice.out);
  swish(voice, t + part[0], part[1], part[2], part[3], 0.11, 3600);
  swish(voice, t + back[0], back[1], back[2], back[3], 0.09, 4000, 1);
});
