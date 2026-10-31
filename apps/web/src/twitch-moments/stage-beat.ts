import type { Vec3 } from '@chatdom/shared';
import { BANNER_BEAT, CART_BEAT, FLOURISH_BEAT, PARCEL_BEAT } from './choreography';
import type { AudioCueFrame, MomentSubject } from './controller';
import type { GiftBeat } from './gift-beat';
import { bellLead, type BattleState, type TrainState } from './hype-beat';
import type { SkyBeat } from './sky-beat';
import { DRAGON_BEAT, POWER_UP_BEAT, SKY_BEAT, TRAIN_BEAT, type SkyRung } from './spectacle';

/**
 * One observed event, staged together. Whatever the event, the town plays one beat around it: people turn toward
 * it while the lamps hold their breath (gather), it peaks and the crowd answers (climax), the light and the cheer
 * linger (payoff), and everyone settles back (settle). The camera is the director's and returns at the beat's end;
 * this is the rest of the town: light, crowd and the crowd's voice, on the same authored clock as the effect.
 *
 * Pure: derived from a beat and the kingdom time, so re-sampling at any frame interval gives the same stage.
 */
export type StagePhase = 'gather' | 'climax' | 'payoff' | 'settle';
/** Who turns to look: a home's neighbours, the street around it, or the whole town. */
export type StageReach = 'neighbours' | 'street' | 'town';

export interface StageProfile {
  /** Which of two overlapping beats the town attends to; higher wins. */
  readonly rank: number;
  /** Ms after the beat's start: the instant the effect peaks (a bloom, a name formed, a landing, a roar). */
  readonly climax: number;
  /** Ms after the start when the payoff ends and people start turning back; and when they have settled. */
  readonly payoff: number;
  readonly end: number;
  readonly reach: StageReach;
  /** The lamps' held breath before the climax: the share (0..0.45) by which the host dims its ambient, never its windows. */
  readonly hush: number;
  /** The crowd answers: arms up and a cheer. False for a gasp (a dragon's roar) or a quiet beat (a spark, a lapse). */
  readonly cheer: boolean;
  /** The crowd is heard: a murmur rising into the climax and, when it cheers, the cheer. */
  readonly voices: boolean;
}

export interface StageFrame {
  readonly id: string;
  /** The staged beat's ID: one stage per beat, so a merged volley or a replayed key never stages twice. */
  readonly beat: string;
  readonly subject: MomentSubject;
  readonly profile: StageProfile;
  readonly startAt: number;
  readonly climaxAt: number;
  readonly endAt: number;
  readonly phase: StagePhase;
  /** 0..1: how far the watching town has turned toward the subject. */
  readonly attention: number;
  /** 0..1: the answering cheer, just after the climax. */
  readonly cheer: number;
  /** 0..1: the lamps' held breath, deepest just before the climax and released at once by it. */
  readonly hush: number;
  /** Present people who may turn to look, bounded by the reach; 0 means nobody is home to see it, so no crowd at all. */
  readonly watchers: number;
}

/** Hard caps: watchers per reach (the host chooses its nearest real present people). */
export const STAGE_LIMITS = { watchers: { neighbours: 4, street: 10, town: 24 } } as const;
/** How long a turn takes at most, and how long the cheer holds after the climax before it fades. */
export const STAGE_TIMING = { turn: 1800, cheerRise: 550, cheerHold: 3600, cheerFade: 1100, hushRelease: 500, settle: 1600 } as const;

