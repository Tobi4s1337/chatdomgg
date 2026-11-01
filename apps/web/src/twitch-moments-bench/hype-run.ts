import type { BenchCitizen, BenchSimulation } from './simulation';

/**
 * The SIMULATED Hype Train run over the stream picture: synthetic `channel.hype_train.*` v2 frames through the real
 * Herald ingest, and the SIMULATED realm battle authority answering the ingest's level-3 dragon request. Times are
 * ms from the run's start. Nothing here decides a level, a strike or an outcome for the browser: the train's level
 * comes from the frames, the battle's every revision from the authority, and the bench only says when each is sent.
 */
export type HypeOutcome = 'victory' | 'retreat';

export interface HypeStep {
  readonly at: number;
  readonly label: string;
  run(sim: BenchSimulation, riders: readonly BenchCitizen[]): void;
}

/** When the run's reports arrive. Level 3 at `wake`; the realm's dragon is summoned on its own clock from there. */
const T = { begin: 0, level2: 9000, wake: 18_000, decide: 58_000, end: 76_000 } as const;

export const HYPE_RUN = {
  /** The named neighbours who ride the train (the observed top contributors; never "everyone"). */
  riders: ['Juniper', 'Rowan', 'Marigold', 'Bramble'] as const,
  times: T,
  steps(outcome: HypeOutcome): readonly HypeStep[] {
    return [
      { at: T.begin, label: 'Hype Train begins', run: (sim, r) => { sim.hype('begin', 1, r.slice(0, 1)); } },
      { at: T.level2, label: 'Level 2', run: (sim, r) => { sim.hype('progress', 2, r.slice(0, 2)); } },
      { at: T.wake, label: 'Level 3: the dragon request goes to the SIMULATED realm', run: (sim, r) => { sim.hype('progress', 3, r.slice(0, 3)); } },
      // The SIMULATED realm closes the fight as the run asked; a real realm decides this itself.
      { at: T.decide, label: outcome === 'victory' ? 'The SIMULATED realm: the dragon falls' : 'The SIMULATED realm: time runs out', run: sim => { sim.authority?.finish(); } },
      { at: T.end, label: 'Hype Train ends at level 3', run: (sim, r) => { sim.hype('end', 3, r); } },
    ];
  },
  /** Stills for the sequence capture, ms from the run's start. */
  beats(outcome: HypeOutcome): readonly (readonly [string, number])[] {
    const common: [string, number][] = [
      ['rest', -500], ['dressed', 4200], ['level2', 10_400], ['wakes', T.wake + 2600], ['rises', T.wake + 4900], ['climbs', T.wake + 7200],
      ['circles', T.wake + 15_000], ['swoop', T.wake + 8400 + 3300], ['breath', T.wake + 8400 + 8700], ['looks-up', T.wake + 30_000],
    ];
    return outcome === 'victory'
      ? [...common, ['reels', T.decide + 900], ['falls', T.decide + 4200], ['lands', T.decide + 7600], ['home', T.end + 4000]]
      : [...common, ['turns', T.decide + 1100], ['flies-home', T.decide + 4300], ['settles', T.decide + 8600], ['home', T.end + 4000]];
  },
};
