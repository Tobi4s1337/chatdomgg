import { cents, noteHz, type PaletteNote } from '../palette';
import { SAMPLES, type SampleId } from '../samples';
import type { VoiceGraph } from '../voice';

/**
 * A window lighting because someone came home. In order: a fingertip of glass (a recorded light glass tap, tuned an
 * octave above the note and kept far back), the wick catching (a soft puff and a breath of noise opening upward),
 * then a warm glow that blooms rather than strikes: a slow-attack tone in the kingdom palette with a gently beating
 * twin, a quiet octave and an undertone. No bright attack, no rising reward phrase; it settles in under two seconds.
 * Variations are three windows: different notes of the same chord, different panes, a different catch of flame.
 */
interface WindowLight {
  note: PaletteNote;
  glass: SampleId;
  breath: readonly [fromHz: number, toHz: number];
  puff: number;
}

const LIGHTS: readonly WindowLight[] = [
  { note: 'F#4', glass: 'glass-tap-a', breath: [420, 1600], puff: 330 },
  { note: 'A4', glass: 'glass-tap-b', breath: [380, 1450], puff: 300 },
  { note: 'D5', glass: 'glass-tap-c', breath: [460, 1750], puff: 360 },
];

export const WINDOW_LIGHT = {
  variations: LIGHTS.length,
  samples: LIGHTS.map(item => item.glass),
  build(voice: VoiceGraph, variation: number): void {
    const light = LIGHTS[variation]!, t = voice.t, f = noteHz(light.note);
    voice.room = 0.2;

    // Glass touched: tuned to the octave above the note, dulled so it reads as a pane, not a chime.
    const glassRate = (f * 2) / SAMPLES[light.glass].peakHz;
    voice.chain(voice.sample(light.glass, t, glassRate), voice.filter('highpass', 480, 0.6),
      voice.filter('lowpass', 3000, 0.6), voice.gain(0.085), voice.out);

    // The wick catches: a low puff and a short breath of air that opens as the flame takes.
    const puff = voice.gain(0);
    voice.envelope(puff.gain, t + 0.012, 0.014, 0.075, 0.045);
    voice.chain(voice.noise(t + 0.012, t + 0.3), voice.filter('highpass', 120, 0.6), voice.filter('lowpass', light.puff, 0.7), puff, voice.out);

    const breath = voice.gain(0), sweep = voice.filter('bandpass', light.breath[0], 0.9);
    sweep.frequency.setValueAtTime(light.breath[0], t + 0.02);
    sweep.frequency.exponentialRampToValueAtTime(light.breath[1], t + 0.15);
    voice.envelope(breath.gain, t + 0.02, 0.03, 0.06, 0.085);
    voice.chain(voice.noise(t + 0.02, t + 0.6), sweep, voice.filter('lowpass', 2600, 0.5), breath, voice.out);

    // The glow, entering just behind the flame.
    const glow = voice.filter('lowpass', 2800, 0.5), at = t + 0.035;
    glow.connect(voice.out);
    voice.partial(glow, 'sine', f, at, 0.055, 0.068, 0.42);
    voice.partial(glow, 'sine', cents(f, 6.5), at, 0.07, 0.034, 0.38);
    voice.partial(glow, 'sine', f * 2, at, 0.035, 0.02, 0.25);
    voice.partial(glow, 'sine', f * 3, at, 0.03, 0.007, 0.14);
    const under = voice.filter('lowpass', 900, 0.5);
    under.connect(glow);
    voice.partial(under, 'triangle', f / 2, at, 0.09, 0.028, 0.3);
  },
};
