import { cents, noteHz, type PaletteNote } from '../palette';
import { SAMPLES, type SampleId } from '../samples';
import type { VoiceGraph } from '../voice';

/**
 * A street lighting up behind the first window: five more windows catch one after another, travelling across the
 * stereo field like a ripple along the houses. Each is the window light in miniature (the same glass panes tuned an
 * octave above the note, the same wick breath, the same blooming glow) and the glows overlap into one soft chord of
 * the palette. It grows by gathering, not by rising: later windows are a little fuller and a warm undertone comes up
 * under the street. The phrases wander and settle rather than climb, so it never reads as a reward arpeggio.
 */
interface StreetWindow { note: PaletteNote; pan: number }

const GLASS: readonly SampleId[] = ['glass-tap-a', 'glass-tap-b', 'glass-tap-c'];
/** When each window catches, seconds after the first: quickening a little, like a ripple running down the street. */
const ONSETS = [0, 0.19, 0.36, 0.51, 0.64] as const;
/** Later windows are fuller: the street gathers. */
const LEVELS = [0.72, 0.8, 0.88, 0.95, 1] as const;

const STREETS: readonly (readonly StreetWindow[])[] = [
  // Left to right; settles on the D above.
  [{ note: 'A4', pan: -0.45 }, { note: 'F#4', pan: -0.22 }, { note: 'B4', pan: 0 }, { note: 'A4', pan: 0.22 }, { note: 'D5', pan: 0.45 }],
  // Right to left; drifts down to rest on A.
  [{ note: 'D5', pan: 0.45 }, { note: 'A4', pan: 0.22 }, { note: 'B4', pan: 0 }, { note: 'F#4', pan: -0.22 }, { note: 'A4', pan: -0.45 }],
  // From the middle outwards; the ninth falls to the octave.
  [{ note: 'F#4', pan: 0 }, { note: 'B4', pan: -0.25 }, { note: 'A4', pan: 0.25 }, { note: 'E5', pan: -0.48 }, { note: 'D5', pan: 0.48 }],
];

export const STREET_WAVE = {
  variations: STREETS.length,
  samples: GLASS,
  build(voice: VoiceGraph, variation: number): void {
    const street = STREETS[variation]!, t = voice.t, random = voice.kit.random;
    voice.room = 0.22;

    const glow = voice.filter('lowpass', 2800, 0.5);
    glow.connect(voice.out);

    // One wick source each for the puffs and the breaths of every window, shaped burst by burst.
    const puff = voice.gain(0), breath = voice.gain(0), sweep = voice.filter('bandpass', 420, 0.9), wickPan = voice.pan(0);
    voice.chain(voice.noise(t, t + 1.4), voice.filter('highpass', 120, 0.6), voice.filter('lowpass', 330, 0.7), puff, wickPan);
    voice.chain(voice.noise(t, t + 1.5), sweep, voice.filter('lowpass', 2600, 0.5), breath, wickPan);
    wickPan.connect(voice.out);

    street.forEach((window, index) => {
      // A few milliseconds of looseness: windows are lit by people, not a sequencer.
      const at = t + ONSETS[index]! + (index ? (random() - 0.5) * 0.024 : 0);
      const level = LEVELS[index]!, f = noteHz(window.note), place = voice.pan(window.pan);
      place.connect(glow);

      const glass = GLASS[(variation + index) % GLASS.length]!;
      voice.chain(voice.sample(glass, at, (f * 2) / SAMPLES[glass].peakHz), voice.filter('highpass', 480, 0.6),
        voice.filter('lowpass', 3000, 0.6), voice.gain(0.065 * level), place);

      wickPan.pan.setValueAtTime(window.pan * 0.7, at);
      burst(puff.gain, at + 0.01, 0.012, 0.05 * level, 0.04);
      sweep.frequency.setValueAtTime(400, at + 0.02);
      sweep.frequency.exponentialRampToValueAtTime(1550, at + 0.12);
      burst(breath.gain, at + 0.02, 0.025, 0.04 * level, 0.07);

      const glowAt = at + 0.03;
      voice.partial(place, 'sine', f, glowAt, 0.06, 0.048 * level, 0.36);
      voice.partial(place, 'sine', f * 2, glowAt, 0.04, 0.011 * level, 0.2);
      // The last window holds a little longer, with the light cue's slow beating twin.
      if (index === street.length - 1) voice.partial(place, 'sine', cents(f, 6.5), glowAt, 0.08, 0.022, 0.42);
    });

    // The street's warmth gathering underneath.
    const under = voice.gain(0);
    voice.bloom(under.gain, t + 0.1, 0.65, 0.022, 0.5);
    voice.chain(voice.osc('triangle', noteHz('D3'), t + 0.1, t + 0.75 + 0.5 * 8), voice.filter('lowpass', 700, 0.5), under, voice.out);
  },
};

/** One wick catching on a shared source: a smooth rise and fall, continuous with whatever burst came before it. */
function burst(param: AudioParam, at: number, attack: number, peak: number, tau: number): void {
  param.setTargetAtTime(peak, at, attack / 3);
  param.setTargetAtTime(0, at + attack, tau);
}
