import { GrowthSceneFrameSchema } from '@chatdom/shared';
import type { GrowthSceneFeed, GrowthSceneFrame } from '@chatdom/shared';
import { createGrowthState, projectGrowthScene, reduceGrowth } from '../growth';
import type { GrowthObservation } from '../growth';
import { replaySimulatedGrowth, SIMULATED_HISTORY_LABEL } from './history';

/**
 * Each frame is the state just after one witnessed observation. Its beats are only that
 * observation's reducer output, not a history tail to be mistaken for new arrivals.
 * Replaying the evidence also prevents callers from supplying invented milestones.
 */
export function projectSimulatedGrowthHistory(observations: readonly GrowthObservation[]): readonly GrowthSceneFrame[] {
  const facts = replaySimulatedGrowth(observations);
  if (facts.length === 0) return [];
  let state = createGrowthState(facts[0]!.observation.kingdomId, 'simulated');
  return facts.map(({ observation }) => {
    const transition = reduceGrowth(state, observation);
    state = transition.state;
    return GrowthSceneFrameSchema.parse(projectGrowthScene(state, transition.milestones));
  });
}

/** Validate an external presentation frame and its declared provenance, without granting authority. */
export function parseGrowthSceneFrameForLabel(input: unknown, label: GrowthSceneFeed['label']): GrowthSceneFrame | null {
  const parsed = GrowthSceneFrameSchema.safeParse(input);
  if ((label !== 'LIVE' && label !== 'SIMULATED') || !parsed.success
    || parsed.data.origin !== (label === 'LIVE' ? 'live' : 'simulated')) return null;
  return parsed.data;
}

/**
 * A single, explicitly simulated presentation snapshot. Invalid or live input is
 * unavailable, never an empty or successful live result. Subscribe sends a fresh
 * copy; the feed has no transport, authority or mutation commands.
 */
export function createSimulatedGrowthFeed(input: unknown): GrowthSceneFeed {
  const snapshot = parseGrowthSceneFrameForLabel(input, SIMULATED_HISTORY_LABEL);
  return {
    label: SIMULATED_HISTORY_LABEL,
    subscribe(receive, unavailable) {
      if (snapshot) receive(GrowthSceneFrameSchema.parse(snapshot));
      else unavailable();
      return () => { /* A one-shot snapshot has no ongoing subscription. */ };
    },
  };
}
