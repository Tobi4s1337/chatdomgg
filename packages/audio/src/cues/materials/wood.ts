import { action, damp, dampedLength, grains, hand, lift, type Take } from './handling';

/**
 * Timber: floorboards underfoot and a carved block set into a home. A recorded step on boards and a recorded block
 * of wood give the contact; an original hollow-board resonance and the block's own ring give them the size of a
 * small house. Dry, close and short.
 */

const STEPS: readonly Take[] = [
  { sample: 'step-wood-a', rate: 1, ring: 196 },
  { sample: 'step-wood-b', rate: 1.03, ring: 182 },
  { sample: 'step-wood-c', rate: 0.97, ring: 208 },
];

/** A board giving under a foot: the recorded thud, its boom kept small, and the hollow of the boards beneath. */
export const WOOD_STEP = action(STEPS, -8.6, (voice, take) => {
  const t = voice.t;
  voice.room = 0.03;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 100, 0.7), voice.filter('peaking', 150, 0.9, -3),
    voice.filter('peaking', 430, 1, 4), voice.filter('lowpass', 3400, 0.5), voice.gain(0.62), voice.out);

  // The hollow under the boards: two modes of a plank on joists.
  const hollow = voice.filter('lowpass', 1300, 0.5);
  hollow.connect(voice.out);
  voice.partial(hollow, 'triangle', take.ring, t + 0.002, 0.003, 0.05, 0.03);
  voice.partial(hollow, 'sine', take.ring * 2.41, t + 0.002, 0.002, 0.02, 0.016);

  // The heel's edge on the grain.
  grains(voice, [[t, 0.03]], 2300, 1.2, 0.004);
});

const BLOCKS: readonly Take[] = [
  { sample: 'timber-a', rate: 1, ring: 690 },
  { sample: 'timber-b', rate: 0.97, ring: 640 },
  { sample: 'timber-c', rate: 1.03, ring: 735 },
];

/** A timber block set into place: the palm, the block meeting wood, its ring, and a small second tock as it seats. */
export const WOOD_PLACE = action(BLOCKS, -2.2, (voice, take) => {
  const t = voice.t, contact = t + 0.028;
  voice.room = 0.05;
  hand(voice, t, 0.05, 1500);
  voice.chain(voice.sample(take.sample, contact, take.rate), voice.filter('highpass', 95, 0.6), voice.filter('peaking', 2800, 1, -2),
    voice.filter('lowpass', 6500, 0.5), voice.gain(0.46), voice.out);

  const ring = voice.gain(1);
  ring.connect(voice.out);
  voice.partial(ring, 'sine', take.ring, contact, 0.0015, 0.03, 0.03);
  voice.partial(ring, 'sine', take.ring * 2.62, contact, 0.001, 0.011, 0.014);

  // It seats: a quieter, duller tock a moment later.
  const seat = contact + 0.068, body = voice.filter('lowpass', 900, 0.5);
  body.connect(voice.out);
  voice.partial(body, 'triangle', take.ring * 0.36, seat, 0.002, 0.045, 0.014);
  grains(voice, [[seat, 0.022]], 1900, 1.1, 0.004);
});

const KNOCKS: readonly Take[] = [
  { sample: 'wood-knock-a', rate: 1.08, ring: 690 },
  { sample: 'wood-knock-b', rate: 1.12, ring: 640 },
  { sample: 'wood-knock-c', rate: 1.05, ring: 735 },
];

/** The block lifted out: a light knock as it unseats, its ring brief, then the lift. No splintering, no thud. */
export const WOOD_REMOVE = action(KNOCKS, 1.3, (voice, take) => {
  const t = voice.t;
  voice.room = 0.04;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 280, 0.6), voice.filter('lowpass', 5200, 0.5),
    voice.gain(0.4), voice.out);
  voice.partial(voice.out, 'sine', take.ring, t, 0.0015, 0.02, 0.02);
  lift(voice, t + 0.03, 0.022, 460, 1450, 0.15);
});

/** A piece of timber turned in the fingers: a fingertip on the grain and a small knock of a small piece. */
export const WOOD_MATERIAL = action(KNOCKS, 8.7, (voice, take) => {
  const t = voice.t, tap = t + 0.022;
  voice.room = 0.03;
  hand(voice, t, 0.028, 1900);
  const hold = 0.05, tau = 0.02;
  voice.chain(voice.sample(take.sample, tap, take.rate * 1.18, 0, dampedLength(hold, tau)), voice.filter('highpass', 380, 0.6),
    voice.filter('lowpass', 5600, 0.5), voice.gain(0.15), damp(voice, tap, hold, tau), voice.out);
  voice.partial(voice.out, 'sine', take.ring * 1.22, tap, 0.0012, 0.009, 0.016);
});
