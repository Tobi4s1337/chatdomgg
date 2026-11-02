import type { MomentBodyOf } from './contracts';
import type { AudioCueFrame, CaptionFrame } from './controller';
import { seedOf } from './sky-beat';
import type { StageProfile } from './stage-beat';

/**
 * An incoming raid (Twitch.md §9, Spec 20 R8): the gate wakes under the raider's banner and a caravan rolls in
 * through it, sized by the log of Twitch's own viewer count. It is a visit, never an invented crowd: the wagons
 * carry lanterns and the raider's colours, and nobody rides them. Pure: every pose and cue is a function of the
 * beat and the kingdom time, so a raid looks and sounds the same at any frame interval.
 */

/** Authored timings, ms from the beat's start. */
export const RAID_BEAT = {
  /** The gate gathers out of the air: braziers, the standard's pole. */
  gather: 900,
  /** The horn calls from the gate. */
  horn: 300,
  /** The braziers catch, flare high and settle to a steady blaze. */
  flame: { catch: 450, flare: 1300, steady: 2600 },
  /** The furled standard is hoisted up its pole, then unrolls from the crossbar. */
  hoist: [900, 2300] as const,
  unfurl: [2300, 3500] as const,
  cloth: 2250,
  /** The lead wagon comes through the gate. Pitch and travel are defaults for legacy frames. */
  arrive: 3400,
  pitch: 3600,
  /** How long one wagon takes from the gate, through the market and up the castle road until it is gone. */
  travel: 52_000,
  /** A wagon gathers out of the gate's light over this long, and thins away over the last stretch of its road. */
  emerge: 1400,
  vanish: 1600,
  /** From a wagon entering until it is well clear of the gate. */
  pass: 6000,
  /** The shot holds this long after the last wagon is through, and at least `minHold` in all. */
  holdAfter: 2500,
  minHold: 14_000,
  captionIn: [2600, 3400] as const,
  captionOut: 1000,
  /** After the hold the braziers die down and the gate thins away. */
  sleep: 3500,
  sleepFade: 1400,
} as const;

/** Hard caps: wagons in one caravan, caravans on the road at once, raids waiting their turn, and rolling cues. */
export const RAID_LIMITS = { units: 12, caravans: 2, queued: 4, rolls: 4 } as const;

export interface RaidScaleProfile {
  /** Ms between wagons entering the gate; spacing remains generous at every size. */
  readonly pitch: number;
  /** Ms for one wagon to travel the supplied road. */
  readonly travel: number;
  /** Ms until an entering wagon has cleared the gate shot. */
  readonly pass: number;
}

/**
 * Scale is authored in log space, with bounded work rather than invented people. From first wagon to last
 * clearing the gate, 10,000 viewers takes 58 seconds and 70,000 takes 74. The shot includes the gate waking
 * and a final welcome; the remaining road journey ends within 120 seconds of the original provider start.
 * That presentation lifetime is separate from the controller's unchanged 60-second admission window.
 */
export function raidScaleProfile(viewers: number): RaidScaleProfile {
  const anchors = [
    { viewers: 3, pitch: 3600, travel: 52_000, pass: 6000 },
    { viewers: 140, pitch: 4800, travel: 52_000, pass: 8000 },
    { viewers: 10_000, pitch: 6250, travel: 50_000, pass: 8000 },
    { viewers: 70_000, pitch: 6000, travel: 46_000, pass: 8000 },
  ] as const;
  const count = Number.isNaN(viewers) ? 1 : Math.max(1, Math.min(70_000, viewers));
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!, b = anchors[i]!;
    if (count > b.viewers) continue;
    const t = Math.max(0, (Math.log(count) - Math.log(a.viewers)) / (Math.log(b.viewers) - Math.log(a.viewers)));
    const mix = (first: number, last: number) => Math.round(first + (last - first) * t);
    return { pitch: mix(a.pitch, b.pitch), travel: mix(a.travel, b.travel), pass: mix(a.pass, b.pass) };
  }
  const last = anchors[anchors.length - 1]!;
  return { pitch: last.pitch, travel: last.travel, pass: last.pass };
}

/**
 * Wagons for a raid of `viewers`, on a gently convex log curve: a raid of 3 is one treasured wagon, 50 is three,
 * 140 four, 1,000 six, 10,000 nine; twelve is the longest column (from about 70,000).
 */
export function raidUnits(viewers: number): number {
  const v = Math.max(1, Math.floor(viewers));
  if (v <= 3) return 1;
  return Math.min(RAID_LIMITS.units, Math.max(1, Math.round(1 + 0.6 * Math.log(v / 3) ** 1.25)));
}

