import type { FishingProfile } from '@chatdom/shared';

export const FIGHT_TICK_MS = 50;
export const MAX_FIGHT_TICKS = 600;
export type FightProfile = FishingProfile;

export interface FightInput {
  readonly tick: number;
  readonly reel: boolean;
}

/** A scalar-only immutable snapshot. This is simulation state, never catch authority. */
export interface FightState {
  readonly version: 1;
  readonly seed: number;
  readonly profile: FightProfile;
  readonly tick: number;
  readonly tension: number;
  readonly progress: number;
  /** Consecutive steps below the slack threshold, not milliseconds. */
  readonly slack: number;
  readonly phase: 'rest' | 'warning' | 'run';
  readonly tired: boolean;
  readonly outcome: 'active' | 'landed' | 'snapped' | 'escaped' | 'timeout';
}

export interface FightReplay {
  readonly seed: number;
  readonly profile: FightProfile;
  readonly inputs: readonly FightInput[];
  readonly throughTick: number;
}

const SCALE = 10_000;
const SLACK_TENSION = 800;
const SLACK_TICKS = 30;
const START_TENSION = 3_000;
const STATE_KEYS = ['version', 'seed', 'profile', 'tick', 'tension', 'progress', 'slack', 'phase', 'tired', 'outcome'] as const;
const REPLAY_KEYS = ['seed', 'profile', 'inputs', 'throughTick'] as const;

// All rates are integer units per 50 ms step. Warning always lasts at least 750 ms.
// Profiles change rhythm, not gear, rank, subscription or payment advantages.
const PROFILES = {
  dart: { rest: 34, restJitter: 14, warning: 15, run: 22, runJitter: 8, fatigue: 120, pull: 64, surge: 440, gain: 78 },
  steady: { rest: 44, restJitter: 18, warning: 18, run: 26, runJitter: 8, fatigue: 140, pull: 55, surge: 380, gain: 70 },
  surge: { rest: 40, restJitter: 18, warning: 20, run: 34, runJitter: 10, fatigue: 160, pull: 62, surge: 410, gain: 75 },
} as const;

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
}

function profile(value: unknown): value is FightProfile {
  return value === 'dart' || value === 'steady' || value === 'surge';
}

/** Reject inherited fields, getters, extra fields and objects whose behaviour can change during replay. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid fight record');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Invalid fight prototype');
  if (Reflect.ownKeys(value).length !== keys.length) throw new TypeError('Invalid fight fields');
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable) throw new TypeError('Invalid fight field');
    copy[key] = property.value;
  }
  return copy;
}

// Keyed uint32 mixing gives each cycle independent jitter; no renderer or caller consumes the sequence.
function jitter(seed: number, cycle: number, key: number, range: number): number {
  let value = (seed ^ Math.imul(cycle + 1, 0x9e3779b9) ^ key) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) % (range + 1);
}

/** Absolute-tick schedule: copied snapshots resume without hidden timers or mutable RNG state. */
function phaseAt(seed: number, id: FightProfile, tick: number): FightState['phase'] {
  if (tick === 0) return 'rest';
  const p = PROFILES[id];
  let remaining = tick - 1;
  // Every cycle consumes at least 71 ticks; validated tick <= 600 means at most nine iterations.
  for (let cycle = 0; cycle <= MAX_FIGHT_TICKS; cycle++) {
    const rest = p.rest + jitter(seed, cycle, 0x243f6a88, p.restJitter);
    const run = p.run + jitter(seed, cycle, 0x85a308d3, p.runJitter);
    if (remaining < rest) return 'rest';
    remaining -= rest;
    if (remaining < p.warning) return 'warning';
    remaining -= p.warning;
    if (remaining < run) return 'run';
    remaining -= run;
  }
  throw new RangeError('Fight tick exceeds schedule');
}

function parseState(value: unknown): FightState {
  const s = record(value, STATE_KEYS);
  if (s.version !== 1 || !integer(s.seed, 0, 0xffff_ffff) || !profile(s.profile) ||
      !integer(s.tick, 0, MAX_FIGHT_TICKS) || !integer(s.tension, 0, SCALE) ||
      !integer(s.progress, 0, SCALE) || !integer(s.slack, 0, SLACK_TICKS) ||
      s.phase !== phaseAt(s.seed, s.profile, s.tick) || s.tired !== (s.tick >= PROFILES[s.profile].fatigue)) {
    throw new TypeError('Invalid fight state');
  }
  const noFailure = s.tension < SCALE && s.slack < SLACK_TICKS;
  const validOutcome =
    (s.outcome === 'active' && noFailure && s.progress < SCALE && s.tick < MAX_FIGHT_TICKS) ||
    (s.outcome === 'snapped' && s.tension === SCALE) ||
    (s.outcome === 'escaped' && s.tension < SCALE && s.slack === SLACK_TICKS) ||
    (s.outcome === 'timeout' && noFailure && s.tick === MAX_FIGHT_TICKS) ||
    (s.outcome === 'landed' && noFailure && s.progress === SCALE && s.tick < MAX_FIGHT_TICKS);
  if (!validOutcome || s.slack > s.tick || (s.slack > 0 && s.tension >= SLACK_TENSION) ||
      (s.tick > 0 && s.tension < SLACK_TENSION && s.slack === 0) ||
      (s.tick === 0 && (s.tension !== START_TENSION || s.progress !== 0 || s.slack !== 0 || s.outcome !== 'active'))) {
    throw new TypeError('Inconsistent fight state');
  }
  return Object.freeze({ ...s }) as unknown as FightState;
}

