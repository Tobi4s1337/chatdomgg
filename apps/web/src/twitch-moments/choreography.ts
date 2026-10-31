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

/**
 * A shared resub on a banner that already flies: the cloth lifts in a gust, the new ribbon drops from the rod's
 * knot and everything settles. The caption reads once the ribbon has landed.
 */
export const FLOURISH_BEAT = { gust: 300, ribbon: [900, 1700], settle: 4200, end: 7600, horn: 220, cloth: 420, captionIn: [1300, 1900], captionOut: [6400, 7300] } as const;

export interface FlourishPose { readonly phase: BeatPhase; readonly swing: number; readonly swingPhase: number; readonly ribbonDrop: number; readonly caption: number }

export function flourishPose(t: number): FlourishPose {
  const b = FLOURISH_BEAT;
  const phase: BeatPhase = t < b.gust ? 'anticipation' : t < b.ribbon[1] ? 'action' : t < b.settle ? 'settle' : 'hold';
  // Anticipation is a held breath: the cloth sinks back against the wall before the gust lifts it.
  const since = Math.max(0, t - b.gust);
  const swing = t < b.gust ? smooth(0, b.gust, t) * 0.25 : Math.exp(-since / 1100) * (1 - smooth(b.settle - 300, b.settle + 500, t));
  const swingPhase = t < b.gust ? -swing : Math.sin(since / 1000 * Math.PI * 2 * 0.85) * swing;
  // 0 tied at the knot, rising to 1 when the tail hangs at its full length; it overshoots by a hair and settles.
  const fall = clamp01((t - b.ribbon[0]) / (b.ribbon[1] - b.ribbon[0]));
  const ribbonDrop = t < b.ribbon[0] ? 0 : fall < 1 ? easeOutCubic(fall) : 1 + Math.sin(clamp01((t - b.ribbon[1]) / 420) * Math.PI) * 0.06;
  const caption = smooth(b.captionIn[0], b.captionIn[1], t) * (1 - smooth(b.captionOut[0], b.captionOut[1], t));
  return { phase, swing, swingPhase, ribbonDrop, caption };
}

/** A lapse or a quiet state change eases the cloth to its new rest; no camera, caption or sound. */
export const QUIET_FURL_MS = 2600;
export const quietFurl = (elapsed: number) => smooth(0, QUIET_FURL_MS, elapsed);

/**
 * One parcel's flight. A single gift descends from the sky under its canopy onto the doorstep; a cart's parcel
 * lifts off the cart bed, drifts over the roofs and comes down the same way. Times are ms from the parcel's launch.
 */
export const PARCEL_BEAT = {
  /** Sky descent for a single gift: the canopy blooms high above the door, then sinks. */
  bloom: 900,
  /** A cart parcel's lift off the bed, before it drifts. */
  lift: 700,
  /** Fixed flights keep every parcel on the authored clock whatever the street layout: sky sink, cart drift. */
  skyFlight: 3000, cartFlight: 3400,
  /** Touchdown: the parcel squashes, the canopy sags over it and lifts away. */
  squash: 260, canopyAway: 1500,
  knock: 0, rustle: 180,
} as const;

export interface ParcelPose {
  readonly phase: BeatPhase;
  /** 0 at the start of the route, 1 on the ground at its end. */
  readonly travel: number;
  /** Metres above the straight route: the arc, plus the sky descent for a single gift. */
  readonly height: number;
  /** Gentle pendulum of a parcel hanging under its canopy, radians. */
  readonly sway: number;
  /** 1 is the canopy fully open overhead; 0 is folded away. */
  readonly canopy: number;
  /** Vertical squash on landing, 1 at rest. */
  readonly squash: number;
}

/**
 * Pose of a parcel `t` ms after launch with flight `flight`. `fromSky` is a single gift's descent: no horizontal
 * travel, a long vertical sink. Otherwise an arc from the cart bed whose peak clears the roofs (`peak` metres).
 */
