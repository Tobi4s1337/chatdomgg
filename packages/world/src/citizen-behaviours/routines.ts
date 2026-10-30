import type { CitizenDestination, CitizenGoalRequest, CitizenGoalResult, CitizenMotionSample } from '../citizens/types';
import { BEHAVIOUR_TUNING as T } from './tuning';
import type { CitizenGoalAnswer, CitizenRoutineKind, CitizenRoutineTransition, CitizenRoutineView } from './types';

const R = T.routine;
type Band = readonly [number, number];
type Refusal = Exclude<CitizenGoalResult, { accepted: true }>['reason'] | 'unanswered';

/** A head turn held on a fixed angle relative to a standing body. Looks never overlap. */
interface Look { readonly atMs: number; readonly inMs: number; readonly holdUntil: number; readonly outMs: number; readonly yaw: number }
interface Trip {
  readonly kind: 'stroll' | 'market';
  readonly pattern: string | null;
  /** Approved node IDs still to visit, in order, with the pause authored for each. */
  readonly stops: string[];
  readonly pauses: number[];
}
interface Routine {
  /** `travel`: motion is taking them to `goal`. `stop`/`home`: standing at an arrival. `wait`: resting after a refusal. */
  mode: 'travel' | 'stop' | 'home' | 'wait' | 'held';
  since: number;
  until: number;
  trip: Trip | null;
  goal: string;
  /** The first step whose sample can show `goal`: the accepted request's start. */
  goalFrom: number;
  pending: { readonly nodeId: string; readonly startAtMs: number; readonly askedAt: number; readonly fromHome: boolean } | null;
  claim: string | null;
  looks: Look[];
  failures: number;
  nextOpportunity: number;
  opportunities: number;
  arrivals: number;
  marketRefusedUntil: number;
  /** Excursions that reached their first stop, and the first stop of the latest one. */
  trips: number;
  lastStop: string | null;
  /**
   * Approved places this person has actually walked past, with the metres of their own walk from
   * home. Learned only from motion samples: strolls stay on ground they know, never a guessed route.
   */
  readonly known: Map<string, number>;
  /** The walk under way: where it began and which approved places it has passed (travelled metres at the pass). */
  walk: { readonly fromHome: boolean; readonly startDistance: number; readonly passes: Map<string, number> } | null;
  /** First step of this presence: with the slot, the seed of every routine choice. */
  readonly seed: number;
}

const ease = (n: number): number => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
/** Ease-out-back: the head arrives a touch past its angle and settles, like a toy with weight. */
const arrive = (n: number): number => {
  const t = Math.max(0, Math.min(1, n)) - 1, c = T.look.overshootBack;
  return 1 + (c + 1) * t * t * t + c * t * t;
};
const between = ([low, high]: Band, unit: number): number => Math.round(low + (high - low) * unit);
const within = ([low, high]: Band, unit: number): number => low + (high - low) * unit;
const flat = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);
const byNode = (a: CitizenDestination, b: CitizenDestination): number => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0;
const PASS_CELL = 4;
const cellOf = (x: number, z: number): number => (Math.floor(x / PASS_CELL) + 32_768) * 65_536 + Math.floor(z / PASS_CELL) + 32_768;
/** Public approved places by grid cell, built once per destination list main hands out. */
const passGrids = new WeakMap<readonly CitizenDestination[], Map<number, CitizenDestination[]>>();
function passGrid(destinations: readonly CitizenDestination[]): Map<number, CitizenDestination[]> {
  let grid = passGrids.get(destinations);
  if (grid) return grid;
  grid = new Map();
  for (const destination of destinations) {
    if (destination.kind === 'home') continue;
    const key = cellOf(destination.position[0], destination.position[2]), list = grid.get(key);
    if (list) list.push(destination); else grid.set(key, [destination]);
  }
  passGrids.set(destinations, grid); return grid;
}

export interface RoutineStep {
  readonly atMs: number;
  readonly emit: (transition: CitizenRoutineTransition) => void;
}

/**
 * The authored street routines for supplied people. They choose only approved destination IDs and
 * wait for main's answers and actual arrival samples; routing, gait and heading stay main's.
 * Stops are claimed so two people never stand on one node; homes are never claimed or moved.
 */
