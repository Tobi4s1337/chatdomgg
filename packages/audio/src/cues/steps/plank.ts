import type { SampleId } from '../../samples';
import { action } from '../materials/handling';
import type { GroundTake } from './ground';

/**
 * Planks out of doors: a footbridge, a dock, a jetty. Recorded steps on wooden boards (Kenney Impact Sounds) give the
 * contact, as for the floorboards at home, but the boards here are longer and open underneath: an original hollow
 * sits lower and rings longer, the far end of the board knocks once on its beam (a recorded light wood knock), and
 * there is no room around it.
 */

/** `knock`: the light knock of the board's far end on its beam, `after` seconds behind the foot. */
interface Board extends GroundTake { knock: SampleId; after: number }

const STEPS: readonly Board[] = [
  { sample: 'step-plank-a', rate: 1, ring: 132, level: 1, knock: 'wood-knock-b', after: 0.052 },
  { sample: 'step-plank-b', rate: 0.97, ring: 118, level: 1.1, knock: 'wood-knock-a', after: 0.064 },
  { sample: 'step-wood-b', rate: 0.94, ring: 146, level: 0.85, knock: 'wood-knock-c', after: 0.058 },
];

/** A foot on a jetty board: the recorded thud, the hollow of the span below, and the board's end knocking its beam. */
export const PLANK_STEP = action(STEPS, -8.9, (voice, take) => {
  const t = voice.t;
  voice.room = 0;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 85, 0.7), voice.filter('peaking', 150, 0.9, -2),
    voice.filter('peaking', 520, 1, 4), voice.filter('lowpass', 3600, 0.5), voice.gain(0.62 * take.level), voice.out);

  // The span below: two modes of a long board between beams, lower and longer than a floorboard.
  const hollow = voice.filter('lowpass', 1100, 0.5);
  hollow.connect(voice.out);
  voice.partial(hollow, 'triangle', take.ring, t + 0.002, 0.003, 0.06, 0.05);
  voice.partial(hollow, 'sine', take.ring * 2.76, t + 0.002, 0.002, 0.02, 0.022);

  voice.chain(voice.sample(take.knock, t + take.after, 0.8), voice.filter('highpass', 240, 0.6), voice.filter('lowpass', 2600, 0.5),
    voice.gain(0.07), voice.out);
}, STEPS.map(take => take.knock));
