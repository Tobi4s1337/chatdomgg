import { action, weight } from '../materials/handling';
import type { GroundTake } from './ground';

/**
 * Snow: recorded steps into packed snow give the crunch itself, the crystals squeaking as they compress. An original
 * soft weight underneath makes it a person sinking in. Snow swallows sound, so it sends almost nothing to the room.
 */

const STEPS: readonly GroundTake[] = [
  { sample: 'step-snow-a', rate: 1, ring: 0, level: 1 },
  { sample: 'step-snow-b', rate: 0.97, ring: 0, level: 0.68 },
  { sample: 'step-snow-c', rate: 1.03, ring: 0, level: 1 },
];

/** A foot pressing into snow: the recorded crunch with its boom and its air taken down, and the give underneath. */
export const SNOW_STEP = action(STEPS, -6.9, (voice, take) => {
  const t = voice.t;
  voice.room = 0.006;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 95, 0.6), voice.filter('peaking', 160, 0.8, -3),
    voice.filter('lowpass', 5200, 0.5), voice.gain(0.42 * take.level), voice.out);
  weight(voice, t + 0.01, 0.035, 240, 0.03);
});
