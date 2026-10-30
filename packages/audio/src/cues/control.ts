import type { SampleId } from '../samples';
import type { VoiceGraph } from '../voice';

/**
 * A carved wooden control pressed a millimetre in. A recorded light wood knock gives the real contact; an original
 * modal resonance gives it the ring of a small, dense block (maple-ish modes near 1 : 2.5 : 4.4), and a soft body
 * thock gives it weight. Each variation is a different knock on a different spot of the same block, so the modes
 * and the recording change together. Everything is gone within ~200 ms.
 */
interface WoodKnock {
  sample: SampleId;
  rate: number;
  modes: readonly (readonly [hz: number, peak: number, tau: number])[];
  body: readonly [hz: number, peak: number, tau: number];
  edge: number;
}

const WOOD: readonly WoodKnock[] = [
  { sample: 'wood-knock-a', rate: 1, modes: [[780, 0.075, 0.034], [1960, 0.03, 0.017], [3480, 0.011, 0.008]], body: [205, 0.11, 0.022], edge: 5200 },
  { sample: 'wood-knock-b', rate: 1.04, modes: [[705, 0.085, 0.038], [1830, 0.038, 0.015], [3010, 0.013, 0.007]], body: [190, 0.12, 0.024], edge: 4600 },
  { sample: 'wood-knock-c', rate: 0.97, modes: [[845, 0.07, 0.03], [2140, 0.034, 0.014], [3650, 0.015, 0.006]], body: [220, 0.1, 0.02], edge: 5800 },
];

export const WOOD_CONTROL = {
  variations: WOOD.length,
  samples: WOOD.map(item => item.sample),
  build(voice: VoiceGraph, variation: number): void {
    const knock = WOOD[variation]!, t = voice.t;
    voice.room = 0.05;

    // Recorded contact: rumble below the block's body removed, the brittle top softened.
    voice.chain(voice.sample(knock.sample, t, knock.rate), voice.filter('highpass', 170, 0.6),
      voice.filter('peaking', 2600, 1, -3), voice.filter('lowpass', 7200, 0.5), voice.gain(0.52), voice.out);

    // Ring of the carved block.
    const ring = voice.gain(1);
    ring.connect(voice.out);
    for (const [hz, peak, tau] of knock.modes) voice.partial(ring, 'sine', hz, t, 0.0015, peak, tau);

    // Weight: a short soft thock under the knock.
    const body = voice.filter('lowpass', 900, 0.5);
    body.connect(voice.out);
    voice.partial(body, 'triangle', knock.body[0], t, 0.002, knock.body[1], knock.body[2]);

    // The press edge: a very short breath of filtered noise as the control seats.
    const edge = voice.gain(0);
    voice.envelope(edge.gain, t, 0.0008, 0.045, 0.004);
    voice.chain(voice.noise(t, t + 0.04), voice.filter('bandpass', knock.edge, 1.3), edge, voice.out);
  },
};
