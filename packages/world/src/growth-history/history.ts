import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { createGrowthState, GROWTH_POLICY_V1, reduceGrowth } from '../growth';
import type { GrowthMilestone, GrowthObservation, GrowthState } from '../growth';

/** This is synthetic evidence, isolated from any live kingdom or ingestion path. */
export const SIMULATED_HISTORY_LABEL = 'SIMULATED' as const;
const kingdomId = KingdomIdSchema.parse('999999999999999999');
const people = ['999999999999999901', '999999999999999902', '999999999999999903'].map(id => PersonIdSchema.parse(id));
const start = Date.UTC(2026, 0, 5, 19);
const dayMs = GROWTH_POLICY_V1.streamDayMs;

type ObservationBody = GrowthObservation extends infer O ? O extends GrowthObservation
  ? Omit<O, 'kingdomId' | 'origin' | 'seq' | 'at'> : never : never;

export interface SimulatedGrowthFact {
  readonly observation: GrowthObservation;
  readonly milestones: readonly GrowthMilestone[];
}
export interface SimulatedGrowthHistory {
  readonly label: typeof SIMULATED_HISTORY_LABEL;
  readonly seed: number;
  readonly facts: readonly SimulatedGrowthFact[];
  readonly state: GrowthState;
}

/** Replay only reducer observations, retaining each emitted milestone beside its source fact. */
export function replaySimulatedGrowth(observations: readonly GrowthObservation[]): SimulatedGrowthFact[] {
  let state = createGrowthState(kingdomId, 'simulated');
  return observations.map(observation => {
    if (observation.origin !== 'simulated' || observation.kingdomId !== kingdomId || observation.seq !== state.sequence + 1) {
      throw new TypeError('Expected ordered, contiguous simulated fixture evidence');
    }
    const result = reduceGrowth(state, observation);
    state = result.state;
    return { observation, milestones: result.milestones };
  });
}

/** Seven weeks of witnessed streams, including quiet nights and different attendance patterns. */
export function createSimulatedGrowthHistory(seed = 17): SimulatedGrowthHistory {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError('Seed must be a non-negative safe integer');
  const observations: GrowthObservation[] = [];
  const add = (body: ObservationBody, at: number) => observations.push({ ...body, kingdomId, origin: 'simulated', seq: observations.length + 1, at });
  people.forEach((personId, index) => add({ type: 'home-bound', personId, plotId: `simulated-plot-${index + 1}`, installedTier: null }, start - 1));
  for (let day = 0; day < 49; day++) {
    const at = start + day * dayMs;
    const sessionId = `simulated-stream-${day + 1}`;
    add({ type: 'stream-observed', sessionId, startedAt: at }, at);
    // Some streams have no qualifying observations; absence is not made into an event.
    if ((day + seed % 11) % 11 === 0) continue;
    people.forEach((personId, index) => {
      if (index === 0 || (day + seed % (index + 3)) % (index + 3) !== 0) {
        add({ type: 'presence-qualified', personId, sessionId, source: 'observed-presence',
          coveredMs: GROWTH_POLICY_V1.qualifiedPresenceMs, evidenceReceipt: `simulated-receipt-${day + 1}-${index + 1}` },
        at + GROWTH_POLICY_V1.qualifiedPresenceMs + index);
      }
    });
  }
  const facts = replaySimulatedGrowth(observations);
  const state = observations.reduce((current, observation) => reduceGrowth(current, observation).state, createGrowthState(kingdomId, 'simulated'));
  return { label: SIMULATED_HISTORY_LABEL, seed, facts, state };
}

/** Concise fact timeline, derived from reducer output rather than invented achievements. */
export function growthFactTimeline(history: SimulatedGrowthHistory): readonly { readonly date: string; readonly milestone: GrowthMilestone }[] {
  return history.facts.flatMap(fact => fact.milestones.map(milestone => ({
    date: new Date(milestone.at).toISOString().slice(0, 10), milestone,
  })));
}

