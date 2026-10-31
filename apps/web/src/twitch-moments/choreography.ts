/**
 * Authored timings. Every visual and sound cue is a pure function of elapsed beat time, so a beat looks and
 * sounds the same at any render frame interval. Durations are in milliseconds.
 */

export const BANNER_BEAT = {
  /** The furled cloth drops into its bracket and the horn calls. */
  anticipation: 1100,
  /** The cloth unrolls down the wall. */
  action: 3000,
  /** It overshoots, sways and comes to rest in the breeze. */
  settle: 5400,
  /** The whole beat, including the held, named view of the home. */
  end: 9200,
  horn: 380,
  cloth: 1080,
  captionIn: [1500, 2200],
  captionOut: [7900, 8900],
} as const;

/** A new named beat waits at least this long after the previous one starts: one subject at a time. */
export const BEAT_SPACING_MS = 3600;
/** Hard caps for transient presentation. */
export const MOMENT_LIMITS = { beats: 12, pendingBeats: 16, captions: 3, audio: 24, nameLength: 28 } as const;

/** Month ribbons are authored at these counts (Twitch.md, sub pieces). */
export const MONTH_RIBBONS = [1, 3, 6, 9, 12, 18, 24, 36, 48, 60] as const;
export const ribbonsFor = (months: number) => MONTH_RIBBONS.filter(m => months >= m).length;

export type BeatPhase = 'anticipation' | 'action' | 'settle' | 'hold';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;

export interface BannerPose {
  readonly phase: BeatPhase;
  /** 0 is a furled roll at the rod, 1 is the full cloth hanging. */
  readonly unfurl: number;
  /** The furled roll's drop into the bracket: metres above its seat. */
  readonly drop: number;
  /** Extra sway amplitude on top of the idle breeze, 0..1. */
  readonly swing: number;
  /** Signed swing at this instant, for the cloth's lower rows. */
  readonly swingPhase: number;
  readonly caption: number;
}

/** Pose of a home banner `t` ms into its unfurl beat. */
export function bannerPose(t: number): BannerPose {
  const b = BANNER_BEAT;
  const phase: BeatPhase = t < b.anticipation ? 'anticipation' : t < b.action ? 'action' : t < b.settle ? 'settle' : 'hold';
  // Anticipation: the roll falls the last 0.45 m into its bracket with a small, weighted bounce.
  const fall = clamp01(t / 520);
  const bounce = t < 520 ? 0 : Math.sin(clamp01((t - 520) / 380) * Math.PI) * 0.035;
  const drop = (1 - fall * fall) * 0.45 + bounce;
  const unfurl = t < b.anticipation ? 0 : easeOutCubic((t - b.anticipation) / (b.action - b.anticipation));
  // The cloth arrives with momentum, overshoots and settles within the settle phase.
  const since = Math.max(0, t - b.action * 0.82);
  const swing = t < b.action * 0.82 ? 0 : Math.exp(-since / 900) * (1 - smooth(b.settle - 400, b.settle + 600, t));
  const swingPhase = Math.sin(since / 1000 * Math.PI * 2 * 0.9) * swing;
  const caption = smooth(b.captionIn[0], b.captionIn[1], t) * (1 - smooth(b.captionOut[0], b.captionOut[1], t));
  return { phase, unfurl, drop, swing, swingPhase, caption };
}

/** Idle breeze, shared by every flying banner but offset per home so a street never waves in unison. */
export function breeze(atMs: number, slot: number): number {
  const s = atMs / 1000, offset = (slot * 2.399) % (Math.PI * 2);
  return Math.sin(s * 1.3 + offset) * 0.6 + Math.sin(s * 2.9 + offset * 1.7) * 0.25 + Math.sin(s * 0.47 + offset * 0.3) * 0.15;
}
