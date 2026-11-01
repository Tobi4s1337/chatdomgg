import { GrowthSceneFrameSchema, type GrowthSceneFeed, type GrowthSceneFrame } from '@chatdom/shared';

/** Caller-driven fixture feed. It never opens a transport or represents live data. */
export interface SimulatedGrowthFeed {
  readonly feed: GrowthSceneFeed;
  publish(frame: unknown): void;
  unavailable(): void;
}

export function createSimulatedGrowthFeed(): SimulatedGrowthFeed {
  const listeners = new Set<{ receive: (frame: GrowthSceneFrame) => void; unavailable: () => void }>();
  return {
    feed: { label: 'SIMULATED', subscribe(receive, unavailable) {
      const listener = { receive, unavailable };
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    } },
    publish(input) {
      const frame = GrowthSceneFrameSchema.parse(input);
      if (frame.origin !== 'simulated') throw new Error('A simulated feed requires simulated frames');
      for (const listener of [...listeners]) listener.receive(frame);
    },
    unavailable() { for (const listener of [...listeners]) listener.unavailable(); },
  };
}
