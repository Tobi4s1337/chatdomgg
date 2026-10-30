/**
 * The kingdom's one harmonic palette. Every tuned layer (window lights now, the wave and the beacon next) is drawn
 * from D major pentatonic so the whole light ceremony shares a key. Equal temperament, A4 = 440 Hz.
 */
const A4 = 440;
const SEMITONES = { D: -7, E: -5, 'F#': -3, A: 0, B: 2 } as const;

export type PaletteNote = `${keyof typeof SEMITONES}${number}`;

export function noteHz(note: PaletteNote): number {
  const match = /^(D|E|F#|A|B)(-?\d+)$/.exec(note);
  if (!match) throw new RangeError(`kingdom audio: ${note} is not in the D major pentatonic palette`);
  const name = match[1] as keyof typeof SEMITONES, octave = Number(match[2]);
  return A4 * 2 ** ((SEMITONES[name] + (octave - 4) * 12) / 12);
}

/** Small detune in cents used to give a sustained tone a slow, living beat instead of a static sine. */
export function cents(hz: number, amount: number): number {
  return hz * 2 ** (amount / 1200);
}
