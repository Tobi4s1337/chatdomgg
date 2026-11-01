import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import { RealmMomentObservationSchema, type RealmMomentObservation } from '@chatdom/shared/realm';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import type { CitizenDirectory, CitizenDisclosure } from '../../../herald/src/twitch-moments/ports';
import { applyHomecoming, applyTown, rewardOf, type TownResult } from './apply';
import { townRecords } from './records';

const K = KingdomIdSchema.parse('129634568');
const NOW = Date.UTC(2026, 10, 1, 19, 0);
const DAY = 86_400_000;
const p = (n: number) => PersonIdSchema.parse(String(71_000_000 + n));
const JUNIPER = p(1), QUIET = p(2), ROWAN = p(3), GUEST = p(4);
const people = new Map<PersonId, CitizenDisclosure>([
  [JUNIPER, { disclosure: 'named', displayName: 'Juniper', homeSlot: 3 }],
  [QUIET, { disclosure: 'anonymous' }],
  [ROWAN, { disclosure: 'named', displayName: 'Rowan', homeSlot: 5 }],
  [GUEST, { disclosure: 'named', displayName: 'Guest', homeSlot: null }],
]);
const directory: CitizenDirectory = { resolve: async (kingdom, id) => (kingdom === K ? people.get(id) ?? null : null) };

let n = 0;
const observe = (notice: RealmMomentObservation['notice'], at = NOW): RealmMomentObservation =>
  RealmMomentObservationSchema.parse({ version: 1, id: `obs-${++n}`, kingdomId: K, origin: 'simulated', occurredAt: at, receivedAt: at, notice });
const person = (id: PersonId, name: string) => ({ personId: id, name });

function town() {
  let now = NOW;
  const store = createMemoryMomentRecords({ now: () => now });
  return {
    store,
    /** One act in its own transaction, as the realm's ingress runs it. */
    run(observation: RealmMomentObservation, settled: ReadonlyMap<PersonId, boolean> = new Map()): Promise<TownResult> {
      now = observation.occurredAt;
      return store.port.transact(K, tx => applyTown(observation, { kingdomId: K, town: townRecords(tx), directory, settled }));
    },
    home(personId: PersonId, fresh: boolean, at: number): Promise<TownResult> {
      now = at;
      return store.port.transact(K, tx => applyHomecoming({ kingdomId: K, town: townRecords(tx), directory, settled: new Map() }, personId, fresh, at));
    },
  };
}
const bodies = (result: TownResult) => (result.outcome === 'applied' ? result.facts.map(f => ({ current: f.current, ...f.body })) : []);
const online = (streamId: string, at = NOW) => observe({ kind: 'stream', phase: 'online', streamId, startedAt: at }, at);

describe('a follow', () => {
  it('plants a sapling by the follower’s home, once, and the grove lasts', async () => {
    const t = town();
    const first = bodies(await t.run(observe({ kind: 'follow', person: person(JUNIPER, 'Juniper'), followedAt: NOW }), new Map([[JUNIPER, true]])));
    expect(first).toEqual([
      expect.objectContaining({ kind: 'follow', current: false, credit: { displayName: 'Juniper', slot: 3 }, returning: false, homeSlot: 3 }),
      expect.objectContaining({ kind: 'grove', key: 'grove', current: true, plantings: [{ slot: 3, sapling: NOW, tree: null }] }),
    ]);
    // An unfollow and a follow again is the same home and the same sapling: nothing new to play.
    expect(await t.run(observe({ kind: 'follow', person: person(JUNIPER, 'Juniper'), followedAt: NOW + DAY }, NOW + DAY), new Map([[JUNIPER, false]])))
      .toEqual({ outcome: 'stale' });
  });

  it('never names or locates a quiet follower, and welcomes a homeless one at the gate', async () => {
    const t = town();
    expect(await t.run(observe({ kind: 'follow', person: person(QUIET, 'Quiet'), followedAt: NOW }))).toEqual({ outcome: 'stale' });
    const guest = bodies(await t.run(observe({ kind: 'follow', person: person(GUEST, 'Guest'), followedAt: NOW })));
    expect(guest).toEqual([expect.objectContaining({ kind: 'follow', homeSlot: null })]);
  });
});

