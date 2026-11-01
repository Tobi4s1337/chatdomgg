import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import type { TwitchMomentBody, TwitchMomentFact } from './contracts';
import { createTwitchMoments } from './controller';
import { TOWN_BEAT } from './town';

const KINGDOM = KingdomIdSchema.parse('129634568');
const START = Date.UTC(2026, 10, 1, 19, 0);
/** A body as a test writes it: `displayUntil` defaults to a minute after its cause. */
type BodyInput = TwitchMomentBody extends infer B ? B extends TwitchMomentBody ? Omit<B, 'displayUntil'> & { displayUntil?: number } : never : never;

function harness(origin: 'live' | 'simulated' = 'simulated') {
  let now = START, seq = 0;
  const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: origin, clock: { now: () => now } });
  const fact = (body: BodyInput, at = now, recovered = false): TwitchMomentFact => ({
    version: 1, kingdomId: KINGDOM, seq: ++seq, occurredAt: at, receivedAt: at, committedAt: at, origin: recovered ? 'recovered' : origin,
    type: 'twitch.moment', actor: null, body: { displayUntil: at + 60_000, ...body } as TwitchMomentBody, cause: { kind: 'external', source: 'twitch.eventsub', id: `m${seq}` },
  });
  return {
    moments, fact,
    reset(current: TwitchMomentFact[] = []) { expect(moments.reset({ epoch: 'e1', asOf: now, throughSeq: seq, current })).toEqual({ accepted: true }); },
    send(body: BodyInput) { const f = fact(body); expect(moments.receiveFact('e1', f)).toEqual({ accepted: true }); return f; },
    at(ms: number) { now = ms; return moments.sample(ms); },
    get now() { return now; },
  };
}

const juniper = { displayName: 'Juniper', slot: 3 };