/** The column carries its scale in the world; the stream never airs an audience count. */
export function raidLine(viewers: number): string {
  return viewers >= 10_000 ? 'Lanterns fill the road' : 'Colours from the road';
}
export const RAID_DETAIL = 'The gate is open to visitors';

export interface RaidBeat {
  readonly kind: 'raid';
  readonly id: string;
  readonly raidKey: string;
  /** The raiding channel's public name (trimmed for display) and its channel ID, which alone draws its arms. */
  readonly name: string;
  readonly kingdomId: string;
  readonly founded: boolean;
  readonly viewers: number;
  readonly units: number;
  readonly timing: RaidScaleProfile;
  readonly seed: number;
  readonly startAt: number;
  /** When the director hands the camera back: the column is through the gate. */
  readonly holdUntil: number;
  /** When the gate goes to sleep; it is gone `sleepFade` later. */
  readonly sleepAt: number;
  /** When the last wagon has gone up the castle road. */
  readonly endAt: number;
}

export function planRaid(id: string, body: MomentBodyOf<'raid'>, startAt: number, name: (n: string) => string): RaidBeat {
  const b = RAID_BEAT, units = raidUnits(body.viewers), timing = raidScaleProfile(body.viewers);
  const lastThrough = b.arrive + (units - 1) * timing.pitch + timing.pass;
  const holdUntil = startAt + Math.max(b.minHold, lastThrough + b.holdAfter);
  const sleepAt = holdUntil + b.sleep;
  const endAt = Math.max(sleepAt + b.sleepFade, startAt + b.arrive + (units - 1) * timing.pitch + timing.travel) + 200;
  return { kind: 'raid', id, raidKey: body.raidKey, name: name(body.from.displayName), kingdomId: body.from.kingdomId, founded: body.founded,
    viewers: body.viewers, units, timing, seed: seedOf(body.raidKey), startAt, holdUntil, sleepAt, endAt };
}

/** What the view draws for one raid: times are ms into the beat, so the view never reads the kingdom clock. */
export interface RaidFrame {
  readonly id: string;
  readonly key: string;
  readonly t: number;
  /** The raiding channel: its ID draws the banner (the Atlas's own heraldry); the name is never written on a wagon. */
  readonly from: { readonly kingdomId: string; readonly name: string };
  readonly founded: boolean;
  readonly viewers: number;
  readonly units: number;
  readonly timing: RaidScaleProfile;
  readonly seed: number;
  /** Ms into the beat when the shot is handed back and when the gate goes to sleep. */
  readonly hold: number;
  readonly sleep: number;
}

export const raidFrame = (beat: RaidBeat, atMs: number): RaidFrame => ({
  id: beat.id, key: beat.raidKey, t: atMs - beat.startAt, from: { kingdomId: beat.kingdomId, name: beat.name }, founded: beat.founded,
  viewers: beat.viewers, units: beat.units, timing: beat.timing, seed: beat.seed, hold: beat.holdUntil - beat.startAt, sleep: beat.sleepAt - beat.startAt,
});

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** The credit plate at the gate: the raider's name, Twitch's count, and what it means tonight. */
export function raidCaption(beat: RaidBeat, atMs: number): CaptionFrame | null {
  const t = atMs - beat.startAt, hold = beat.holdUntil - beat.startAt, b = RAID_BEAT;
  const opacity = smooth(b.captionIn[0], b.captionIn[1], t) * (1 - smooth(hold - b.captionOut, hold, t));
  if (opacity <= 0.01) return null;
  return { id: beat.id, at: { kind: 'place', place: 'gate' }, title: `${beat.name} rides in`, line: raidLine(beat.viewers), detail: RAID_DETAIL, opacity };
}

/**
 * Every cue of the raid at its absolute time: the gate's horn, the standard's cloth, the wheels of the column (at
 * most four rolls however long it is), a drum under a column of five or more, and a last horn as the gate sleeps.
 */
export function raidCues(beat: RaidBeat): AudioCueFrame[] {
  const b = RAID_BEAT, at = (ms: number) => beat.startAt + ms;
  const cues: AudioCueFrame[] = [
    { id: `${beat.id}:horn`, cue: 'horn', atMs: at(b.horn), gain: 1 },
    { id: `${beat.id}:cloth`, cue: 'cloth-unfurl', atMs: at(b.cloth), gain: 0.85 },
  ];
  const step = Math.max(1, Math.ceil(beat.units / RAID_LIMITS.rolls));
  for (let i = 0; i < beat.units; i += step) cues.push({ id: `${beat.id}:roll:${i}`, cue: 'cart-roll', atMs: at(b.arrive + i * beat.timing.pitch), gain: i === 0 ? 0.95 : 0.7 });
  if (beat.units >= 5) cues.push({ id: `${beat.id}:drum`, cue: 'festival-drum', atMs: at(b.arrive + 500), gain: 0.65 });
  cues.push({ id: `${beat.id}:farewell`, cue: 'horn', atMs: beat.sleepAt - 600, gain: 0.45 });
  return cues;
}