describe('the night', () => {
  it('opens on going live, counts its nights, ignores the same broadcast again and rests offline', async () => {
    const t = town();
    expect(bodies(await t.run(online('s1')))).toEqual([expect.objectContaining({ kind: 'night', key: 'night', current: true, phase: 'open', number: 1, nightKey: 'night.1' })]);
    expect(await t.run(online('s1', NOW + 60_000))).toEqual({ outcome: 'stale' });
    expect(bodies(await t.run(observe({ kind: 'stream', phase: 'offline', streamId: null, startedAt: null }, NOW + 3_600_000))))
      .toEqual([expect.objectContaining({ phase: 'rest', number: 1 })]);
    expect(await t.run(observe({ kind: 'stream', phase: 'offline', streamId: null, startedAt: null }, NOW + 3_700_000))).toEqual({ outcome: 'stale' });
    expect(bodies(await t.run(online('s2', NOW + 2 * DAY)))).toEqual([expect.objectContaining({ phase: 'open', number: 2, nightKey: 'night.2' })]);
  });

  it('welcomes a returning citizen once a night, counting the days away from fourteen', async () => {
    const t = town();
    await t.run(online('s1'));
    // First words of the first night: welcomed, no days to count.
    expect(bodies(await t.home(JUNIPER, false, NOW + 1000))).toEqual([expect.objectContaining({ kind: 'homecoming', key: 'home.1.3', awayDays: null })]);
    expect(await t.home(JUNIPER, false, NOW + 2000)).toEqual({ outcome: 'stale' });
    // Settled tonight: home already, no relight; quiet and homeless people are welcomed without a beat.
    expect(bodies(await t.home(ROWAN, true, NOW + 3000))).toEqual([]);
    expect(await t.home(ROWAN, false, NOW + 4000)).toEqual({ outcome: 'stale' });
    expect(bodies(await t.home(QUIET, false, NOW + 5000))).toEqual([]);
    // Three weeks later, a new night.
    const later = NOW + 21 * DAY;
    await t.run(online('s2', later));
    expect(bodies(await t.home(JUNIPER, false, later + 1000))).toEqual([expect.objectContaining({ key: 'home.2.3', awayDays: 21 })]);
    // A citizen back after a few days is welcomed without the count.
    await t.run(online('s3', later + 3 * DAY));
    expect(bodies(await t.home(JUNIPER, false, later + 3 * DAY + 1000))).toEqual([expect.objectContaining({ awayDays: null })]);
  });

  it('never reopens an ended broadcast or replaces a newer night with reordered evidence', async () => {
    const t = town();
    await t.run(online('s1'));
    await t.run(observe({ kind: 'stream', phase: 'offline', streamId: null, startedAt: null }, NOW + 10_000));
    expect(await t.run(online('s1', NOW + 20_000))).toEqual({ outcome: 'stale' });
    await t.run(online('s2', NOW + DAY));
    expect(await t.run(online('old', NOW + 5000))).toEqual({ outcome: 'stale' });
    expect(await t.run(observe({ kind: 'stream', phase: 'online', streamId: 's1', startedAt: NOW }, NOW + DAY + 1000)))
      .toEqual({ outcome: 'stale' });
    expect(await t.home(JUNIPER, false, NOW + 1000)).toEqual({ outcome: 'stale' });
    expect(bodies(await t.home(JUNIPER, false, NOW + DAY + 2000))).toMatchObject([{ kind: 'homecoming', nightKey: 'night.2' }]);
  });

  it('welcomes nobody while the gate is closed', async () => {
    const t = town();
    expect(await t.home(JUNIPER, false, NOW)).toEqual({ outcome: 'stale' });
  });

  it('restores an older live broadcast quietly using the reconciliation time to order its evidence', async () => {
    const t = town();
    await t.run(online('s1'));
    await t.run(observe({ kind: 'stream', phase: 'offline', streamId: null, startedAt: null }, NOW + 3_600_000));
    const reconciledAt = NOW + 6 * 3_600_000;
    // Helix's previous offline answer trailed the new stream starting by thirty seconds.
    const result = bodies(await t.run(observe({ kind: 'stream', phase: 'online', streamId: 's2', startedAt: NOW + 3_570_000 }, reconciledAt)));
    expect(result).toMatchObject([{ kind: 'night', phase: 'open', number: 2, openedAt: NOW + 3_570_000, displayUntil: reconciledAt }]);
  });
});

