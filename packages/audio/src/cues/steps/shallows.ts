import { action } from '../materials/handling';
import { bubbles, swish, type Bubble, type GroundTake } from './ground';

/**
 * Shallows: ankle-deep water at a shore, a ford or a flooded path. No CC0 recording of one wading step in the packs
 * we use, so it is built: a recorded soft impact (Kenney Impact Sounds), darkened, is the foot finding the bed; the
 * water is original synthesis: the splash thrown up as the foot breaks the surface, the slosh of water closing round
 * the ankle, bubbles rising off the foot, and drops falling back.
 */

interface Wade extends GroundTake { bubbles: readonly Bubble[]; drops: readonly Bubble[] }

const STEPS: readonly Wade[] = [
  {
    sample: 'soft-a', rate: 0.86, ring: 0, level: 1,
    bubbles: [[0.034, 560, 920, 0.03], [0.1, 780, 1240, 0.02]],
    drops: [[0.072, 1900, 2900, 0.012], [0.105, 2500, 3600, 0.008], [0.14, 1600, 2400, 0.009], [0.18, 2200, 3200, 0.005], [0.225, 1800, 2700, 0.004]],
  },
  {
    sample: 'soft-b', rate: 0.9, ring: 0, level: 1,
    bubbles: [[0.04, 620, 1010, 0.026], [0.096, 520, 860, 0.018], [0.16, 900, 1380, 0.012]],
    drops: [[0.066, 2300, 3300, 0.011], [0.098, 1700, 2600, 0.009], [0.132, 2700, 3600, 0.007], [0.17, 2000, 2900, 0.005], [0.215, 1500, 2200, 0.003]],
  },
  {
    sample: 'soft-c', rate: 0.84, ring: 0, level: 1,
    bubbles: [[0.03, 700, 1150, 0.028], [0.11, 600, 980, 0.017]],
    drops: [[0.078, 2100, 3100, 0.012], [0.11, 1800, 2700, 0.008], [0.146, 2600, 3500, 0.007], [0.19, 1700, 2500, 0.004]],
  },
];

/** A foot wading in shallow water: the bed underfoot, the splash, the slosh round the ankle, bubbles and drops. */
export const SHALLOWS_STEP = action(STEPS, -2.5, (voice, take) => {
  const t = voice.t;
  voice.room = 0.02;
  voice.chain(voice.sample(take.sample, t + 0.006, take.rate), voice.filter('highpass', 70, 0.6), voice.filter('lowpass', 650, 0.6),
    voice.gain(0.2 * take.level), voice.out);
  // The surface breaking: water thrown up, its band rising as the spray opens; then the water closing back in.
  swish(voice, t, 0.05, 650, 1700, 0.07, 5200, 0.6);
  swish(voice, t + 0.03, 0.03, 520, 320, 0.12, 1400, 0.7);
  bubbles(voice, take.bubbles);
  bubbles(voice, take.drops, 0.006, 0.012);
});