/** The town turns to the gate as it wakes and cheers when the lead wagon comes through. */
export function raidProfile(beat: RaidBeat): StageProfile {
  const climax = RAID_BEAT.arrive + 900, end = beat.holdUntil - beat.startAt;
  return { rank: 5, climax, payoff: Math.max(climax + 2400, end - 1500), end, reach: 'town', hush: 0.14, cheer: true, voices: true };
}

// ---------------------------------------------------------------- poses (shared by the view and its tests)

export interface GatePose {
  /** 0..1: the gate's parts gathered out of the air (and thinning away again when it sleeps). */
  readonly presence: number;
  /** Brazier fire, 0 unlit, 1 a steady blaze, up to 1.55 at the flare. */
  readonly flame: number;
  /** 0 the furled standard rests low on its pole, 1 it is under the crossbar. */
  readonly hoist: number;
  /** 0 furled, 1 the cloth hangs its full length. */
  readonly unfurl: number;
  /** Extra sway after the cloth drops, 0..1, and its signed phase now. */
  readonly swing: number;
  readonly swingPhase: number;
}

/** The gate `t` ms into its raid, sleeping from `sleep` ms. */
export function gatePose(t: number, sleep: number): GatePose {
  const b = RAID_BEAT, f = b.flame;
  const presence = smooth(0, b.gather, t) * (1 - smooth(sleep + 400, sleep + b.sleepFade, t));
  const lit = smooth(f.catch, f.flare, t);
  const flare = t < f.flare ? lit * 1.55 : 1 + 0.55 * (1 - smooth(f.flare, f.steady, t));
  // At the end the fire sinks to embers, then goes out as the gate thins away.
  const flame = flare * (1 - 0.85 * smooth(sleep - 1400, sleep + 300, t)) * (1 - smooth(sleep + 300, sleep + b.sleepFade, t));
  const hoist = smooth(b.hoist[0], b.hoist[1], t);
  const unfurl = t < b.unfurl[0] ? 0 : easeOutCubic((t - b.unfurl[0]) / (b.unfurl[1] - b.unfurl[0]));
  const since = Math.max(0, t - b.unfurl[1] * 0.92);
  const swing = t < b.unfurl[1] * 0.92 ? 0 : Math.exp(-since / 1100);
  return { presence, flame, hoist, unfurl, swing, swingPhase: Math.sin(since / 1000 * Math.PI * 2 * 0.8) * swing };
}

/** One wagon's clock: ms since it entered the gate, or null before it enters or once it has gone. */
export function wagonElapsed(frame: Pick<RaidFrame, 't'> & { readonly timing?: RaidScaleProfile }, index: number): number | null {
  const timing = frame.timing ?? RAID_BEAT;
  const elapsed = frame.t - RAID_BEAT.arrive - index * timing.pitch;
  return elapsed < 0 || elapsed >= timing.travel ? null : elapsed;
}

/**
 * A wagon's place on its road and its presence. `length` is the road's length in metres; the column's pace is
 * chosen so a wagon covers the whole road in its travel time (within a walking-to-trotting range), entering a
 * little outside the gate line and thinning away over its last stretch, whichever of road or time ends first.
 */
export function wagonPose(elapsed: number, length: number, timing: Pick<RaidScaleProfile, 'travel'> = RAID_BEAT): { distance: number; speed: number; presence: number } {
  const b = RAID_BEAT, start = -3;
  const speed = Math.min(3, Math.max(1.6, (length - start) / ((timing.travel - b.vanish * 0.5) / 1000)));
  const distance = Math.min(Math.max(start, length - 0.5), start + speed * Math.max(0, elapsed) / 1000);
  const presence = smooth(0, b.emerge, elapsed) * (1 - smooth(timing.travel - b.vanish, timing.travel, elapsed)) * (1 - smooth(length - 4.5, length - 0.5, distance));
  return { distance, speed, presence };
}

/** The lead carries the great standard, followed by covered wagons and lantern wagons in turn. */
export type WagonKind = 'lead' | 'covered' | 'lantern';
export const wagonKind = (index: number): WagonKind => (index === 0 ? 'lead' : index % 2 === 1 ? 'covered' : 'lantern');
