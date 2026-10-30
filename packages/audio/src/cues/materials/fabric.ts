import { action, damp, dampedLength, hand, lift, type Take } from './handling';

/**
 * Cloth: a rug underfoot and a folded hanging laid into a home. Recorded steps on carpet and recorded cloth handling
 * give it its texture; everything above ~3 kHz is softened so cloth stays the quietest surface in the kingdom, a
 * hush rather than a hiss.
 */

const STEPS: readonly Take[] = [
  { sample: 'step-fabric-a', rate: 1, ring: 0 },
  { sample: 'step-fabric-b', rate: 0.96, ring: 0 },
  { sample: 'step-fabric-c', rate: 1.03, ring: 0 },
];

/** A foot on a rug: the recorded step, muffled, and the weave's whisper as the weight comes off. */
export const FABRIC_STEP = action(STEPS, -5.3, (voice, take) => {
  const t = voice.t;
  voice.room = 0.015;
  voice.chain(voice.sample(take.sample, t, take.rate), voice.filter('highpass', 100, 0.6), voice.filter('peaking', 300, 0.9, 3),
    voice.filter('lowpass', 2600, 0.5), voice.gain(0.4), voice.out);
  const whisper = voice.gain(0);
  voice.bloom(whisper.gain, t + 0.02, 0.018, 0.022, 0.03);
  voice.chain(voice.noise(t + 0.02, t + 0.28), voice.filter('bandpass', 950, 0.6), voice.filter('lowpass', 2400, 0.5), whisper, voice.out);
});

const FOLDS: readonly Take[] = [
  { sample: 'cloth-a', rate: 1, ring: 0 },
  { sample: 'cloth-b', rate: 0.96, ring: 0 },
  { sample: 'cloth-c', rate: 1.04, ring: 0 },
];
const LANDINGS = ['soft-b', 'soft-c', 'soft-a'] as const;

/** A folded cloth laid down: the palm, the cloth moving, and the soft landing of the fold. */
export const FABRIC_PLACE = action(FOLDS, -2.6, (voice, take, variation) => {
  const t = voice.t;
  voice.room = 0.025;
  hand(voice, t, 0.03, 1200);
  voice.chain(voice.sample(take.sample, t + 0.01, take.rate), voice.filter('highpass', 150, 0.6), voice.filter('highshelf', 3500, 0.707, -7),
    voice.filter('lowpass', 6000, 0.5), voice.gain(0.32), voice.out);
  voice.chain(voice.sample(LANDINGS[variation]!, t + 0.07, 1.2), voice.filter('highpass', 90, 0.6), voice.filter('lowpass', 700, 0.5),
    voice.gain(0.24), voice.out);
}, [...LANDINGS]);

/** The cloth picked up: part of the same rustle, lighter and brighter, and a soft lift. */
export const FABRIC_REMOVE = action(FOLDS, 0.7, (voice, take) => {
  const t = voice.t, hold = 0.09, tau = 0.03;
  voice.room = 0.02;
  voice.chain(voice.sample(take.sample, t, take.rate * 1.06, 0.04, dampedLength(hold, tau)), voice.filter('highpass', 260, 0.6),
    voice.filter('highshelf', 3500, 0.707, -6), voice.filter('lowpass', 6000, 0.5), voice.gain(0.22), damp(voice, t, hold, tau), voice.out);
  lift(voice, t + 0.02, 0.018, 380, 1100, 0.16);
});

/** A corner of cloth rubbed between the fingers. */
export const FABRIC_MATERIAL = action(FOLDS, 0.8, (voice, take) => {
  const t = voice.t, hold = 0.07, tau = 0.025;
  voice.room = 0.015;
  hand(voice, t, 0.016, 1100);
  voice.chain(voice.sample(take.sample, t + 0.008, take.rate * 1.1, 0.02, dampedLength(hold, tau)), voice.filter('highpass', 300, 0.6),
    voice.filter('highshelf', 3500, 0.707, -6), voice.filter('lowpass', 5500, 0.5), voice.gain(0.18), damp(voice, t + 0.008, hold, tau), voice.out);
});
