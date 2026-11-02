/** Every beat of a catch that has its own sound, in the order a catch usually plays them. */
export type PierCue =
  | 'draw'      // rod drawn back: soft creak of willow + line through guides
  | 'cast'      // the swish of the rod and the line singing out (pitch falling as it flies, ~0.65 s)
  | 'plop'      // the float landing: a small round plop, then a faint ring shimmer
  | 'nibble'    // a tiny tick-tock of the float, very quiet
  | 'bite'      // the float dips hard: a sharp wet splash-snap
  | 'strike'    // setting the hook: rod whip + line twang
  | 'run'       // the fish runs: a quick buzz of line peeling off the reel (drag)
  | 'snap'      // line breaks: a dry crack and a loose whip
  | 'escape'    // fish throws the hook: a slack slap on the water
  | 'leap'      // the fish breaks the surface: a bright splash with droplets
  | 'flop'      // the fish lands on the planks: a wet slap on wood, two little flaps
  | 'tag'       // paper tag sliding in
  | 'seal'      // a soft ink stamp thump
  | 'take'      // taking the rod from the rack: wood knock + a little cloth
  | 'stow';     // putting it down

export const PIER_CUES: readonly PierCue[] = [
  'draw', 'cast', 'plop', 'nibble', 'bite', 'strike', 'run', 'snap', 'escape', 'leap', 'flop', 'tag', 'seal', 'take', 'stow',
];

export interface PierCueOptions {
  /** Metres from the listener; another walker's rod is quieter and duller with distance. */
  readonly distance?: number;
  /** -1 left to +1 right. */
  readonly pan?: number;
  /** 0..1, default 0.5: loudness, brightness and size (a big fish's splash is bigger). */
  readonly intensity?: number;
}

export type PierMood = 'clear' | 'breeze' | 'mist' | 'rain';

export interface PierAmbience {
  readonly near: number;
  readonly mood: PierMood;
  readonly hour: number;
}

export interface PierSoundHost {
  context: AudioContext;
  destination: AudioNode;
}

export interface PierSound {
  cue(kind: PierCue, options?: PierCueOptions): void;
  /** Continuous reel ratchet while reeling, 0 = silent, 1 = fast. */
  reel(rate: number): void;
  /** Line under load: a quiet creak/strain that rises towards snapping, 0..1. */
  tension(value: number): void;
  /**
   * The pier bed: lapping water against piles and a faint warm lantern hum, scaled by how near the listener is
   * (0..1), with rain hiss / breeze / mist hush by mood, and the lantern hum only after dusk.
   */
  ambience(value: PierAmbience): void;
  dispose(): void;
}
