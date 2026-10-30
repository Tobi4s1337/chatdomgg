import { cents, noteHz, type PaletteNote } from '../palette';
import { SAMPLES, type SampleId } from '../samples';
import type { VoiceGraph } from '../voice';

/**
 * The castle beacon, lit because the whole street came home. First the physical ignition: the torch set down into
 * the brazier (a recorded wooden beam, kept low and dull), the oil catching in a soft rising whoomph and a scatter of
 * sparks. Out of the fire comes one broad, warm chord of the palette, voiced low to high and entering from the bottom
 * up, so it arrives rather than strikes. The castle's windows catch on the way up (the same glass panes as a window
 * light), the chord opens to a clear crest, then closes and returns to quiet well inside five seconds.
 * Soft triangle and sine bodies only: no brass, no fanfare, no reward sting.
 */
interface Beacon {
  chord: readonly PaletteNote[];
  /** Castle windows catching on the way to the crest, as the notes they sound. */
  windows: readonly [PaletteNote, PaletteNote, PaletteNote];
  beam: SampleId;
  /** Seconds from ignition to the crest. */
  crest: number;
}

const BEACONS: readonly Beacon[] = [
  { chord: ['D3', 'A3', 'D4', 'F#4', 'A4', 'E5'], windows: ['A5', 'D6', 'F#6'], beam: 'beam-a', crest: 1.15 },
  { chord: ['D3', 'A3', 'E4', 'F#4', 'B4', 'D5'], windows: ['F#5', 'A5', 'D6'], beam: 'beam-b', crest: 1.25 },
  { chord: ['D3', 'A3', 'F#4', 'A4', 'D5', 'F#5'], windows: ['D6', 'A5', 'F#6'], beam: 'beam-c', crest: 1.05 },
];

const GLASS: readonly SampleId[] = ['glass-tap-a', 'glass-tap-b', 'glass-tap-c'];
/** Chord notes from the bottom up: how loud, how long they ring after the crest, and how soon after the last. */
const VOICING = [
  { peak: 0.054, tau: 0.9 }, { peak: 0.048, tau: 0.85 }, { peak: 0.04, tau: 0.78 },
  { peak: 0.036, tau: 0.72 }, { peak: 0.03, tau: 0.66 }, { peak: 0.021, tau: 0.58 },
] as const;
const STAGGER = 0.07;
/** Hard end of the cue. The chord bus fades out over the last half second so nothing is cut. */
const LENGTH = 4.95;

export const CASTLE_BEACON = {
  variations: BEACONS.length,
  samples: [...BEACONS.map(item => item.beam), ...GLASS],
  build(voice: VoiceGraph, variation: number): void {
    const beacon = BEACONS[variation]!, t = voice.t, crest = t + beacon.crest, end = t + LENGTH, random = voice.kit.random;
    voice.room = 0.24;

    // The torch set into the brazier.
    voice.chain(voice.sample(beacon.beam, t, 1, 0, 0.5), voice.filter('highpass', 75, 0.6),
      voice.filter('lowpass', 1300, 0.5), voice.gain(0.08), voice.out);

    // The oil catches: a soft whoomph that opens and closes like a flame taking hold.
    const whoomph = voice.gain(0), flame = voice.filter('lowpass', 220, 0.8);
    flame.frequency.setValueAtTime(220, t + 0.02);
    flame.frequency.exponentialRampToValueAtTime(1500, t + 0.3);
    flame.frequency.exponentialRampToValueAtTime(480, t + 1.8);
    voice.bloom(whoomph.gain, t + 0.02, 0.16, 0.085, 0.42);
    voice.chain(voice.noise(t + 0.02, t + 3), voice.filter('highpass', 60, 0.6), flame, whoomph, voice.out);

    // Sparks: one source, opened for a few milliseconds at a time, thinning out as the fire settles.
    const sparks = voice.gain(0);
    voice.chain(voice.noise(t + 0.1, t + 2.1), voice.filter('highpass', 1600, 0.7), voice.filter('lowpass', 5200, 0.6), sparks, voice.out);
    for (let at = t + 0.12 + random() * 0.03; at < t + 1.9; at += 0.025 + random() * random() * 0.16) {
      const size = 0.05 * Math.exp(-(at - t) / 0.7) * (0.45 + random() * 0.55);
      sparks.gain.setTargetAtTime(size, at, 0.0005);
      sparks.gain.setTargetAtTime(0, at + 0.0015, 0.004);
    }

    // The chord: one bus that opens towards the crest and closes again after it.
    const chord = voice.gain(1), open = voice.filter('lowpass', 520, 0.6);
    open.frequency.setValueAtTime(520, t);
    open.frequency.exponentialRampToValueAtTime(2400, crest);
    open.frequency.exponentialRampToValueAtTime(760, crest + 2.4);
    chord.gain.setValueAtTime(1, end - 0.5);
    chord.gain.linearRampToValueAtTime(0, end);
    voice.chain(chord, open, voice.out);

    beacon.chord.forEach((note, index) => {
      const { peak, tau } = VOICING[index]!, f = noteHz(note), at = t + 0.06 + index * STAGGER;
      const amp = voice.gain(0), stop = Math.min(end, crest + tau * 8);
      voice.bloom(amp.gain, at, crest - at, peak, tau);
      amp.connect(chord);
      voice.osc('triangle', f, at, stop).connect(amp);
      // A sine twin a few cents off gives each note a slow living beat; alternate sides of the pitch.
      const twin = voice.gain(0.6);
      voice.chain(voice.osc('sine', cents(f, index % 2 ? -5 : 5), at, stop), twin, amp);
    });

    // Castle windows catching on the way up, spread across the walls.
    beacon.windows.forEach((note, index) => {
      const glass = GLASS[(variation + index) % GLASS.length]!, at = crest - 0.55 + index * 0.22 + random() * 0.03;
      voice.chain(voice.sample(glass, at, noteHz(note) / SAMPLES[glass].peakHz), voice.filter('highpass', 600, 0.6),
        voice.filter('lowpass', 3400, 0.6), voice.gain(0.05), voice.pan([-0.35, 0.35, 0][index]!), voice.out);
    });
  },
};
