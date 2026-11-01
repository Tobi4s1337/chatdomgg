import { KingdomIdSchema, PersonIdSchema, type GrowthSceneFrame, type HomeTier, type KingdomId, type PersonId } from '@chatdom/shared';
import { createGrowthState, GROWTH_POLICY_V1, projectGrowthScene, reduceGrowth, type GrowthMilestone, type GrowthObservation, type GrowthState } from '@chatdom/world/growth';

/**
 * A SIMULATED year of one kingdom, earned the only way growth is earned: ordered stream-nights and ten witnessed
 * minutes of presence per person, reduced by the real policy. Nothing here sets a tier; the reducer decides.
 */
export interface SimulatedNeighbour { readonly plotId: string; readonly installedTier: HomeTier; readonly attendance: number }
export interface SimulatedHistoryInput {
  readonly kingdomId?: string;
  /** The plot the new citizen is given, at the kingdom's growth edge. */
  readonly heroPlotId: string;
  readonly neighbours?: readonly SimulatedNeighbour[];
  /** The UTC day the citizen's plot is bound, and the last stream-night recorded. */
  readonly from?: string;
  readonly until?: string;
  readonly crowd?: number;
}

export interface SimulatedHistory {
  readonly kingdomId: KingdomId;
  readonly heroPlotId: string;
  /** Bootstrap first (quiet), then one frame after every stream-night that someone qualified on. */
  readonly frames: readonly GrowthSceneFrame[];
  readonly nights: number;
}

const DAY = GROWTH_POLICY_V1.streamDayMs;
const MINUTES = 60_000;
const fract = (n: number) => n - Math.floor(n);
/** Stable per (who, night): a person's attendance never depends on iteration order. */
export const attends = (seed: number, day: number, rate: number) => fract(Math.sin(seed * 12.9898 + day * 78.233) * 43758.5453) < rate;

/** Five evenings a week, with a summer fortnight and the winter holidays off. */
export function isStreamNight(day: number): boolean {
  const date = new Date(day * DAY), weekday = date.getUTCDay(), month = date.getUTCMonth(), dom = date.getUTCDate();
  if (weekday === 0 || weekday === 5) return false;
  if (month === 7 && dom >= 4 && dom <= 17) return false;
  if (month === 11 && dom >= 22 || month === 0 && dom === 1) return false;
  return true;
}

export function simulateGrowthHistory(input: SimulatedHistoryInput): SimulatedHistory {
  const kingdomId = KingdomIdSchema.parse(input.kingdomId ?? '41960001');
  const from = Math.floor(Date.parse(`${input.from ?? '2025-02-03'}T00:00:00Z`) / DAY);
  const until = Math.floor(Date.parse(`${input.until ?? '2026-01-05'}T00:00:00Z`) / DAY);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from) throw new RangeError('The simulated history needs an ordered span of days.');
  const hero = PersonIdSchema.parse('51000001');
  const neighbours = (input.neighbours ?? []).map((n, i) => ({ ...n, person: PersonIdSchema.parse(String(51000101 + i)) }));
  const crowd: { person: PersonId; rate: number }[] = Array.from({ length: input.crowd ?? 26 }, (_, i) => ({
    person: PersonIdSchema.parse(String(51001001 + i)), rate: .28 + fract(Math.sin(i * 3.17) * 917.3) * .55 }));
  let state: GrowthState = createGrowthState(kingdomId, 'simulated');
  const frames: GrowthSceneFrame[] = [];
  let pending: GrowthMilestone[] = [];
  const send = (body: DistributiveOmit<GrowthObservation, 'kingdomId' | 'origin' | 'seq' | 'at'>, at: number) => {
    const result = reduceGrowth(state, { ...body, kingdomId, origin: 'simulated', seq: state.sequence + 1, at: Math.max(at, state.asOf) } as GrowthObservation);
    state = result.state; pending.push(...result.milestones);
  };
  const bindAt = from * DAY + 18 * 3_600_000;
  send({ type: 'home-bound', personId: hero, plotId: input.heroPlotId, installedTier: null }, bindAt);
  for (const n of neighbours) send({ type: 'home-bound', personId: n.person, plotId: n.plotId, installedTier: n.installedTier }, bindAt);
  frames.push(projectGrowthScene(state, []));
  pending = [];
  let nights = 0;
  for (let day = from; day <= until; day++) {
    if (!isStreamNight(day)) continue;
    const startedAt = day * DAY + 19 * 3_600_000;
    send({ type: 'stream-observed', sessionId: `night:${day}`, startedAt }, startedAt);
    let minute = 12;
    const qualify = (person: PersonId) => send({ type: 'presence-qualified', personId: person, sessionId: `night:${day}`,
      source: 'observed-presence', coveredMs: GROWTH_POLICY_V1.qualifiedPresenceMs, evidenceReceipt: `simulated:${day}:${person}` }, startedAt + (minute++) * MINUTES);
    // The new citizen rarely misses an evening; the first three nights are the ones that earn the hut.
    if (day - from < 5 || attends(7, day, .93)) qualify(hero);
    neighbours.forEach((n, i) => { if (attends(101 + i, day, n.attendance)) qualify(n.person); });
    crowd.forEach((c, i) => { if (attends(1001 + i, day, c.rate)) qualify(c.person); });
    nights++;
    frames.push(projectGrowthScene(state, pending));
    pending = [];
  }
  return { kingdomId, heroPlotId: input.heroPlotId, frames, nights };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
