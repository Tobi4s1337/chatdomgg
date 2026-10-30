import { KingdomPresenceFrameSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { randomUnit, seedHash } from '../layout';
import type { SettlementPlan } from '../settlement/types';
import { createCitizenRoutes, routeHeading, sampleRoute } from './routes';
import type { CitizenGoalRequest, CitizenGoalResult, CitizenMotion, CitizenMotionOptions, CitizenMotionSample, CitizenRoute } from './types';

interface Goal { startAtMs: number; route: CitizenRoute; baseDistance: number; homeLit: boolean; homeLitAtMs: number | null; startHeading: number }
interface Stay { since: number; until: number | null; publicName: string | null; hide: boolean; goals: Goal[] }
interface Travel { distance: number; speed: number; arrived: boolean; duration: number }
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const ease = (n: number): number => { const t = clamp(n); return t * t * (3 - 2 * t); };
function turn(a: number, b: number, t: number): number { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * ease(t); }

/** Closed-form acceleration, cruise and quick stop: seeking needs no simulation ticks. */
function travel(seconds: number, length: number, speed: number): Travel {
  if (length < 1e-8) return { distance: 0, speed: 0, arrived: true, duration: 0 };
  const up = .45, down = .35, peak = Math.min(speed, 2 * length / (up + down));
  const cruise = Math.max(0, length / peak - (up + down) / 2), duration = up + cruise + down;
  if (seconds >= duration) return { distance: length, speed: 0, arrived: true, duration };
  if (seconds <= 0) return { distance: 0, speed: 0, arrived: false, duration };
  if (seconds < up) return { distance: peak / up * seconds * seconds / 2, speed: peak * seconds / up, arrived: false, duration };
  if (seconds <= up + cruise) return { distance: peak * (seconds - up / 2), speed: peak, arrived: false, duration };
  const remaining = duration - seconds;
  return { distance: length - peak / down * remaining * remaining / 2, speed: peak * remaining / down, arrived: false, duration };
}

function validPositive(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`Invalid citizen ${name}`);
}