export function createFight(seed: number, id: FightProfile): FightState {
  if (!integer(seed, 0, 0xffff_ffff) || !profile(id)) throw new TypeError('Invalid fight seed or profile');
  return Object.freeze({ version: 1, seed, profile: id, tick: 0, tension: START_TENSION, progress: 0, slack: 0,
    phase: 'rest', tired: false, outcome: 'active' });
}

function advance(s: FightState, reel: boolean): FightState {
  if (s.outcome !== 'active') return s;
  const tick = s.tick + 1;
  const p = PROFILES[s.profile];
  const phase = phaseAt(s.seed, s.profile, tick);
  const tired = tick >= p.fatigue;
  // A running fish keeps released line taut. Letting go in rest eventually throws the hook.
  const tensionDelta = reel
    ? (phase === 'run' ? p.surge - (tired ? 110 : 0) : p.pull - (tired ? 18 : 0))
    : (phase === 'run' ? (tired ? 15 : 25) : -110);
  const progressDelta = reel
    ? (phase === 'run' ? 20 : p.gain + (tired ? 35 : 0))
    : (phase === 'run' ? (tired ? -6 : -12) : -6);
  const tension = Math.max(0, Math.min(SCALE, s.tension + tensionDelta));
  const progress = Math.max(0, Math.min(SCALE, s.progress + progressDelta));
  const slack = tension < SLACK_TENSION ? s.slack + 1 : 0;
  // Failure deliberately wins over landing, including the lifetime's final tick.
  const outcome = tension >= SCALE ? 'snapped' : slack >= SLACK_TICKS ? 'escaped'
    : tick >= MAX_FIGHT_TICKS ? 'timeout' : progress >= SCALE ? 'landed' : 'active';
  return Object.freeze({ version: 1, seed: s.seed, profile: s.profile, tick, tension, progress, slack, phase, tired, outcome });
}

/** Runtime validation is deliberate: snapshots can be restored from a JSON replay. */
export function stepFight(state: FightState, reel: boolean): FightState {
  if (typeof reel !== 'boolean') throw new TypeError('Invalid reel control');
  return advance(parseState(state), reel);
}

function parseReplay(value: unknown, claimed: boolean): FightReplay & { readonly claimed?: FightState } {
  const r = record(value, claimed ? [...REPLAY_KEYS, 'claimed'] : REPLAY_KEYS);
  if (!integer(r.seed, 0, 0xffff_ffff) || !profile(r.profile) || !integer(r.throughTick, 0, MAX_FIGHT_TICKS)) {
    throw new TypeError('Invalid fight replay');
  }
  if (!Array.isArray(r.inputs) || r.inputs.length > MAX_FIGHT_TICKS) throw new TypeError('Invalid fight tape');
  const length = r.inputs.length;
  if (Reflect.ownKeys(r.inputs).length !== length + 1) throw new TypeError('Invalid fight tape fields');
  const inputs: FightInput[] = [];
  let previousTick = 0, previousReel = false;
  for (let i = 0; i < length; i++) {
    const property = Object.getOwnPropertyDescriptor(r.inputs, String(i));
    if (!property || !('value' in property) || !property.enumerable) throw new TypeError('Invalid fight tape entry');
    const edge = record(property.value, ['tick', 'reel']);
    if (!integer(edge.tick, previousTick + 1, r.throughTick) || typeof edge.reel !== 'boolean' || edge.reel === previousReel) {
      throw new TypeError('Invalid fight control edge');
    }
    inputs.push(Object.freeze({ tick: edge.tick, reel: edge.reel }));
    previousTick = edge.tick;
    previousReel = edge.reel;
  }
  // Copy the entire tape and claimed state before simulation. No caller-owned aliases survive validation.
  const replay = { seed: r.seed, profile: r.profile, inputs: Object.freeze(inputs), throughTick: r.throughTick };
  return claimed ? { ...replay, claimed: parseState(r.claimed) } : replay;
}

function replayValidated(replay: FightReplay): FightState {
  let state = createFight(replay.seed, replay.profile), reel = false, edgeIndex = 0;
  for (let tick = 1; tick <= replay.throughTick && state.outcome === 'active'; tick++) {
    const edge = replay.inputs[edgeIndex];
    if (edge?.tick === tick) { reel = edge.reel; edgeIndex++; }
    state = advance(state, reel);
  }
  if (edgeIndex !== replay.inputs.length) throw new TypeError('Fight tape continues after its terminal step');
  return state;
}

/** Throws on malformed evidence. Bounded to 600 steps, regardless of terminal result or caller timestamps. */
export function replayFight(request: unknown): FightState {
  return replayValidated(parseReplay(request, false));
}

/** Evidence is terminal-only. A successful comparison never authorizes or grants a catch by itself. */
export function verifyFight(request: unknown): boolean {
  try {
    const replay = parseReplay(request, true);
    const claimed = replay.claimed!;
    if (claimed.outcome === 'active') return false;
    const actual = replayValidated(replay);
    return STATE_KEYS.every(key => actual[key] === claimed[key]);
  } catch {
    return false;
  }
}
