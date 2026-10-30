import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { generateSettlementPlan } from '../settlement/generator';
import type { SettlementPlan } from '../settlement/types';

/**
 * The SIMULATED nine-neighbour street shared by the scenario test and the bench. It is a
 * labelled input fixture, not a producer: no Twitch data, attendance or history is implied.
 * Nine neighbours on one street of a real generated hamlet arrive over 43 s, the way a
 * public presence projection would admit them; three have public names, six stay anonymous.
 */
export const NEIGHBOUR_FIXTURE = {
  seed: 'hearthwick',
  kingdomId: KingdomIdSchema.parse('1'),
  epoch: 'simulated:citizen-behaviour',
  origin: 'simulated' as const,
  startMs: 1_900_000_000_000,
  arrivals: [
    { slot: 2, atMs: 0, publicName: 'SIMULATED Juniper' },
    { slot: 1, atMs: 4_000, publicName: null },
    { slot: 0, atMs: 9_000, publicName: null },
    { slot: 3, atMs: 15_000, publicName: 'SIMULATED Moss' },
    { slot: 5, atMs: 21_000, publicName: null },
    { slot: 7, atMs: 26_000, publicName: null },
    { slot: 6, atMs: 32_000, publicName: 'SIMULATED Rue' },
    { slot: 4, atMs: 37_000, publicName: null },
    { slot: 8, atMs: 43_000, publicName: null },
  ],
} as const;

export interface NeighbourStreet {
  readonly plan: SettlementPlan;
  readonly slots: readonly number[];
  /**
   * The cumulative public frame at a kingdom time, with optional departures (slot → kingdom ms).
   * Its sequence counts the arrivals and departures already observed, so replaying earlier
   * times reproduces exactly the frames a live caller would have applied.
   */
  frameAt(atMs: number, departures?: ReadonlyMap<number, number>): KingdomPresenceFrame | null;
}

export function createNeighbourStreet(): NeighbourStreet {
  const fixture = NEIGHBOUR_FIXTURE;
  const plan = generateSettlementPlan({ seed: fixture.seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const slots = fixture.arrivals.map(arrival => arrival.slot);
  for (const slot of slots) if (!plan.homes.some(home => home.slot === slot)) throw new Error(`Fixture slot ${slot} has no home`);
  const frameAt = (atMs: number, departures: ReadonlyMap<number, number> = new Map()): KingdomPresenceFrame | null => {
    const arrived = fixture.arrivals.filter(arrival => fixture.startMs + arrival.atMs <= atMs);
    if (!arrived.length) return null;
    let sequence = 0, asOf: number = fixture.startMs;
    const windows = arrived.map(arrival => {
      const since = fixture.startMs + arrival.atMs, leftAt = departures.get(arrival.slot);
      sequence++; asOf = Math.max(asOf, since);
      if (leftAt !== undefined && leftAt <= atMs && leftAt >= since) {
        sequence++; asOf = Math.max(asOf, leftAt);
        return { slot: arrival.slot, present: false, publicName: null, since };
      }
      return { slot: arrival.slot, present: true, publicName: arrival.publicName, since };
    });
    return { version: 1, kingdomId: fixture.kingdomId, epoch: fixture.epoch, sequence, asOf, origin: fixture.origin,
      streamLive: true, connection: 'fresh', windows };
  };
  return { plan, slots, frameAt };
}
