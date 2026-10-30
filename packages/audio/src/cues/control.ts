import { noteHz } from '../palette';
import { SAMPLES, type SampleId } from '../samples';
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

/**
 * A small brass lever set in a wooden mount. A recorded light metal tap gives the true contact and shimmer, tuned so
 * its strongest mode lands on the palette (A6, A6, B6) and damped by the fingertip within ~200 ms. Under it, an
 * original ring of the lever an octave down with the inharmonic second mode of a thin bar (×2.76), the soft thock of
 * the wooden mount and a short bright edge as the detent seats. Warmer and lower than steel; never a bell.
 */
interface BrassTick {
  sample: SampleId;
  ring: number;
  body: number;
  edge: number;
}

const BRASS: readonly BrassTick[] = [
  { sample: 'brass-tick-a', ring: noteHz('A5'), body: 236, edge: 4200 },
  { sample: 'brass-tick-b', ring: noteHz('A5'), body: 224, edge: 3900 },
  { sample: 'brass-tick-c', ring: noteHz('B5'), body: 248, edge: 4500 },
];

export const BRASS_CONTROL = {
  variations: BRASS.length,
  samples: BRASS.map(item => item.sample),
  build(voice: VoiceGraph, variation: number): void {
    const tick = BRASS[variation]!, t = voice.t;
    voice.room = 0.06;

    // Recorded tap, tuned into the palette and damped by the finger that pressed it.
    const rate = (tick.ring * 2) / SAMPLES[tick.sample].peakHz, damp = voice.gain(1);
    damp.gain.setValueAtTime(1, t);
    damp.gain.setTargetAtTime(0, t + 0.045, 0.03);
    voice.chain(voice.sample(tick.sample, t, rate, 0, 0.26), voice.filter('highpass', 520, 0.6),
      voice.filter('lowpass', 5200, 0.5), voice.gain(0.22), damp, voice.out);

    // The lever's own ring: fundamental and the thin bar's second mode, both short.
    const ring = voice.filter('lowpass', 4200, 0.5);
    ring.connect(voice.out);
    voice.partial(ring, 'sine', tick.ring, t, 0.0015, 0.022, 0.042);
    voice.partial(ring, 'sine', tick.ring * 2.76, t, 0.001, 0.007, 0.022);

    // The wooden mount takes the press.
    const body = voice.filter('lowpass', 900, 0.5);
    body.connect(voice.out);
    voice.partial(body, 'triangle', tick.body, t, 0.002, 0.07, 0.016);

    // The detent seating: a very short, narrow breath of bright noise.
    const edge = voice.gain(0);
    voice.envelope(edge.gain, t, 0.0006, 0.03, 0.003);
    voice.chain(voice.noise(t, t + 0.03), voice.filter('bandpass', tick.edge, 1.6), edge, voice.out);
  },
};

/**
 * A sheet of parchment moved by hand: the sheet slides under the fingers, the page itself turns (a recorded book
 * page, its brightest air shelved down so it never hisses over a voice), and it settles softly onto the desk.
 * Variations are the same sheet handled again: a different page, a different slide and a different settle.
 */
interface ParchmentTurn {
  sample: SampleId;
  slide: number;
  settle: number;
}

const PARCHMENT: readonly ParchmentTurn[] = [
  { sample: 'page-a', slide: 2400, settle: 0.07 },
  { sample: 'page-b', slide: 2050, settle: 0.06 },
  { sample: 'page-c', slide: 2700, settle: 0.08 },
];

export const PARCHMENT_CONTROL = {
  variations: PARCHMENT.length,
  samples: PARCHMENT.map(item => item.sample),
  build(voice: VoiceGraph, variation: number): void {
    const turn = PARCHMENT[variation]!, t = voice.t;
    voice.room = 0.03;

    // Fingers on the sheet: a soft swell of paper-coloured noise just ahead of the turn.
    const slide = voice.gain(0);
    voice.bloom(slide.gain, t, 0.03, 0.045, 0.035);
    voice.chain(voice.noise(t, t + 0.3), voice.filter('bandpass', turn.slide, 0.7), voice.filter('lowpass', 5000, 0.5), slide, voice.out);

    // The page turns.
    voice.chain(voice.sample(turn.sample, t + 0.012), voice.filter('highpass', 340, 0.6),
      voice.filter('highshelf', 4200, 0.707, -8), voice.filter('lowpass', 7200, 0.5), voice.gain(0.5), voice.out);

    // It settles on the desk: a dull, unpitched touch.
    const settle = voice.gain(0), at = t + turn.settle;
    voice.envelope(settle.gain, at, 0.004, 0.14, 0.022);
    voice.chain(voice.noise(at, at + 0.2), voice.filter('lowpass', 380, 0.7), voice.filter('highpass', 90, 0.6), settle, voice.out);
  },
};