const SKY_PROFILE: Record<SkyRung, Omit<StageProfile, 'rank'>> = {
  // A spark is the cheerer's own: the neighbours look up, quietly.
  spark: { climax: SKY_BEAT.spark.peak, payoff: SKY_BEAT.spark.fade[0], end: SKY_BEAT.spark.end, reach: 'neighbours', hush: 0, cheer: false, voices: false },
  'street-fireworks': { climax: SKY_BEAT['street-fireworks'].launches[0] + SKY_BEAT['street-fireworks'].fuse, payoff: 5600, end: SKY_BEAT['street-fireworks'].end,
    reach: 'street', hush: 0.18, cheer: true, voices: true },
  'castle-volley': { climax: SKY_BEAT['castle-volley'].launches[0] + SKY_BEAT['castle-volley'].fuse, payoff: 8200, end: SKY_BEAT['castle-volley'].end,
    reach: 'town', hush: 0.24, cheer: true, voices: true },
  hearthbeast: { climax: SKY_BEAT.hearthbeast.overhead, payoff: SKY_BEAT.hearthbeast.exit, end: SKY_BEAT.hearthbeast.end, reach: 'town', hush: 0.34, cheer: true, voices: true },
  // Skyfire's climax is the name, fully written in the sky; the procession walks the walls through the payoff.
  skyfire: { climax: SKY_BEAT.skyfire.name[1], payoff: SKY_BEAT.skyfire.aurora[2], end: SKY_BEAT.skyfire.aurora[3], reach: 'town', hush: 0.4, cheer: true, voices: true },
  kites: { climax: SKY_BEAT.kites.rise[1], payoff: SKY_BEAT.kites.drift[0], end: SKY_BEAT.kites.drift[1], reach: 'town', hush: 0.12, cheer: true, voices: true },
};
const RUNG_RANK: Record<SkyRung, number> = { spark: 1, 'street-fireworks': 3, 'castle-volley': 4, hearthbeast: 5, skyfire: 6, kites: 6 };

/** The stage a sky beat plays: its rung's profile, or a Power-up's. A bubble's dressing and the train's closing volley are not staged. */
export function skyProfile(beat: SkyBeat): StageProfile | null {
  switch (beat.sky) {
    case 'cheer': { const rung = beat.rung ?? 'spark'; return { rank: RUNG_RANK[rung], ...SKY_PROFILE[rung] }; }
    case 'confetti': return { rank: 3, climax: POWER_UP_BEAT.confetti.burst[1], payoff: 5600, end: POWER_UP_BEAT.confetti.end, reach: 'town', hush: 0, cheer: true, voices: true };
    case 'balloon': return { rank: 3, climax: POWER_UP_BEAT.balloon.rise[1], payoff: 9000, end: 12_000, reach: 'street', hush: 0, cheer: true, voices: false };
    default: return null;
  }
}

/** A banner on a home: its neighbours turn as the cloth unrolls. Restrained and local; no hush, no crowd voice. */
export function bannerProfile(style: 'unfurl' | 'flourish'): StageProfile {
  return style === 'unfurl'
    ? { rank: 2, climax: BANNER_BEAT.action, payoff: BANNER_BEAT.settle, end: BANNER_BEAT.end, reach: 'neighbours', hush: 0, cheer: true, voices: false }
    : { rank: 2, climax: FLOURISH_BEAT.ribbon[1], payoff: FLOURISH_BEAT.settle, end: FLOURISH_BEAT.end, reach: 'neighbours', hush: 0, cheer: false, voices: false };
}

/** A parcel: the neighbours watch it settle. A cart: the street gathers at the first wave and is heard. */
export function giftProfile(beat: GiftBeat): StageProfile {
  const length = beat.endAt - beat.startAt;
  if (beat.mode === 'single') {
    const climax = PARCEL_BEAT.bloom + PARCEL_BEAT.skyFlight;
    return { rank: 2, climax, payoff: Math.min(length - 600, climax + 2400), end: length, reach: 'neighbours', hush: 0, cheer: true, voices: false };
  }
  return { rank: 3, climax: CART_BEAT.firstWave, payoff: Math.max(CART_BEAT.firstWave + 2000, beat.departAt - beat.startAt), end: length, reach: 'street', hush: 0, cheer: true, voices: true };
}

/** The train steaming in: the town turns to the track as the whistle sounds. */
export const TRAIN_PROFILE: StageProfile = { rank: 7, climax: TRAIN_BEAT.arrive - 600, payoff: TRAIN_BEAT.arrive + 3000, end: TRAIN_BEAT.arrive + 4200, reach: 'town', hush: 0.1, cheer: true, voices: true };

/**
 * The earned dragon, by authoritative phase: its waking roar is a gasp under a darkened town (no cheer); the realm's
 * victory is the town's loudest cheer; a retreat is watched in silence. An active fight is not one beat: not staged.
 */