export function createRoutines(unit: (...parts: (string | number)[]) => number) {
  const routines = new Map<number, Routine>(), claims = new Map<string, number>();
  const seeded = (slot: number, routine: Routine, ...parts: (string | number)[]): number => unit('routine', slot, routine.seed, ...parts);

  const release = (slot: number, routine: Routine): void => {
    if (routine.claim !== null && claims.get(routine.claim) === slot) claims.delete(routine.claim);
    routine.claim = null;
  };
  const claim = (slot: number, routine: Routine, nodeId: string): boolean => {
    const owner = claims.get(nodeId);
    if (owner !== undefined && owner !== slot) return false;
    release(slot, routine); claims.set(nodeId, slot); routine.claim = nodeId; return true;
  };
  const kindOf = (routine: Routine): CitizenRoutineKind => routine.mode === 'held' ? 'held'
    : routine.trip?.kind ?? (routine.arrivals === 0 && routine.mode === 'travel' ? 'arriving' : 'home');

  /** A look that must end before `until`, or nothing. */
  function look(start: number, spec: { yaw: Band; inMs: Band; holdMs: Band; outMs: Band }, sign: number, until: number, unitFor: (part: string) => number): Look | null {
    const inMs = between(spec.inMs, unitFor('in')), holdUntil = start + inMs + between(spec.holdMs, unitFor('hold'));
    const outMs = between(spec.outMs, unitFor('out'));
    return holdUntil + outMs <= until - 250 ? { atMs: start, inMs, holdUntil, outMs, yaw: sign * within(spec.yaw, unitFor('yaw')) } : null;
  }

  /** Begin at what motion shows: walking on, standing at home, or standing at a stop. */
  function settle(slot: number, sample: CitizenMotionSample, atMs: number, home: CitizenDestination | undefined, routine: Routine): void {
    release(slot, routine);
    Object.assign(routine, { trip: null, pending: null, looks: [], failures: 0, goal: sample.goalNodeId, goalFrom: atMs, since: atMs, walk: null });
    if (!sample.goalReached) {
      routine.mode = 'travel'; routine.until = atMs;
      routine.walk = { fromHome: false, startDistance: sample.distance, passes: new Map() };
      return;
    }
    if (sample.goalNodeId === home?.nodeId) {
      routine.mode = 'home'; routine.until = atMs + between(R.homeRestMs, seeded(slot, routine, 'settle-rest', atMs));
      routine.nextOpportunity = routine.until; return;
    }
    // Standing somewhere public: a short pause where they are, then home.
    claim(slot, routine, sample.goalNodeId);
    routine.mode = 'stop'; routine.until = atMs + between(R.strolls[0]!.pauseMs, seeded(slot, routine, 'settle-pause', atMs));
  }

  /** Someone without an approved home destination keeps only greetings: no routine is invented for them. */
  function create(slot: number, sample: CitizenMotionSample, atMs: number, home: CitizenDestination | undefined): void {
    if (!home) return;
    const routine: Routine = { mode: 'travel', since: atMs, until: atMs, trip: null, goal: sample.goalNodeId, goalFrom: atMs, pending: null,
      claim: null, looks: [], failures: 0, nextOpportunity: -Infinity, opportunities: 0, arrivals: 0, marketRefusedUntil: -Infinity,
      trips: 0, lastStop: null, known: new Map(), walk: null, seed: atMs };
    routines.set(slot, routine); settle(slot, sample, atMs, home, routine);
  }

  function hold(slot: number, step: RoutineStep): void {
    const routine = routines.get(slot);
    if (!routine || routine.mode === 'held') return;
    release(slot, routine);
    Object.assign(routine, { mode: 'held', trip: null, pending: null, looks: [], walk: null, since: step.atMs, until: step.atMs });
    step.emit({ slot, atMs: step.atMs, kind: 'held', routine: 'held', nodeId: null });
  }
  function resume(slot: number, sample: CitizenMotionSample, home: CitizenDestination | undefined, step: RoutineStep): void {
    const routine = routines.get(slot);
    if (!routine || routine.mode !== 'held') return;
    settle(slot, sample, step.atMs, home, routine);
    step.emit({ slot, atMs: step.atMs, kind: 'resume', routine: kindOf(routine), nodeId: routine.goal });
  }

  function refuse(slot: number, routine: Routine, reason: Refusal, home: CitizenDestination | undefined, destinations: readonly CitizenDestination[], step: RoutineStep): void {
    const nodeId = routine.pending!.nodeId, atMs = step.atMs, toHome = nodeId === home?.nodeId;
    routine.pending = null;
    step.emit({ slot, atMs, kind: 'refused', routine: kindOf(routine), nodeId, reason });
    routine.failures++;
    routine.mode = 'wait'; routine.since = atMs;
    if (reason === 'absent') { release(slot, routine); routine.trip = null; routine.until = atMs + R.maxRetryMs; return; }
    // A timing conflict or a lost answer: ask again shortly for the same place.
    if ((reason === 'out-of-order' || reason === 'unanswered') && routine.failures <= R.quickRetries) { routine.until = atMs + T.stepMs; return; }
    if (!toHome) {
      // That stop is not reachable from here: drop it and carry on calmly from where they stand.
      if (claims.get(nodeId) === slot) release(slot, routine);
      const trip = routine.trip, index = trip ? trip.stops.indexOf(nodeId) : -1;
      if (trip && index >= 0) { trip.stops.splice(index, 1); trip.pauses.splice(index, 1); }
      if (destinations.some(destination => destination.nodeId === nodeId && destination.kind === 'market')) routine.marketRefusedUntil = atMs + R.marketRefusalMs;
      routine.until = atMs + between(R.retryMs, seeded(slot, routine, 'retry', atMs));
      return;
    }
    // Home cannot be reached from here yet: rest where they legally are and ask again, backing off.
    const base = between(R.retryMs, seeded(slot, routine, 'home-retry', atMs));
    routine.until = atMs + Math.min(R.maxRetryMs, base * 2 ** Math.max(0, routine.failures - 1));
  }

  /** Main's answers to the previous step's goals; an unanswered request is retried, never assumed. */
  function answer(slot: number, sample: CitizenMotionSample, answers: readonly CitizenGoalAnswer[] | undefined, home: CitizenDestination | undefined, destinations: readonly CitizenDestination[], step: RoutineStep): void {
    const routine = routines.get(slot), pending = routine?.pending;
    if (!routine || !pending) return;
    const found = answers?.find(({ request }) => request.nodeId === pending.nodeId && request.startAtMs === pending.startAtMs);
    if (!found) {
      if (step.atMs - pending.askedAt >= R.answerSteps * T.stepMs) refuse(slot, routine, 'unanswered', home, destinations, step);
      return;
    }
    if (!found.result.accepted) { refuse(slot, routine, found.result.reason, home, destinations, step); return; }
    // Accepted is not arrived: the walk starts at `startAtMs`, the pause only at an actual arrival sample.
    Object.assign(routine, { pending: null, mode: 'travel', goal: pending.nodeId, goalFrom: pending.startAtMs, since: pending.startAtMs, failures: 0,
      walk: { fromHome: pending.fromHome, startDistance: sample.distance, passes: new Map() } });
  }

  /** Note the approved places a walk actually passes; their metres become known on reaching home or from it. */
  function track(routine: Routine, sample: CitizenMotionSample, destinations: readonly CitizenDestination[]): void {
    const walk = routine.walk;
    if (!walk) return;
    const grid = passGrid(destinations), x = sample.position[0], z = sample.position[2];
    const cx = Math.floor(x / PASS_CELL), cz = Math.floor(z / PASS_CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const destination of grid.get((cx + dx + 32_768) * 65_536 + cz + dz + 32_768) ?? []) {
        if (!walk.passes.has(destination.nodeId) && flat(destination.position, sample.position) <= R.passMetres) walk.passes.set(destination.nodeId, sample.distance);
      }
    }
  }
  function learn(routine: Routine, nodeId: string, metres: number): void {
    const known = routine.known.get(nodeId);
    if (known === undefined || metres < known) routine.known.set(nodeId, metres);
  }
  /** At the end of a walk: places passed on the way out from home, or on the way back to it, are now known ground. */
  function finishWalk(routine: Routine, sample: CitizenMotionSample, home: CitizenDestination | undefined): void {
    const walk = routine.walk;
    routine.walk = null;
    if (!walk) return;
    const toHome = routine.goal === home?.nodeId;
    if (walk.fromHome && !toHome) learn(routine, routine.goal, sample.distance - walk.startDistance);
    for (const [nodeId, distance] of walk.passes) {
      if (nodeId === routine.goal && !toHome) continue;
      if (walk.fromHome) learn(routine, nodeId, distance - walk.startDistance);
      else if (toHome) learn(routine, nodeId, sample.distance - distance);
    }
  }

  function arrival(slot: number, sample: CitizenMotionSample, home: CitizenDestination | undefined, destinations: readonly CitizenDestination[], step: RoutineStep): void {
    const routine = routines.get(slot), atMs = step.atMs;
    if (!routine || routine.mode !== 'travel' || atMs < routine.goalFrom) return;
    // Motion is the truth: if it now takes them elsewhere (a new presence, main's own goal), follow it.
    if (sample.goalNodeId !== routine.goal) { routine.goal = sample.goalNodeId; routine.trip = null; routine.walk = null; release(slot, routine); }
    if (!sample.goalReached) { track(routine, sample, destinations); return; }
    if (routine.walk?.fromHome && routine.goal !== home?.nodeId) { routine.trips++; routine.lastStop = routine.goal; }
    finishWalk(routine, sample, home);
    routine.arrivals++; routine.since = atMs; routine.looks = [];
    const n = routine.arrivals, unitFor = (label: string) => (part: string) => seeded(slot, routine, label, n, part);
    const first = atMs + between(R.firstLookAfterMs, seeded(slot, routine, 'first-look', n));
    if (routine.goal === home?.nodeId) {
      release(slot, routine);
      const rest = between(R.homeRestMs, seeded(slot, routine, 'rest', n));
      Object.assign(routine, { mode: 'home', trip: null, until: atMs + rest });
      routine.nextOpportunity = Math.max(routine.until, routine.nextOpportunity);
      const side = seeded(slot, routine, 'door-side', n) < .5 ? -1 : 1;
      const door = seeded(slot, routine, 'door', n) < R.doorstepLook.chance ? look(first, R.doorstepLook, side, routine.until, unitFor('door')) : null;
      if (door) routine.looks.push(door);
      if (seeded(slot, routine, 'rest-look', n) < R.restLookChance) {
        const quiet = look(atMs + Math.round(rest * within([.45, .62], seeded(slot, routine, 'rest-at', n))), R.streetLook, -side * .8, routine.until, unitFor('rest'));
        if (quiet && (!door || quiet.atMs > door.holdUntil + door.outMs + 400)) routine.looks.push(quiet);
      }
      step.emit({ slot, atMs, kind: 'arrive', routine: 'home', nodeId: routine.goal, pauseMs: rest });
      return;
    }
    const trip = routine.trip, index = trip ? trip.stops.indexOf(routine.goal) : -1;
    let pause: number;
    if (trip && index === 0) { pause = trip.pauses[0]!; trip.stops.shift(); trip.pauses.shift(); }
    else { pause = between(R.strolls[0]!.pauseMs, seeded(slot, routine, 'pause', n)); routine.trip = null; }
    claim(slot, routine, routine.goal);
    Object.assign(routine, { mode: 'stop', until: atMs + pause });
    const market = destinations.some(destination => destination.nodeId === routine.goal && destination.kind === 'market');
    const side = seeded(slot, routine, 'side', n) < .5 ? -1 : 1;
    if (market) {
      // The bustle: one side of the square, a breath, then the other side.
      const across = look(first, R.marketLook, side, routine.until, unitFor('market-a'));
      if (across) {
        routine.looks.push(across);
        const back = look(across.holdUntil + across.outMs + between(R.marketLook.gapMs, seeded(slot, routine, 'market-gap', n)), R.marketLook, -side, routine.until, unitFor('market-b'));
        if (back) routine.looks.push(back);
      }
    } else {
      const along = look(first, R.streetLook, side, routine.until, unitFor('street'));
      if (along) routine.looks.push(along);
    }
    step.emit({ slot, atMs, kind: 'arrive', routine: kindOf(routine), nodeId: routine.goal, pauseMs: pause });
  }

  /**
   * One authored stroll from home: a pattern, then free approved stops on ground this person has
   * walked, inside the pattern's band of walked metres. Nothing known in any band: no stroll yet.
   */
  function stroll(slot: number, routine: Routine, n: number, home: CitizenDestination, destinations: readonly CitizenDestination[]): Trip | null {
    const free = destinations.filter(destination => destination.kind === 'street' && !claims.has(destination.nodeId)).sort(byNode);
    const streets = free.filter(destination => routine.known.has(destination.nodeId));
    const metres = (destination: CitizenDestination): number => routine.known.get(destination.nodeId)!;
    const ground = [home, ...destinations.filter(destination => routine.known.has(destination.nodeId))];
    if (!destinations.some(destination => destination.kind === 'street' && routine.known.has(destination.nodeId))) {
      // No known ground at all (their walk here was not watched): first, the nearest place in front of their own door.
      const doorstep = free.filter(destination => flat(destination.position, home.position) <= R.explore.doorstepMetres)
        .sort((a, b) => flat(a.position, home.position) - flat(b.position, home.position) || byNode(a, b))[0];
      const pattern = R.strolls[0]!;
      return doorstep ? { kind: 'stroll', pattern: pattern.id, stops: [doorstep.nodeId], pauses: [between(pattern.pauseMs, seeded(slot, routine, 'pause', n, 0))] } : null;
    }
    const total = R.strolls.reduce((sum, pattern) => sum + pattern.weight, 0);
    let roll = seeded(slot, routine, 'pattern', n) * total, first = 0;
    while (roll >= R.strolls[first]!.weight) { roll -= R.strolls[first]!.weight; first++; }
    for (let k = 0; k < R.strolls.length; k++) {
      const pattern = R.strolls[(first + k) % R.strolls.length]!;
      let near = streets.filter(destination => metres(destination) >= pattern.near[0] && metres(destination) <= pattern.near[1]);
      // Not the same place twice running when there is another; only that place known makes a step further likelier.
      const again = near.length === 1 && near[0]!.nodeId === routine.lastStop;
      if (near.length > 1) near = near.filter(destination => destination.nodeId !== routine.lastStop);
      // Never on a first outing: someone new to the street keeps to the way they came.
      if (!pattern.second && routine.trips >= R.explore.afterTrips && near.length < R.explore.knownBelow
        && seeded(slot, routine, 'explore', n) < (again ? R.explore.againChance : R.explore.chance)) {
        // A step past known ground: an approved place beside somewhere they have been, inside the band as the crow flies.
        const beside = free.filter(destination => !routine.known.has(destination.nodeId)
          && flat(destination.position, home.position) >= pattern.near[0] && flat(destination.position, home.position) <= pattern.near[1]
          && ground.some(place => flat(place.position, destination.position) <= R.explore.reachMetres));
        if (beside.length) {
          const stop = beside[Math.floor(seeded(slot, routine, 'explore-stop', n) * beside.length)]!;
          return { kind: 'stroll', pattern: pattern.id, stops: [stop.nodeId], pauses: [between(pattern.pauseMs, seeded(slot, routine, 'pause', n, 0))] };
        }
      }
      if (!near.length) continue;
      const stop = near[Math.floor(seeded(slot, routine, 'stop', n, pattern.id) * near.length)]!;
      const stops = [stop.nodeId], pauses = [between(pattern.pauseMs, seeded(slot, routine, 'pause', n, 0))];
      if (pattern.second) {
        // Onward to a second known place a little further on, then home: a short loop of the street.
        const band = pattern.second;
        const onward = streets.filter(destination => destination !== stop && metres(destination) >= band[0] && metres(destination) <= band[1]
          && flat(destination.position, stop.position) >= R.loopApartMetres);
        if (!onward.length) continue;
        stops.push(onward[Math.floor(seeded(slot, routine, 'onward', n) * onward.length)]!.nodeId);
        pauses.push(between(pattern.pauseMs, seeded(slot, routine, 'pause', n, 1)));
      }
      return { kind: 'stroll', pattern: pattern.id, stops, pauses };
    }
    return null;
  }

  /**
   * After the greetings of this step: a person whose rest or pause has ended, and who is not in a
   * greeting, asks for their next approved place. At most one goal per person per step.
   */
  function due(slot: number, sample: CitizenMotionSample, home: CitizenDestination | undefined, destinations: readonly CitizenDestination[], busy: boolean, step: RoutineStep): CitizenGoalRequest | null {
    const routine = routines.get(slot), atMs = step.atMs;
    if (!routine || !home || routine.pending || busy || routine.mode === 'travel' || routine.mode === 'held' || atMs < routine.until) return null;
    if (routine.mode === 'home') {
      if (atMs < routine.nextOpportunity) return null;
      const n = routine.opportunities++, roll = seeded(slot, routine, 'opportunity', n);
      routine.nextOpportunity = atMs + between(R.opportunityMs, seeded(slot, routine, 'gap', n));
      if (roll < R.stayChance) return null;
      const market = destinations.find(destination => destination.kind === 'market');
      if (roll < R.stayChance + R.marketChance && market && atMs >= routine.marketRefusedUntil && !claims.has(market.nodeId)) {
        routine.trip = { kind: 'market', pattern: null, stops: [market.nodeId], pauses: [between(R.marketPauseMs, seeded(slot, routine, 'market-pause', n))] };
      } else routine.trip = stroll(slot, routine, n, home, destinations);
      if (!routine.trip) return null;
    }
    // The next free stop of the trip, otherwise the way home.
    let target: string | null = null;
    while (routine.trip?.stops.length) {
      const next = routine.trip.stops[0]!;
      if (claim(slot, routine, next)) { target = next; break; }
      routine.trip.stops.shift(); routine.trip.pauses.shift();
    }
    if (target === null) {
      if (sample.goalReached && sample.goalNodeId === home.nodeId) {
        // Nothing left to visit and already home: rest until the next opportunity.
        Object.assign(routine, { mode: 'home', trip: null, since: atMs, until: atMs });
        return null;
      }
      release(slot, routine); target = home.nodeId;
    }
    const request = { slot, nodeId: target, startAtMs: atMs + T.stepMs };
    routine.pending = { nodeId: target, startAtMs: request.startAtMs, askedAt: atMs, fromHome: sample.goalReached && sample.goalNodeId === home.nodeId };
    step.emit({ slot, atMs, kind: 'request', routine: kindOf(routine), nodeId: target });
    return request;
  }

  /** The routine's head yaw at a render time: authored looks only while standing. */
  function yaw(slot: number, atMs: number): number {
    const routine = routines.get(slot);
    if (!routine || (routine.mode !== 'stop' && routine.mode !== 'home')) return 0;
    for (const item of routine.looks) {
      if (atMs <= item.atMs || atMs >= item.holdUntil + item.outMs) continue;
      const weight = atMs < item.atMs + item.inMs ? arrive((atMs - item.atMs) / item.inMs) : atMs <= item.holdUntil ? 1 : 1 - ease((atMs - item.holdUntil) / item.outMs);
      return Math.max(-T.look.standingLimit, Math.min(T.look.standingLimit, item.yaw * weight));
    }
    return 0;
  }

  function view(slot: number): CitizenRoutineView | null {
    const routine = routines.get(slot);
    if (!routine) return null;
    const activity = ({ travel: 'walking', stop: 'pausing', home: 'resting', wait: 'waiting', held: 'held' } as const)[routine.mode];
    return { slot, routine: kindOf(routine), activity, nodeId: routine.mode === 'held' ? null : routine.pending?.nodeId ?? routine.goal,
      pattern: routine.trip?.pattern ?? null, sinceMs: routine.since,
      untilMs: routine.mode === 'travel' || routine.mode === 'held' ? null : routine.mode === 'home' ? Math.max(routine.until, routine.nextOpportunity) : routine.until };
  }

  return {
    create, hold, resume, answer, arrival, due, yaw, view,
    has: (slot: number): boolean => routines.has(slot),
    held: (slot: number): boolean => routines.get(slot)?.mode === 'held',
    /** After a clock jump: start again from what motion shows, with fresh timers; nothing is replayed. */
    resettle(slot: number, sample: CitizenMotionSample, atMs: number, home: CitizenDestination | undefined): void {
      const routine = routines.get(slot);
      if (routine && routine.mode !== 'held') settle(slot, sample, atMs, home, routine);
    },
    drop(slot: number): void { const routine = routines.get(slot); if (routine) release(slot, routine); routines.delete(slot); },
    /** Places this person knows, for the bench and tests: node → walked metres from home. */
    known: (slot: number): ReadonlyMap<string, number> => routines.get(slot)?.known ?? new Map(),
    clear(): void { routines.clear(); claims.clear(); },
    get claims(): number { return claims.size; },
    get pending(): number { let count = 0; for (const routine of routines.values()) if (routine.pending) count++; return count; },
  };
}