describe('the town shaped by its channel', () => {
  it('retains only the running poll and releases its current state when it ends', () => {
    const h = harness();
    h.reset();
    const choices = [{ id: 'c1', title: 'Ember', votes: 2 }, { id: 'c2', title: 'Tide', votes: 1 }];
    for (let i = 0; i < 6; i++) {
      h.send({ kind: 'poll', key: `poll.${i}`, pollKey: `poll.${i}`, phase: 'begin', title: 'Our colours', choices,
        endsAt: START + 60_000, winnerId: null, cancelled: false });
      expect(h.moments.currentFacts().filter(f => f.body.kind === 'poll')).toHaveLength(1);
      h.send({ kind: 'poll', key: `poll.${i}`, pollKey: `poll.${i}`, phase: 'end', title: 'Our colours', choices,
        endsAt: START + 60_000, winnerId: 'c1', cancelled: false });
      expect(h.moments.currentFacts().filter(f => f.body.kind === 'poll')).toHaveLength(0);
    }
  });

  it('plants a follower sapling by their new door, names it, and keeps it standing after a reload', () => {
    const h = harness();
    h.reset();
    h.send({ kind: 'follow', key: 'follow.1', credit: juniper, returning: false, homeSlot: 3 });
    h.send({ kind: 'grove', key: 'grove', plantings: [{ slot: 3, sapling: START, tree: null }] });
    const early = h.at(START + 200);
    expect(early.town.plantings[0]).toMatchObject({ slot: 3, kind: 'sapling', name: 'Juniper' });
    expect(early.town.plantings[0]!.grow).toBe(0);
    const grown = h.at(START + TOWN_BEAT.sapling.sprout[1] + 10);
    expect(grown.town.plantings[0]!.grow).toBe(1);
    expect(grown.captions.find(c => c.title === 'Juniper')?.line).toBe('follows · a new home on the edge of town');
    expect(grown.focus?.subject).toEqual({ kind: 'home', slot: 3 });
    expect(grown.audio.map(a => a.cue)).toContain('gift-bell');

    // After a reload only the grove stands: no beat, no caption, the sapling fully grown.
    const again = harness();
    again.reset([again.fact({ kind: 'grove', key: 'grove', plantings: [{ slot: 3, sapling: START, tree: START + 5 }] }, START, true)]);
    const restored = again.at(START + 1000);
    expect(restored.town.plantings.map(p => [p.kind, p.grow, p.t])).toEqual([['sapling', 1, null], ['tree', 1, null]]);
    expect(restored.captions).toEqual([]);
    expect(restored.focus).toBeNull();
  });

  it('never names or stages a quiet follower', () => {
    const h = harness();
    h.reset();
    h.send({ kind: 'follow', key: 'follow.2', credit: null, returning: false, homeSlot: null });
    const frame = h.at(START + 3000);
    expect(frame.captions).toEqual([]);
    expect(frame.focus).toBeNull();
  });

  it('opens the gate for the night, then welcomes a returning citizen home with the relight', () => {
    const h = harness();
    h.reset();
    h.send({ kind: 'night', key: 'night', nightKey: 'night.4', phase: 'open', number: 4, openedAt: START });
    h.send({ kind: 'homecoming', key: 'home.4.3', credit: juniper, nightKey: 'night.4', awayDays: 23 });
    const opening = h.at(START + 100);
    expect(opening.town.gate).toMatchObject({ number: 4, braziers: 0, standard: 0 });
    const lit = h.at(START + TOWN_BEAT.gate.beacon[1] + 10);
    expect(lit.town.gate).toMatchObject({ braziers: 1, standard: 1, beacon: 1 });
    expect(lit.captions[0]).toMatchObject({ title: 'The gate opens', line: 'Night 4 · welcome home, everyone' });
    expect(lit.focus?.subject).toEqual({ kind: 'place', place: 'gate' });
    // The relight waits its turn behind the gate, then has the stage at the citizen's own home.
    const relightAt = h.at(START + 9000 + TOWN_BEAT.relight.flare[1]);
    expect(relightAt.town.relights).toEqual([expect.objectContaining({ slot: 3 })]);
    expect(relightAt.captions.find(c => c.at.kind === 'home')).toMatchObject({ title: 'Welcome back, Juniper', line: 'home after 23 days away' });
    // The night rests when the stream ends: the gate closes, no beat.
    h.send({ kind: 'night', key: 'night', nightKey: 'night.4', phase: 'rest', number: 4, openedAt: START });
    expect(h.at(h.now + 60_000).town.gate).toBeNull();
  });

  it('restores an open night as a standing gate in the decreed colours', () => {
    const h = harness();
    h.reset([
      h.fact({ kind: 'night', key: 'night', nightKey: 'night.2', phase: 'open', number: 2, openedAt: START - 3_600_000 }, START - 3_600_000, true),
      h.fact({ kind: 'decree', key: 'decree.colours', subject: 'colours', choice: 'tide', title: 'Our colours', pollKey: 'poll.p1' }, START - 86_400_000, true),
    ]);
    const frame = h.at(START + 10);
    expect(frame.town.gate).toEqual({ number: 2, colour: 'tide', t: null, braziers: 1, standard: 1, beacon: 1 });
    expect(frame.town.colour).toBe('tide');
    expect(frame.captions).toEqual([]);
  });

  it('raises the decree board, climbs each pennant to its share, and carries out the colours the town chose', () => {
    const h = harness();
    h.reset();
    const choices = (ember: number, tide: number) => [{ id: 'c1', title: 'Ember', votes: ember }, { id: 'c2', title: 'Tide', votes: tide }];
    h.send({ kind: 'poll', key: 'poll.p1', pollKey: 'poll.p1', phase: 'begin', title: 'Our colours', choices: choices(0, 0), endsAt: START + 120_000, winnerId: null, cancelled: false });
    const risen = h.at(START + TOWN_BEAT.board.rise[1] + 10);
    expect(risen.town.board).toMatchObject({ title: 'Our colours', phase: 'open', decree: true, raised: 1 });
    expect(risen.town.board!.choices.map(c => c.colour)).toEqual(['ember', 'tide']);

    h.at(START + 20_000);
    h.send({ kind: 'poll', key: 'poll.p1', pollKey: 'poll.p1', phase: 'progress', title: 'Our colours', choices: choices(1, 3), endsAt: START + 120_000, winnerId: null, cancelled: false });
    const climbing = h.at(START + 20_000 + TOWN_BEAT.board.climb / 2);
    const share = climbing.town.board!.choices[1]!.share;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.75);
    expect(h.at(START + 20_000 + TOWN_BEAT.board.climb).town.board!.choices[1]!.share).toBeCloseTo(0.75);
    expect(h.at(START + 30_000).captions.find(c => c.id.startsWith('board.'))?.detail).toBe('4 voices · Tide leads');

    h.at(START + 120_000);
    h.send({ kind: 'poll', key: 'poll.p1', pollKey: 'poll.p1', phase: 'end', title: 'Our colours', choices: choices(1, 3), endsAt: START + 120_000, winnerId: 'c2', cancelled: false });
    h.send({ kind: 'decree', key: 'decree.colours', subject: 'colours', choice: 'tide', title: 'Our colours', pollKey: 'poll.p1' });
    const decided = h.at(START + 120_000 + TOWN_BEAT.board.decide[1] + 10);
    expect(decided.town.board).toMatchObject({ phase: 'decided' });
    expect(decided.town.board!.choices.find(c => c.winner)?.title).toBe('Tide');
    expect(decided.captions.find(c => c.at.kind === 'place')?.line).toBe('The town chose Tide');
    // Until the decree's own beat, the town still flies gold; then the wave runs tide out across it.
    expect(decided.town.colour).toBe('gold');
    const waveAt = firstAt(decided.atMs, decided.atMs + 20_000, at => h.at(at).town.colourChange !== null);
    expect(h.at(waveAt).town.colourChange).toMatchObject({ from: 'gold', to: 'tide' });
    expect(h.at(waveAt + TOWN_BEAT.colours.wave[1]).town).toMatchObject({ colour: 'tide', colourChange: null });
    // The board is lowered after its hold.
    expect(h.at(START + 120_000 + 60_000 + TOWN_BEAT.board.lower[1]).town.board).toBeNull();
  });

  it('tells a tie for what it is, and changes nothing', () => {
    const h = harness();
    h.reset();
    const choices = [{ id: 'c1', title: 'Ember', votes: 2 }, { id: 'c2', title: 'Tide', votes: 2 }];
    h.send({ kind: 'poll', key: 'poll.p2', pollKey: 'poll.p2', phase: 'end', title: 'Our colours', choices, endsAt: START, winnerId: null, cancelled: false });
    const frame = h.at(START + TOWN_BEAT.board.decide[1] + 10);
    expect(frame.captions[0]).toMatchObject({ line: 'the town is divided', detail: 'nothing changes' });
    expect(frame.town.colour).toBe('gold');
  });

  it('plays the kingdom rewards: the bell, a festival that dresses the town for ten minutes, a planted tree', () => {
    const h = harness();
    h.reset();
    h.send({ kind: 'redemption', key: 'reward.r1', redemptionKey: 'reward.r1', credit: juniper, mappingKey: 'ring-the-bell', status: 'fulfilled' });
    const ringing = h.at(START + TOWN_BEAT.bell.strokes[1]);
    expect(ringing.town.bell).toMatchObject({ t: TOWN_BEAT.bell.strokes[1] });
    expect(ringing.audio.filter(a => a.cue === 'wyrm-bell')).toHaveLength(3);
    expect(ringing.captions[0]).toMatchObject({ title: 'Juniper', line: 'rings the castle bell' });

    h.at(START + 10_000);
    h.send({ kind: 'redemption', key: 'festival', redemptionKey: 'reward.r2', credit: juniper, mappingKey: 'call-a-festival', status: 'fulfilled' });
    const dressed = h.at(START + 10_000 + TOWN_BEAT.festival.dress[1] + 10);
    expect(dressed.town.festival).toMatchObject({ dressed: 1, colour: 'gold' });
    expect(h.at(START + 10_000 + TOWN_BEAT.festival.length + 10).town.festival).toBeNull();

    h.send({ kind: 'redemption', key: 'reward.r3', redemptionKey: 'reward.r3', credit: juniper, mappingKey: 'plant-a-tree', status: 'fulfilled' });
    h.send({ kind: 'grove', key: 'grove', plantings: [{ slot: 3, sapling: null, tree: h.now }] });
    const growing = h.at(h.now + TOWN_BEAT.tree.grow[0] + 200);
    expect(growing.town.plantings[0]).toMatchObject({ kind: 'tree', name: 'Juniper' });
    expect(growing.town.plantings[0]!.grow).toBeGreaterThan(0);
    expect(growing.town.plantings[0]!.grow).toBeLessThan(1);
  });

  it('draws nothing of the town when the presentation is hidden', () => {
    const h = harness();
    h.reset([h.fact({ kind: 'grove', key: 'grove', plantings: [{ slot: 3, sapling: START, tree: null }] }, START, true)]);
    expect(h.moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: false, safeRects: [], autoOpenKinds: [] })).toBe(true);
    expect(h.at(START + 10).town.plantings).toEqual([]);
  });
});

function firstAt(from: number, until: number, test: (at: number) => boolean): number {
  for (let at = from; at <= until; at += 50) if (test(at)) return at;
  throw new Error('The awaited moment never came');
}
