/**
 * The forge's mood, authored as one fixed beat. Every value here is a pure function of the
 * seconds since the host admitted the beat, so a seek, a skipped frame or a tab return lands
 * on the same pose and can never replay the cough.
 */

/** Published length of the beat. The host may release its anonymous shot after this. */
export const FORGE_MOOD_DURATION = 3.6;

/** Phase boundaries in seconds: anticipation, one cough, the sulk, then recovery and settle. */
export const FORGE_MOOD_PHASES = {
  anticipation: [0, 0.25],
  cough: [0.25, 0.8],
  sulk: [0.8, 2.3],
  recovery: [2.3, FORGE_MOOD_DURATION],
} as const;

/** When the soot leaves the anvil. The caption follows shortly after. */
export const FORGE_MOOD_COUGH_AT = 0.27;
/** The little after-sigh, a few crumbs of soot in the middle of the sulk. */
export const FORGE_MOOD_SIGH_AT = 1.5;

const CAPTION_IN: readonly [number, number] = [0.38, 0.66];
const CAPTION_OUT: readonly [number, number] = [2.95, 3.3];

/** `auto` follows the viewer's `prefers-reduced-motion`; a review bench may force either choice. */
export type ForgeMoodMotion = 'auto' | 'full' | 'reduced';

export type ForgeMoodPhase = keyof typeof FORGE_MOOD_PHASES | 'settled';

export const clamp01 = (n: number) => n < 0 ? 0 : n > 1 ? 1 : n;
export const smooth = (a: number, b: number, t: number) => { const u = clamp01((t - a) / (b - a)); return u * u * (3 - 2 * u); };
/** Deterministic per-particle hash in [0, 1); no random source enters the beat. */
export const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); };

export function forgeMoodPhase(t: number): ForgeMoodPhase {
  if (t >= FORGE_MOOD_DURATION) return 'settled';
  for (const [name, [, end]] of Object.entries(FORGE_MOOD_PHASES)) if (t < end) return name as ForgeMoodPhase;
  return 'settled';
}

/**
 * The forge's fire, as one level: 1 is its ordinary warm resting glow. It breathes in a
 * little before the cough, drops on it, sulks low, perks up past normal, then settles away.
 */
export function emberLevel(t: number): number {
  if (t <= 0 || t >= FORGE_MOOD_DURATION) return 0;
  const appear = smooth(0, 0.14, t);
  const inhale = 0.28 * smooth(0.06, 0.25, t) * (1 - smooth(0.25, 0.33, t));
  const dip = 0.66 * smooth(0.25, 0.42, t) * (1 - smooth(2.3, 2.62, t));
  const sigh = 0.1 * smooth(1.42, 1.62, t) * (1 - smooth(1.75, 2.1, t));
  const perk = 0.2 * smooth(2.4, 2.62, t) * (1 - smooth(2.62, 2.95, t));
  const settle = 1 - smooth(3.0, 3.5, t);
  return Math.max(0, (appear + inhale - dip - sigh + perk) * settle);
}

/** Small ember motion: an intake toward the cough, a startled scatter, a droop, a little hop. */
export function emberMotion(t: number) {
  const draw = smooth(0.06, 0.25, t) * (1 - smooth(0.25, 0.32, t));
  const scatter = smooth(0.25, 0.36, t) * (1 - smooth(0.36, 1.0, t));
  const droop = smooth(0.5, 1.2, t) * (1 - smooth(2.3, 2.55, t));
  // A damped hop as the forge pulls itself together.
  const h = t - 2.36;
  const hop = h > 0 && h < 0.75 ? Math.sin(h / 0.75 * Math.PI * 2.2) * Math.exp(-h * 4.2) * 1.15 : 0;
  const sink = smooth(3.05, 3.5, t);
  return { draw, scatter, droop, hop, sink };
}

/**
 * Caption presentation: opacity, a few pixels of rise, and whether it should be shown at all.
 * Reduced motion keeps the same fade on the same clock and drops the rise.
 */
export function captionPose(t: number, reduced = false) {
  if (!(t >= CAPTION_IN[0] && t < CAPTION_OUT[1])) return { visible: false, opacity: 0, rise: 0 };
  const fadeIn = smooth(CAPTION_IN[0], CAPTION_IN[1], t), fadeOut = smooth(CAPTION_OUT[0], CAPTION_OUT[1], t);
  return { visible: true, opacity: fadeIn * (1 - fadeOut), rise: reduced ? 0 : (1 - fadeIn) * 6 - fadeOut * 4 };
}