export function battleProfile(battle: BattleState): StageProfile | null {
  switch (battle.phase) {
    case 'summoning': {
      const lead = bellLead(battle), b = DRAGON_BEAT.summoning;
      return { rank: 9, climax: lead + b.roar, payoff: lead + b.climb[1] - 1200, end: lead + b.end, reach: 'town', hush: 0.45, cheer: false, voices: true };
    }
    case 'victory': return { rank: 9, climax: DRAGON_BEAT.victory.land, payoff: DRAGON_BEAT.victory.bow[1] + 1800, end: DRAGON_BEAT.victory.end, reach: 'town', hush: 0.2, cheer: true, voices: true };
    case 'retreat': return { rank: 8, climax: DRAGON_BEAT.retreat.roar, payoff: DRAGON_BEAT.retreat.away[1], end: DRAGON_BEAT.retreat.end, reach: 'town', hush: 0, cheer: false, voices: false };
    default: return null;
  }
}

/** One stageable beat: its ID, subject, start and profile. */
export interface StageCandidate { readonly beat: string; readonly subject: MomentSubject; readonly startAt: number; readonly profile: StageProfile }

export const trainCandidate = (train: TrainState): StageCandidate | null =>
  train.arrives && Number.isFinite(train.appearedAt) ? { beat: `train.${train.trainKey}`, subject: { kind: 'place', place: 'train' }, startAt: train.appearedAt, profile: TRAIN_PROFILE } : null;

export function battleCandidate(battle: BattleState): StageCandidate | null {
  const profile = battleProfile(battle);
  return profile && Number.isFinite(battle.phaseAt) ? { beat: `battle.${battle.battleKey}:${battle.phase}`, subject: { kind: 'place', place: 'dragon' }, startAt: battle.phaseAt, profile } : null;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The stage's envelope at `atMs`: attention, cheer and hush on the beat's own clock. */
export function stageEnvelope(stage: Pick<StageFrame, 'startAt' | 'climaxAt' | 'endAt' | 'profile'>, atMs: number): { attention: number; cheer: number; hush: number; phase: StagePhase } {
  const { startAt, climaxAt, endAt, profile } = stage, payoffAt = startAt + profile.payoff, T = STAGE_TIMING;
  // People turn before the climax, faster when it comes quickly; they turn back once the payoff is over.
  const turn = Math.min(T.turn, Math.max(500, (climaxAt - startAt) * 0.8));
  const back = Math.max(400, Math.min(T.settle, endAt - payoffAt));
  const attention = smooth(startAt, startAt + turn, atMs) * (1 - smooth(payoffAt, payoffAt + back, atMs));
  const cheer = profile.cheer ? smooth(climaxAt + 120, climaxAt + 120 + T.cheerRise, atMs)
    * (1 - smooth(Math.min(climaxAt + T.cheerHold, payoffAt), Math.min(climaxAt + T.cheerHold, payoffAt) + T.cheerFade, atMs)) : 0;
  // The breath is held over the run-up and let go the instant the climax lands; the effect's own light takes over.
  const run = Math.max(0, climaxAt - startAt);
  const hush = profile.hush * (run < 900 ? 0 : smooth(startAt + run * 0.25, climaxAt - 150, atMs) * (1 - smooth(climaxAt - 150, climaxAt + T.hushRelease, atMs)));
  const phase: StagePhase = atMs < climaxAt ? 'gather' : atMs < Math.min(climaxAt + T.cheerHold, payoffAt) ? 'climax' : atMs < payoffAt ? 'payoff' : 'settle';
  return { attention, cheer, hush, phase };
}

/**
 * The beat the town attends to now: the highest-ranked candidate inside its window; between equals, the one already
 * playing. Present watchers come from the public presence only, bounded by the reach; nobody present, nobody turns.
 */
export function stageOf(candidates: readonly StageCandidate[], atMs: number, present: number): StageFrame | null {
  let chosen: StageCandidate | null = null;
  for (const c of candidates) {
    if (atMs < c.startAt || atMs >= c.startAt + c.profile.end) continue;
    if (!chosen || c.profile.rank > chosen.profile.rank || (c.profile.rank === chosen.profile.rank && c.startAt < chosen.startAt)) chosen = c;
  }
  if (!chosen) return null;
  const startAt = chosen.startAt, climaxAt = startAt + chosen.profile.climax, endAt = startAt + chosen.profile.end;
  const envelope = stageEnvelope({ startAt, climaxAt, endAt, profile: chosen.profile }, atMs);
  return { id: `stage:${chosen.beat}`, beat: chosen.beat, subject: chosen.subject, profile: chosen.profile, startAt, climaxAt, endAt, ...envelope,
    watchers: Math.min(STAGE_LIMITS.watchers[chosen.profile.reach], Math.max(0, Math.floor(present))) };
}

/** The crowd's voice for a staged beat, on its clock: a murmur rising into the climax, then the cheer. Scaled by who is there. */
export function stageCues(stage: StageFrame): AudioCueFrame[] {
  const { profile } = stage;
  if (!profile.voices || stage.watchers === 0) return [];
  // Louder with more people, on a log scale with fixed clamps: a hamlet's few voices, never an audience-sized roar.
  const crowd = Math.min(1, 0.4 + 0.6 * Math.log2(1 + stage.watchers) / Math.log2(1 + STAGE_LIMITS.watchers.town));
  const out: AudioCueFrame[] = [];
  const run = stage.climaxAt - stage.startAt;
  if (run >= 1200) out.push({ id: `${stage.beat}:crowd-murmur`, cue: 'crowd-murmur', atMs: Math.max(stage.startAt, stage.climaxAt - 1500), gain: 0.55 * crowd });
  if (profile.cheer) out.push({ id: `${stage.beat}:crowd-cheer`, cue: 'crowd-cheer', atMs: stage.climaxAt + 180, gain: 0.8 * crowd });
  return out;
}

// ---------------------------------------------------------------- the crowd, for the host

/** What the host's crowd is told each frame: the stage, and the world point everyone turns toward. */
export interface CrowdCall extends StageFrame { readonly point: Vec3 }
export interface CrowdPerson { readonly slot: number; readonly position: Vec3; readonly heading: number }
export interface CrowdPose {
  /** The body's heading (rotation about +Y, zero faces +Z), turned toward the subject by `turned`. */
  readonly heading: number;
  readonly turned: number;
  readonly gesture: 'none' | 'nod' | 'wave';
  /** Seconds added to the host's gesture clock, so a crowd's waves never move in lockstep. */
  readonly offset: number;
}

const hash = (slot: number, salt: number) => { let h = Math.imul(slot ^ salt, 0x9e3779b1) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x85ebca77) >>> 0; return (h ^ (h >>> 13)) >>> 0; };