/** Presence projection -> reproducible street walks. Owns no identity, tenancy or rewards. */
export function createCitizenMotion(plan: SettlementPlan, options: CitizenMotionOptions = {}): CitizenMotion {
  validPositive(options.entryDistance, 'entry distance'); validPositive(options.speed, 'speed'); validPositive(options.strideLength, 'stride');
  const router = createCitizenRoutes(plan, options.entryDistance), { routeForSlot, destinationsForSlot } = router;
  const stride = options.strideLength ?? .75;
  const histories = new Map<number, Stay[]>(), speeds = new Map<number, number>();
  let slots: number[] = [], latest: KingdomPresenceFrame | null = null;
  const clear = (): void => { histories.clear(); speeds.clear(); slots = []; latest = null; };

  const applyFrame = (input: KingdomPresenceFrame): boolean => {
    const frame = KingdomPresenceFrameSchema.parse(input);
    if (latest && frame.epoch === latest.epoch && frame.sequence <= latest.sequence) return false;
    if (latest && (frame.epoch !== latest.epoch || frame.kingdomId !== latest.kingdomId || frame.origin !== latest.origin || frame.asOf < latest.asOf)) clear();
    const windows = new Map(frame.windows.map(window => [window.slot, window]));
    for (const [slot, history] of histories) {
      const current = history.at(-1)!, window = windows.get(slot);
      if (current.until !== null) continue;
      if (!window?.present || window.since !== current.since) {
        current.until = frame.asOf; current.publicName = null;
        current.hide = !frame.streamLive || frame.connection !== 'fresh' || options.leaveMode === 'hide';
      }
    }
    for (const window of frame.windows) {
      if (!window.present || !routeForSlot(window.slot)) continue;
      const history = histories.get(window.slot) ?? [], current = history.at(-1);
      if (current && current.until === null && current.since === window.since) current.publicName = window.publicName;
      else history.push({ since: window.since, until: null, publicName: window.publicName, hide: false, goals: [] });
      histories.set(window.slot, history);
      if (!speeds.has(window.slot)) speeds.set(window.slot, options.speed ?? 1.05 + .3 * randomUnit(seedHash(`${plan.config.seed}:pace:${window.slot}`)));
    }
    slots = [...histories.keys()].sort((a, b) => a - b); latest = frame; return true;
  };

  const sample = (atMs: number): readonly CitizenMotionSample[] => {
    if (!Number.isFinite(atMs)) throw new Error('Citizen sampling needs a finite kingdom clock');
    const samples: CitizenMotionSample[] = [];
    for (const slot of slots) {
      const history = histories.get(slot)!;
      let low = 0, high = history.length;
      while (low < high) { const middle = (low + high) >>> 1; if (history[middle]!.since <= atMs) low = middle + 1; else high = middle; }
      const stay = history[low - 1]; if (!stay) continue;
      const elapsed = (atMs - stay.since) / 1000;
      const leaving = stay.until !== null && atMs >= stay.until;
      if (leaving && stay.hide) continue;
      const effectiveTime = leaving ? stay.until! : atMs;
      let goal: Goal | undefined;
      for (let i = stay.goals.length - 1; i >= 0; i--) if (stay.goals[i]!.startAtMs <= effectiveTime) { goal = stay.goals[i]; break; }
      const route = goal?.route ?? routeForSlot(slot)!, speed = speeds.get(slot)!;
      const incoming = travel((effectiveTime - (goal?.startAtMs ?? stay.since)) / 1000, route.length, speed);
      let routeDistance = incoming.distance, distance = (goal?.baseDistance ?? 0) + incoming.distance, velocity = incoming.speed;
      let heading = routeHeading(route, routeDistance), opacity = ease(elapsed / .45);
      let state: CitizenMotionSample['state'] = incoming.arrived ? route.destinationKind === 'home' ? 'home' : 'idle' : 'walking';
      heading = turn(heading, route.homeHeading, (routeDistance - route.length + .7) / .7);
      if (goal) heading = turn(goal.startHeading, heading, (effectiveTime - goal.startAtMs) / 350);
      if (leaving) {
        const seconds = (atMs - stay.until!) / 1000;
        // Turn on the public path before stepping away; don't teleport back to the gate.
        const outgoing = travel(seconds - .3, incoming.distance, speed);
        if (outgoing.arrived && seconds >= .3) continue;
        routeDistance -= outgoing.distance; distance += outgoing.distance; velocity = outgoing.speed; state = 'leaving';
        heading = turn(heading, routeHeading(route, routeDistance) + Math.PI, seconds / .3);
        opacity *= ease(routeDistance / .6);
      }
      samples.push({ slot, publicName: leaving ? null : stay.publicName, state, position: sampleRoute(route, routeDistance), heading,
        speed: velocity, distance, walkPhase: (distance / stride) % 1,
        homeLit: !leaving && ((goal?.homeLit ?? false) || (incoming.arrived && route.destinationKind === 'home')), opacity,
        homeLitAtMs: leaving ? null : goal?.homeLitAtMs ?? (incoming.arrived && route.destinationKind === 'home'
          ? (goal?.startAtMs ?? stay.since) + incoming.duration * 1000 : null),
        goalNodeId: route.destinationNodeId, goalReached: !leaving && incoming.arrived });
    }
    return samples;
  };
  const requestGoal = (request: CitizenGoalRequest): CitizenGoalResult => {
    const stay = histories.get(request.slot)?.at(-1);
    if (!latest || !stay || stay.until !== null) return { accepted: false, reason: 'absent' };
    if (!Number.isFinite(request.startAtMs) || request.startAtMs < latest.asOf
      || request.startAtMs <= (stay.goals.at(-1)?.startAtMs ?? -Infinity)) return { accepted: false, reason: 'out-of-order' };
    if (!destinationsForSlot(request.slot).some(destination => destination.nodeId === request.nodeId)) return { accepted: false, reason: 'unknown-destination' };
    const current = sample(request.startAtMs).find(person => person.slot === request.slot);
    if (!current || current.state === 'leaving') return { accepted: false, reason: 'absent' };
    const route = router.routeTo(request.slot, current.position, request.nodeId);
    if (!route) return { accepted: false, reason: 'blocked' };
    stay.goals.push({ startAtMs: request.startAtMs, route, baseDistance: current.distance, homeLit: current.homeLit,
      homeLitAtMs: current.homeLitAtMs, startHeading: current.heading });
    return { accepted: true };
  };
  return { applyFrame, sample, routeForSlot, destinationsForSlot, requestGoal, clear };
}