describe('kingdom rewards', () => {
  const redeem = (title: string, who: PersonId, status: 'unfulfilled' | 'fulfilled' | 'canceled' | 'unknown' = 'unfulfilled', id = `r${++n}`) =>
    observe({ kind: 'redemption', redemptionId: id, rewardId: 'reward-1', rewardTitle: title, person: person(who, 'x'), status });

  it('knows its rewards by title, in any case, and leaves the streamer’s own rewards alone', async () => {
    expect(rewardOf('  Ring   the BELL ')).toBe('ring-the-bell');
    expect(rewardOf('Hydrate!')).toBeNull();
    const t = town();
    expect(await t.run(redeem('Hydrate!', JUNIPER))).toEqual({ outcome: 'stale' });
    expect(await t.run(redeem('Ring the Bell', JUNIPER, 'canceled'))).toEqual({ outcome: 'stale' });
    expect(await t.run(redeem('Ring the Bell', JUNIPER, 'unknown'))).toEqual({ outcome: 'stale' });
    expect(bodies(await t.run(redeem('Ring the Bell', JUNIPER)))).toEqual([expect.objectContaining({ kind: 'redemption', mappingKey: 'ring-the-bell', status: 'fulfilled', current: false })]);
  });

  it('carries out a redemption once across different delivery IDs and retries a failed transaction', async () => {
    const t = town();
    const first = redeem('Ring the Bell', JUNIPER, 'unfulfilled', 'same-redemption');
    t.store.failNextCommit();
    await expect(t.run(first)).rejects.toThrow('Simulated commit failure');
    expect(bodies(await t.run(first))).toHaveLength(1);
    expect(await t.run({ ...first, id: 'another-delivery' })).toEqual({ outcome: 'stale' });
  });

  it('keeps a called festival as current state, and plants one tree to a plot', async () => {
    const t = town();
    expect(bodies(await t.run(redeem('Call a Festival', ROWAN)))).toEqual([expect.objectContaining({ key: 'festival', current: true, mappingKey: 'call-a-festival' })]);
    const tree = bodies(await t.run(redeem('Plant a Tree', JUNIPER)));
    expect(tree.map(b => b.kind)).toEqual(['redemption', 'grove']);
    expect(tree[1]).toMatchObject({ plantings: [{ slot: 3, sapling: null, tree: NOW }] });
    expect(await t.run(redeem('Plant a Tree', JUNIPER))).toEqual({ outcome: 'stale' });
    // A reward that needs a home needs one.
    expect(await t.run(redeem('Show My Home', GUEST))).toEqual({ outcome: 'stale' });
  });
});

describe('polls and decrees', () => {
  const poll = (phase: 'begin' | 'progress' | 'end', votes: [number, number, number?], at: number,
    options: { titles?: [string, string, string?]; status?: 'active' | 'completed' | 'terminated' | 'archived' | 'moderated' | 'invalid'; paid?: [number, number, number?] } = {}) => {
    const titles = options.titles ?? ['Ember', 'Tide'];
    return observe({ kind: 'poll', pollId: 'p-1', phase, title: 'Our colours', startedAt: NOW, endsAt: NOW + 120_000,
      status: options.status ?? (phase === 'end' ? 'completed' : 'active'),
      choices: titles.flatMap((title, i) => (title === undefined ? [] : [{ id: `c${i + 1}`, title, votes: votes[i] ?? 0, paidVotes: options.paid?.[i] ?? 0 }])) }, at);
  };

  it('keeps the newest report only, counts one vote per person, and carries out a colours decree', async () => {
    const t = town();
    expect(bodies(await t.run(poll('begin', [0, 0], NOW)))).toEqual([expect.objectContaining({ kind: 'poll', current: true, phase: 'begin' })]);
    expect(bodies(await t.run(poll('progress', [2, 1], NOW + 10_000)))).toHaveLength(1);
    // An older tally arriving late changes nothing.
    expect(await t.run(poll('progress', [1, 1], NOW + 11_000))).toEqual({ outcome: 'stale' });
    // Tide has more votes, but most of them were bought with channel points: one person, one vote.
    const end = bodies(await t.run(poll('end', [3, 6], NOW + 120_000, { paid: [0, 4] })));
    expect(end[0]).toMatchObject({ kind: 'poll', current: false, phase: 'end', winnerId: 'c1', choices: [{ title: 'Ember', votes: 3 }, { title: 'Tide', votes: 2 }] });
    expect(end[1]).toMatchObject({ kind: 'decree', key: 'decree.colours', current: true, choice: 'ember' });
    expect(await t.run(poll('progress', [9, 9], NOW + 130_000))).toEqual({ outcome: 'stale' });
  });

  it('decides nothing on a tie, a moderated poll, or a poll that is not about colours', async () => {
    const tie = town();
    expect(bodies(await tie.run(poll('end', [2, 2], NOW)))).toEqual([expect.objectContaining({ winnerId: null, cancelled: false })]);
    const moderated = town();
    expect(bodies(await moderated.run(poll('end', [5, 1], NOW, { status: 'moderated' })))).toEqual([expect.objectContaining({ winnerId: null, cancelled: true })]);
    const other = town();
    const result = bodies(await other.run(poll('end', [5, 1], NOW, { titles: ['Pizza', 'Tacos'] })));
    expect(result.map(b => b.kind)).toEqual(['poll']);
    expect(result[0]).toMatchObject({ winnerId: 'c1' });
  });

  it('keeps a newer poll and decree when an older poll ends late', async () => {
    const t = town();
    const newer = poll('end', [1, 5], NOW + DAY);
    if (newer.notice.kind !== 'poll') throw new Error('Expected poll');
    const later = { ...newer, notice: { ...newer.notice, pollId: 'new-poll', startedAt: NOW + DAY - 60_000 } };
    expect(bodies(await t.run(later))).toMatchObject([{ kind: 'poll' }, { kind: 'decree', choice: 'tide' }]);
    expect(await t.run(poll('end', [8, 1], NOW + DAY + 1000))).toEqual({ outcome: 'stale' });
    expect(await t.run(poll('progress', [9, 1], NOW + DAY + 2000))).toEqual({ outcome: 'stale' });
  });
});
