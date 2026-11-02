import { action, grains, weight } from '../materials/handling';
import { at, type GrainTable, type GroundTake } from './ground';

/**
 * Cobbles: rounded setts with grit in the joints. Built from recorded steps on hard stone (Kenney Impact Sounds),
 * the same family as the flagstone step, but voiced harder and knockier, with original layers for what makes a
 * cobbled street: the sole rocking onto the next sett a moment after the heel, and grit crunching in the joints.
 */

/** `rock`: when the toe comes down on the next sett, after the heel. */
interface Sett extends GroundTake { rock: number }

const STEPS: readonly Sett[] = [
  { sample: 'step-sett-a', rate: 1.04, ring: 0, level: 1.25, rock: 0.048 },
  { sample: 'step-sett-b', rate: 0.98, ring: 0, level: 1, rock: 0.056 },
  { sample: 'step-stone-a', rate: 1.06, ring: 0, level: 1, rock: 0.042 },
];

const JOINTS: readonly GrainTable[] = [
  [[0.008, 0.016], [0.019, 0.012], [0.052, 0.01], [0.064, 0.006]],
  [[0.006, 0.014], [0.015, 0.013], [0.028, 0.008], [0.061, 0.009], [0.074, 0.005]],
  [[0.01, 0.017], [0.022, 0.01], [0.047, 0.011], [0.06, 0.006]],
];

/** A sole on cobbles: a hard heel, the toe rocking down onto the next sett, grit crunching in the joints. */
export const COBBLE_STEP = action(STEPS, -1.6, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.03;
  const contact = voice.filter('highpass', 120, 0.6);
  voice.chain(contact, voice.filter('peaking', 2400, 0.9, 2), voice.filter('peaking', 4800, 0.8, -4), voice.filter('lowpass', 7000, 0.5), voice.out);
  voice.chain(voice.sample(take.sample, t, take.rate), voice.gain(0.42 * take.level), contact);
  voice.chain(voice.sample(take.sample, t + take.rock, take.rate * 1.24), voice.filter('highpass', 420, 0.6), voice.gain(0.15 * take.level), contact);
  weight(voice, t, 0.06, 300, 0.012);
  grains(voice, at(t, JOINTS[variation]!), 3800, 1.2, 0.0022);
});
