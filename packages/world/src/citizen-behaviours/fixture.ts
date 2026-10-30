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

/**
 * The SIMULATED 240-slot town for the street composition: a real five-quarter generated town whose
 * every home is occupied, arriving over two minutes. It sits inside main's existing representation
 * budget for this town (one body per home); it makes no claim about rendering a larger audience.
 */
export const TOWN_FIXTURE = {
  seed: 'hearthwick',
  kingdomId: KingdomIdSchema.parse('1'),
  epoch: 'simulated:citizen-behaviour:town',
  origin: 'simulated' as const,
  startMs: 1_900_000_000_000,
  arrivalSpanMs: 120_000,
} as const;

export function createTownStreets(): NeighbourStreet {
  const fixture = TOWN_FIXTURE;
  const plan = generateSettlementPlan({ seed: fixture.seed, tier: 'town', firstYear: 2022, year: 2026 });
  const slots = plan.homes.map(home => home.slot).sort((a, b) => a - b);
  const names = ['Juniper', 'Moss', 'Rue', 'Sable', 'Rowan', 'Wren', 'Hazel', 'Bramble', 'Pip', 'Clover', 'Fern', 'Robin'];
  // A stable, interleaved arrival order: the town fills from everywhere at once, not quarter by quarter.
  const arrivals = slots.map((slot, index) => ({ slot, atMs: Math.round((((index * 97) % slots.length) / slots.length) * fixture.arrivalSpanMs),
    publicName: index % 20 === 0 ? `SIMULATED ${names[(index / 20) % names.length]}` : null })).sort((a, b) => a.atMs - b.atMs || a.slot - b.slot);
  return { plan, slots, frameAt: framesFor({ ...fixture, arrivals }) };
}

/** Cumulative frames for a fixture; an unchanged frame is the same object, so callers can skip re-applying it. */
function framesFor(fixture: { readonly kingdomId: KingdomPresenceFrame['kingdomId']; readonly epoch: string; readonly origin: 'simulated'; readonly startMs: number;
  readonly arrivals: readonly { readonly slot: number; readonly atMs: number; readonly publicName: string | null }[] }): NeighbourStreet['frameAt'] {
  let cached: { key: string; frame: KingdomPresenceFrame } | null = null;
  return (atMs, departures = new Map()) => {
    const arrived = fixture.arrivals.filter(arrival => fixture.startMs + arrival.atMs <= atMs);
    if (!arrived.length) return null;
    let sequence = 0, asOf: number = fixture.startMs;
    const left = new Set<number>();
    for (const arrival of arrived) {
      const since = fixture.startMs + arrival.atMs, leftAt = departures.get(arrival.slot);
      sequence++; asOf = Math.max(asOf, since);
      if (leftAt !== undefined && leftAt <= atMs && leftAt >= since) { sequence++; asOf = Math.max(asOf, leftAt); left.add(arrival.slot); }
    }
    const key = `${sequence}:${asOf}:${[...left].join(',')}`;
    if (cached?.key === key) return cached.frame;
    const windows = arrived.map(arrival => left.has(arrival.slot)
      ? { slot: arrival.slot, present: false, publicName: null, since: fixture.startMs + arrival.atMs }
      : { slot: arrival.slot, present: true, publicName: arrival.publicName, since: fixture.startMs + arrival.atMs });
    const frame: KingdomPresenceFrame = { version: 1, kingdomId: fixture.kingdomId, epoch: fixture.epoch, sequence, asOf, origin: fixture.origin,
      streamLive: true, connection: 'fresh', windows };
    cached = { key, frame }; return frame;
  };
}

export function createNeighbourStreet(): NeighbourStreet {
  const fixture = NEIGHBOUR_FIXTURE;
  const plan = generateSettlementPlan({ seed: fixture.seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const slots = fixture.arrivals.map(arrival => arrival.slot);
  for (const slot of slots) if (!plan.homes.some(home => home.slot === slot)) throw new Error(`Fixture slot ${slot} has no home`);
  return { plan, slots, frameAt: framesFor(fixture) };
}