export function parcelPose(t: number, flight: number, fromSky: boolean, peak: number): ParcelPose {
  const b = PARCEL_BEAT, lead = fromSky ? b.bloom : b.lift, land = lead + flight;
  const phase: BeatPhase = t < lead ? 'anticipation' : t < land ? 'action' : t < land + b.canopyAway ? 'settle' : 'hold';
  let travel: number, height: number;
  if (fromSky) {
    travel = 1;
    // The canopy blooms at height and hangs a moment, then the parcel sinks and slows over the doorstep.
    const sink = clamp01((t - lead) / flight);
    height = t < lead ? peak + (1 - easeOutCubic(t / lead)) * 1.2 : peak * (1 - (sink < 0.75 ? sink / 0.75 * 0.8 : 0.8 + easeOutCubic((sink - 0.75) / 0.25) * 0.2));
  } else {
    // Lift: a soft hop off the bed while the canopy opens; then an eased arc, slow near the ground at the end.
    const lift = easeOutCubic(clamp01(t / lead)), k = clamp01((t - lead) / flight), eased = k * k * (3 - 2 * k);
    travel = t < lead ? 0 : eased;
    height = t < lead ? lift * 1.4 : 1.4 * (1 - eased) + Math.sin(Math.PI * eased) * peak;
  }
  if (t >= land) height = 0;
  const air = t >= lead && t < land ? Math.sin(Math.PI * clamp01((t - lead) / flight)) : 0;
  const sway = Math.sin(t / 1000 * Math.PI * 2 * 0.55) * 0.16 * air + (t >= land ? Math.sin(clamp01((t - land) / 600) * Math.PI) * 0.05 : 0);
  const canopy = t < lead ? easeOutCubic(t / lead) : t < land ? 1 : 1 - smooth(land + 280, land + b.canopyAway, t);
  const squash = t < land ? 1 : 1 - Math.sin(clamp01((t - land) / b.squash) * Math.PI) * 0.16;
  return { phase, travel, height, sway, canopy, squash };
}

/**
 * The gift cart: it rolls in from the gate to its stop, its load is handed out in waves, then it rolls on with
 * whatever it still carries. Times are ms from the beat start.
 */
export const CART_BEAT = {
  arrive: 3600, firstWave: 4200, waveGap: 1400, departAfterLast: 2600, depart: 3400,
  horn: 120, wheels: 0, captionIn: [2600, 3300], captionHold: 5200, captionFade: 900,
} as const;
/** Hard caps for gifts: flights in one beat, parcels launched per wave, parcels resting at doorsteps, cart load shown. */
export const GIFT_LIMITS = { flights: 48, wave: 6, resting: 120, cartLoad: 12, names: 3, intimate: 5 } as const;
/** A parcel rests on the doorstep for the night; the lasting seal is the recipient's wrapping record, not this. */
export const PARCEL_REST_MS = 6 * 3_600_000;

export interface CartPose {
  readonly phase: BeatPhase;
  /** 0 at the gate, 1 at the stop, beyond 1 rolling on and out. */
  readonly travel: number;
  /** Wheel rotation, radians: rolls only while the cart moves. */
  readonly wheel: number;
  /** Pony gait 0..1 cycle, and its strength (0 when standing). */
  readonly gait: number;
  readonly stride: number;
  readonly opacity: number;
}

/**
 * Cart pose `t` ms into its beat; `departAt` is when it rolls on (after its last wave). `roll` is the metres of
 * route per unit of travel, so the wheels turn with the ground they cover.
 */
export function cartPose(t: number, departAt: number, roll: number): CartPose {
  const b = CART_BEAT;
  const inbound = easeOutCubic(clamp01(t / b.arrive));
  const out = t < departAt ? 0 : smooth(0, b.depart, t - departAt);
  const travel = inbound + out;
  const moving = t < b.arrive ? 1 - smooth(b.arrive - 900, b.arrive, t) : t >= departAt ? smooth(0, 500, t - departAt) : 0;
  const phase: BeatPhase = t < b.arrive * 0.4 ? 'anticipation' : t < departAt ? 'action' : t < departAt + b.depart ? 'settle' : 'hold';
  // Distance rolled, in metres, from the path's own length; the wheel radius is 3.5 cells.
  const wheel = -(travel * roll) / (3.5 * 0.125);
  return { phase, travel, wheel, gait: (travel * roll / 1.1) % 1, stride: moving, opacity: 1 - smooth(departAt + b.depart - 700, departAt + b.depart, t) };
}