/** The watchers: the call's nearest present people to its subject, at most `call.watchers`. The host supplies only real present people. */
export function chooseWatchers<P extends CrowdPerson>(call: CrowdCall, people: readonly P[]): P[] {
  const [x, , z] = call.point, d = (p: P) => Math.hypot(p.position[0] - x, p.position[2] - z);
  return [...people].sort((a, b) => d(a) - d(b) || a.slot - b.slot).slice(0, call.watchers);
}

/**
 * One watcher's pose: they turn toward the subject a little after their neighbours (a stable per-person delay), and
 * after the climax most raise an arm while a few simply nod; the rest stay as they were. Restrained and staggered,
 * never a synchronised storm.
 */
export function crowdPose(call: CrowdCall, person: CrowdPerson, atMs: number): CrowdPose {
  const delay = hash(person.slot, 0x51ed) % 900, cheerDelay = hash(person.slot, 0x2c1b) % 700, kind = hash(person.slot, 0x7a3d) % 10;
  const turned = stageEnvelope(call, atMs - delay).attention;
  const toward = Math.atan2(call.point[0] - person.position[0], call.point[2] - person.position[2]);
  let delta = toward - person.heading;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const cheer = stageEnvelope(call, atMs - cheerDelay).cheer;
  const gesture = cheer > 0.35 ? (kind < 6 ? 'wave' : kind < 8 ? 'nod' : 'none') : turned > 0.7 && call.profile.reach === 'neighbours' && kind < 3 ? 'nod' : 'none';
  return { heading: person.heading + delta * turned, turned, gesture, offset: (hash(person.slot, 0x1f3) % 1000) / 1000 * 2.4 };
}
