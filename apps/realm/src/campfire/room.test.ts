import { Client, type Room } from '@colyseus/sdk';
import { CAMPFIRE_MESSAGES, CampfireFrameSchema, CampfireSelfSchema, type CampfireFrame, type CampfireSelf, type Vec3 } from '@chatdom/shared';
import { KingdomRoomState, type RealmPrivateMessage } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createGrowthState } from '@chatdom/world/growth';
import { createRealmState } from '@chatdom/world/realm';
import { createFoundedInteractionRegistry } from '@chatdom/world/interactions';
import { expect, it } from 'vitest';
import { assembleFoundedScene, compileFoundedScene, createNativeTown } from '../founded';
import { REFERENCE_KINGDOM } from '../reference';
import { createRealmServer } from '../server';
import { listenForTest } from '../games/test-socket';
import { campfireReference } from './reference';

type Kingdom = Room<InstanceType<typeof KingdomRoomState>>;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, what: string, timeout = 8_000) {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`); await delay(20); }
}

async function foundedClearing(seed: string) {
  const plan = generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const state = { ...createRealmState(REFERENCE_KINGDOM, 'simulated'), growth: createGrowthState(REFERENCE_KINGDOM, 'simulated') };
  const { scene } = await assembleFoundedScene({ kingdomId: REFERENCE_KINGDOM, plan, native: createNativeTown(plan), state, collisionRevision: 7 });
  const world = compileFoundedScene(scene), registry = createFoundedInteractionRegistry(scene, world);
  const logs = registry.records.filter(record => record.target.kind === 'campfire-seat').map(record => record.target)
    .sort((a, b) => Number(a.id.split(':').at(-1)) - Number(b.id.split(':').at(-1)));
  return { scene, world, logs };
}

/** One person on the far side of a socket: what they were sent, kept as sent. */
function listen(room: Kingdom) {
  const frames: CampfireFrame[] = [], selves: CampfireSelf[] = [], receipts = new Map<string, unknown>(), acts = new Map<string, boolean>();
  room.onMessage(CAMPFIRE_MESSAGES.frame, raw => { frames.push(CampfireFrameSchema.parse(raw)); });
  room.onMessage(CAMPFIRE_MESSAGES.self, raw => { selves.push(CampfireSelfSchema.parse(raw)); });
  room.onMessage(CAMPFIRE_MESSAGES.receipt, (raw: { id: string; accepted: boolean }) => { acts.set(raw.id, raw.accepted); });
  room.onMessage('private', (raw: RealmPrivateMessage) => { if (raw.type === 'receipt') receipts.set(raw.receipt.id, raw.receipt.status); });
  for (const type of ['transient', 'world', 'bootstrap', 'revision']) room.onMessage(type, () => {});
  room.send('bootstrap'); room.send(CAMPFIRE_MESSAGES.hello);
  return { room, frames, selves, receipts, acts, self: () => selves.at(-1), frame: () => frames.at(-1) };
}

it('plays a whole round of Dusk Court over real sockets on the founded clearing, and no card leaves its seat', async () => {
  const { scene, world, logs } = await foundedClearing('tobi4s_');
  expect(logs.map(log => log.id)).toEqual(Array.from({ length: 11 }, (_, i) => `fire:clearing:seat:${i}`));
  // Real time for the sockets, a skewed clock for the fire so the round's minutes pass in seconds.
  let skew = 0, live = true;
  const clock = () => Date.now() + skew;
  const reference = campfireReference({ scene, world, clock, live: () => live, tickMs: 0, spawn: index => [...logs[index % logs.length]!.approach] as Vec3 });
  const created = createRealmServer(reference.services), url = await listenForTest(created), client = new Client(url), people: ReturnType<typeof listen>[] = [];
  const fire = reference.campfires.fire(REFERENCE_KINGDOM);
  try {
    const join = async (person?: { personId: string; name: string }) => {
      const room = await client.joinOrCreate<InstanceType<typeof KingdomRoomState>>('kingdom', reference.issue(person), KingdomRoomState);
      room.reconnection.enabled = false; const listener = listen(room); people.push(listener); return listener;
    };
    // The streamer joins first and takes the Magistrate's chair; five visitors take logs one to five.
    const streamer = await join({ personId: REFERENCE_KINGDOM, name: 'tobi4s_' });
    for (let i = 0; i < 5; i++) await join();
    await waitFor(() => people.every(p => p.frame() && p.self()), 'every first frame and self view');
    let intents = 0;
    const sit = async (person: ReturnType<typeof listen>, seat: number) => {
      const id = `sit-${++intents}`;
      person.room.send('intent', { version: 1, type: 'interact', id, targetId: `fire:clearing:seat:${seat}`, action: 'sit' });
      await waitFor(() => person.receipts.has(id), `receipt ${id}`);
      return person.receipts.get(id);
    };
    // A visitor cannot take the Magistrate's chair; the streamer can.
    expect(await sit(people[1]!, 0)).not.toBe('applied');
    expect(await sit(streamer, 0)).toBe('applied');
    for (let i = 1; i <= 5; i++) expect(await sit(people[i]!, i)).toBe('applied');
    await fire.tick();
    await waitFor(() => streamer.self()?.magistrate === true && people.every(p => p.frame()?.seated.length === 6), 'six on the logs');
    expect(streamer.frame()?.magistrate).toBe('tobi4s_');

    let acts = 0;
    const act = async (person: ReturnType<typeof listen>, body: Record<string, unknown>) => {
      const id = `act-${++acts}`;
      person.room.send(CAMPFIRE_MESSAGES.act, { ...body, id });
      await waitFor(() => person.acts.has(id), `act ${id}`);
      return person.acts.get(id);
    };
    expect(await act(people[2]!, { action: 'ask' })).toBe(true);
    const players = people.slice(1);
    for (let step = 0; step < 300; step++) {
      await waitFor(() => !!streamer.frame()?.court, 'a court');
      const court = streamer.frame()!.court!;
      if (court.result) break;
      for (const [i, person] of players.entries()) {
        const self = person.self(), choice = self?.choice;
        if (choice && !choice.chosen && choice.targets.length && self.match) await act(person, { action: 'choose', match: self.match, seat: choice.targets[(step + i) % choice.targets.length]! });
      }
      const called = (court.waiting || court.phase === 'talk') && await act(streamer, { action: 'call', match: court.match });
      if (!called) { skew += Math.max(0, court.deadline - clock()); await fire.tick(); }
      const revision = court.revision;
      await waitFor(() => (streamer.frame()?.court?.revision ?? 0) !== revision || !!streamer.frame()?.court?.result, 'the next public change').catch(() => {});
    }
    const ended = streamer.frame()!.court!;
    expect(ended.phase).toBe('ended');
    expect(ended.result).not.toBeNull();
    // Every card the server dealt went to its own seat and nowhere else.
    const roles = new Map(players.map(person => [person.room.sessionId, person.selves.map(self => self.role).find(Boolean) ?? null]));
    expect([...roles.values()].every(Boolean)).toBe(true);
    for (const person of people) {
      for (const frame of person.frames) if (frame.court && frame.court.phase !== 'ended') for (const p of frame.court.players) if (p.lantern === 'lit') expect(p.role).toBeNull();
      const own = roles.get(person.room.sessionId) ?? null;
      for (const self of person.selves) {
        if (self.role) expect(self.role).toBe(own);
        if (self.wolves.length) expect(own).toBe('wolf');
        if (self.answers.length) expect(own).toBe('watchman');
      }
    }
    expect(streamer.selves.every(self => self.role === null && self.wolves.length === 0 && self.answers.length === 0)).toBe(true);
    // The end shows every card, to everyone.
    expect(ended.players.every(p => p.role !== null)).toBe(true);
    live = false;
  } finally {
    for (const person of people) await person.room.leave().catch(() => {});
    await created.server.gracefullyShutdown(false).catch(() => {});
    reference.campfires.dispose();
  }
}, 60_000);
