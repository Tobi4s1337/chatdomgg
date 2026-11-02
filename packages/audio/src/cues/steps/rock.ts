import { action, grains, weight } from '../materials/handling';
import { at, swish, type GrainTable, type GroundTake } from './ground';

/**
 * Bare rock: an outcrop, a boulder, a mountain path. Built from recorded steps on hard stone (Kenney Impact Sounds)
 * played slower and deeper than the flagstone, so it reads as a mass of rock rather than a slab, with original
 * layers: the weight of it, the sole scuffing on weathered grit, and loose grit skittering away. Out in the open it
 * sends nothing to the room.
 */

const STEPS: readonly GroundTake[] = [
  { sample: 'step-sett-b', rate: 0.87, ring: 0, level: 0.85 },
  { sample: 'step-stone-c', rate: 0.89, ring: 0, level: 1 },
  { sample: 'step-stone-b', rate: 0.85, ring: 0, level: 1.1 },
];

const SKITTER: readonly GrainTable[] = [
  [[0.022, 0.014], [0.041, 0.009], [0.07, 0.006], [0.104, 0.003]],
  [[0.018, 0.012], [0.036, 0.011], [0.058, 0.006], [0.09, 0.004]],
  [[0.026, 0.015], [0.048, 0.008], [0.081, 0.005]],
];

/** A boot on bare rock: a solid, deep contact, a scuff on the grit, and grit skittering off. */
export const ROCK_STEP = action(STEPS, -3.2, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 75, 0.6), voice.filter('peaking', 190, 0.9, 2.5),
    voice.filter('peaking', 3000, 0.8, -3), voice.filter('lowpass', 6000, 0.5), voice.gain(0.44 * take.level), voice.out);
  weight(voice, t, 0.11, 200, 0.022);
  swish(voice, t + 0.006, 0.02, 2400, 1700, 0.05, 5200, 1);
  grains(voice, at(t, SKITTER[variation]!, 1.3), 2700, 1.2, 0.0024);
});
