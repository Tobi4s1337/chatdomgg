import { describe, expect, it } from 'vitest';
import { CAMPFIRE_MESSAGES, CampfireFrameSchema, CampfireSelfSchema, DUSK_COURT, type CampfireFrame, type CampfireSelf } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import { CampfireFire, type FireRoomPort } from './fire';
import { MemoryFireStore } from './store';

const KINGDOM = '777000001';
const T0 = Date.UTC(2026, 10, 2, 21, 0, 0);
const people = Array.from({ length: 6 }, (_, i) => ({ person: String(880000 + i), name: `Sitter ${i + 1}` }));

function harness(store = new MemoryFireStore(), clock = { now: T0 }) {
  const fire = new CampfireFire({ kingdomId: KINGDOM, store, clock: () => clock.now, tickMs: 0, seed: () => 12345 });
  const handlers = new Map<string, (principal: RealmPrincipal, raw: unknown) => void>();
  const sent: { to: string | null; type: string; message: unknown }[] = [];
  const names = new Map<string, string>([...people.map(p => [p.person, p.name] as const), [KINGDOM, 'The Streamer']]);
  const port: FireRoomPort = {
    on: (type, handler) => { handlers.set(type, handler); },
    send: (to, type, message) => { sent.push({ to, type, message: structuredClone(message) }); },
    broadcast: (type, message) => { sent.push({ to: null, type, message: structuredClone(message) }); },
    nameOf: person => names.get(person) ?? null,
  };
  const detach = fire.attachRoom(port);
  const principal = (person: string): RealmPrincipal => ({ personId: person as RealmPrincipal['personId'], kingdomId: KINGDOM as RealmPrincipal['kingdomId'],
    sessionId: `s-${person}`, expiresAt: T0 + 3_600_000, origin: 'simulated', publicName: names.get(person) ?? 'x', look: 'reference' });
  let generation = 0;
  const sit = async (person: string, seat: number) => {
    const answer = await fire.seats.admit!({ site: 'clearing', seat, personId: person as RealmPrincipal['personId'], signal: new AbortController().signal });
    if (answer.admitted) answer.seated?.({ targetId: `fire:clearing:seat:${seat}`, generation: ++generation });
    await fire.tick();
    return answer.admitted ? generation : null;
  };
  const stand = async (person: string, seat: number, held: number) => {
    fire.seats.released!({ place: { site: 'clearing', seat }, personId: person as RealmPrincipal['personId'], sessionId: `s-${person}`, generation: held }, 'stand');
    await fire.tick();
  };
  const frames = () => sent.filter(s => s.to === null && s.type === CAMPFIRE_MESSAGES.frame).map(s => s.message as CampfireFrame);
  const selves = (person: string) => sent.filter(s => s.to === person && s.type === CAMPFIRE_MESSAGES.self).map(s => s.message as CampfireSelf);
  return { fire, store, clock, handlers, sent, principal, sit, stand, frames, selves, detach };
}

describe('the kingdom fire', () => {
  it('keeps the Magistrate’s chair for the streamer and a running round’s logs for its players', async () => {
    const h = harness();
    expect(await h.sit(people[0]!.person, 0)).toBeNull();
    expect(await h.sit(KINGDOM, 0)).not.toBeNull();
    for (const [i, p] of people.slice(0, 4).entries()) await h.sit(p.person, i + 1);
    expect(h.fire.self(people[0]!.person).canAsk).toBe(true);
    // Offline, the streamer in the chair is not the Magistrate and cannot call a round from there.
    expect(h.fire.self(KINGDOM)).toMatchObject({ seat: 0, magistrate: false, canAsk: false });
    expect(await h.fire.act(h.principal(people[1]!.person), { action: 'ask', id: 'ask-1' })).toBe(true);
    h.clock.now += DUSK_COURT.callMs; await h.fire.tick();
    expect(h.fire.frame().court?.phase).toBe('deal');
    // Someone else may not take a player's log, nor may a player move to another log.
    expect(await h.sit(people[4]!.person, 2)).toBeNull();
    expect(await h.sit(people[0]!.person, 7)).toBeNull();
    expect(await h.sit(people[4]!.person, 7)).not.toBeNull();
  });

  it('sends each card only to its own seat and never into a frame', async () => {
    const h = harness();
    const held = new Map<string, number>();
    for (const [i, p] of people.entries()) held.set(p.person, (await h.sit(p.person, i + 1))!);
    await h.fire.act(h.principal(people[0]!.person), { action: 'ask', id: 'ask-1' });
    for (let i = 0; i < 400; i++) {
      const frame = h.fire.frame(), court = frame.court;
      if (court?.result) break;
      for (const p of people) {
        const self = h.fire.self(p.person);
        if (self.choice?.targets.length && court) await h.fire.act(h.principal(p.person), { action: 'choose', id: `c-${i}-${p.person}`, match: court.match, seat: self.choice.targets[i % self.choice.targets.length]! });
      }
      h.clock.now = Math.max(h.clock.now + 1000, court?.deadline ?? h.clock.now); await h.fire.tick();
    }
    expect(h.fire.frame().court?.result).not.toBeNull();
    const roles = new Map(people.map(p => [p.person, h.selves(p.person).map(s => s.role).find(Boolean)]));
    expect([...roles.values()].every(Boolean)).toBe(true);
    for (const frame of h.frames()) {
      CampfireFrameSchema.parse(frame);
      if (frame.court && frame.court.phase !== 'ended') for (const p of frame.court.players) if (p.lantern === 'lit') expect(p.role).toBeNull();
    }
    for (const { to, type, message } of h.sent) {
      if (type !== CAMPFIRE_MESSAGES.self) continue;
      const self = CampfireSelfSchema.parse(message);
      // A self view carries only its own person's card.
      if (self.role) expect(self.role).toBe(roles.get(to!));
      if (self.answers.length) expect(roles.get(to!)).toBe('watchman');
      if (self.wolves.length) expect(roles.get(to!)).toBe('wolf');
    }
  });

  it('publishes nothing it could not save, and resumes the same phase and clock after a restart', async () => {
    const store = new MemoryFireStore(), clock = { now: T0 };
    const h = harness(store, clock);
    for (const [i, p] of people.slice(0, 5).entries()) await h.sit(p.person, i + 1);
    store.failNext = true;
    const before = h.sent.length;
    expect(await h.fire.act(h.principal(people[0]!.person), { action: 'ask', id: 'ask-1' })).toBe(false);
    expect(h.sent.slice(before).filter(s => s.type === CAMPFIRE_MESSAGES.frame && (s.message as CampfireFrame).court)).toHaveLength(0);
    expect(await h.fire.act(h.principal(people[0]!.person), { action: 'ask', id: 'ask-2' })).toBe(true);
    clock.now += DUSK_COURT.callMs + DUSK_COURT.dealMs + 4000; await h.fire.tick();
    const running = h.fire.frame().court!;
    expect(running.phase).toBe('night');
    h.detach(); h.fire.dispose();

    // The realm restarts a few seconds later: a new fire reads the same checkpoint.
    clock.now += 3000;
    const again = harness(store, clock);
    await again.fire.restore();
    expect(again.fire.frame().court).toMatchObject({ match: running.match, phase: 'night', deadline: running.deadline, night: 1 });
    // Nobody is on a log yet: they are away, and their places wait for them.
    await again.fire.tick();
    expect(again.fire.frame().court!.players.every(p => p.away)).toBe(true);
    for (const [i, p] of people.slice(0, 5).entries()) await again.sit(p.person, i + 1);
    expect(again.fire.frame().court!.players.every(p => !p.away)).toBe(true);
  });

  it('counts `!sus` once per Twitch identity per day and takes it back on cleanup', async () => {
    const h = harness();
    for (const [i, p] of people.slice(0, 4).entries()) await h.sit(p.person, i + 1);
    await h.fire.act(h.principal(people[0]!.person), { action: 'ask', id: 'ask-1' });
    for (let i = 0; i < 10 && h.fire.frame().court?.phase !== 'talk'; i++) { h.clock.now = h.fire.frame().court!.deadline; await h.fire.tick(); }
    const target = h.fire.frame().court!.players.find(p => p.lantern === 'lit')!;
    const line = (messageId: string, twitchId: string) => ({ kind: 'command' as const, kingdomId: KINGDOM as never, messageId, at: h.clock.now,
      chatter: { twitchId: twitchId as never, login: `viewer${twitchId}`, displayName: `Viewer${twitchId}` }, command: 'sus' as const, arg: target.name });
    expect(await h.fire.chat(line('m1', '501'))).toBe('counted');
    expect(await h.fire.chat(line('m1', '501'))).toBe('ignored');
    expect(await h.fire.chat(line('m2', '501'))).toBe('ignored');
    expect(await h.fire.chat(line('m3', '502'))).toBe('counted');
    expect(h.fire.frame().court!.players.find(p => p.seat === target.seat)?.embers).toBe(3);
    await h.fire.chat({ kind: 'cleanup', kingdomId: KINGDOM as never, twitchId: '501' as never, at: h.clock.now });
    await h.fire.chat({ kind: 'cleanup', kingdomId: KINGDOM as never, twitchId: '502' as never, at: h.clock.now });
    expect(h.fire.frame().court!.players.find(p => p.seat === target.seat)?.embers).toBe(0);
  });

  it('lets a live streamer in the chair call a round and the phases', async () => {
    const h = harness();
    let live = false;
    h.fire.bindLive(() => live);
    await h.sit(KINGDOM, 0);
    for (const [i, p] of people.slice(0, 4).entries()) await h.sit(p.person, i + 1);
    expect(h.fire.self(KINGDOM).canAsk).toBe(false);
    live = true; await h.fire.tick();
    expect(h.fire.frame().magistrate).toBe('The Streamer');
    expect(h.fire.self(KINGDOM)).toMatchObject({ magistrate: true, canAsk: true });
    await h.fire.act(h.principal(KINGDOM), { action: 'ask', id: 'ask-m' });
    for (let i = 0; i < 10 && h.fire.frame().court?.phase !== 'talk'; i++) {
      const court = h.fire.frame().court!;
      if (court.waiting) await h.fire.act(h.principal(KINGDOM), { action: 'call', id: `call-${i}`, match: court.match });
      else { h.clock.now = court.deadline; await h.fire.tick(); }
    }
    const court = h.fire.frame().court!;
    expect(court.phase).toBe('talk');
    expect(h.fire.self(KINGDOM).canCall).toBe(true);
    // A player is not the Magistrate.
    expect(await h.fire.act(h.principal(people[0]!.person), { action: 'call', id: 'call-p', match: court.match })).toBe(false);
    expect(await h.fire.act(h.principal(KINGDOM), { action: 'call', id: 'call-t', match: court.match })).toBe(true);
    expect(h.fire.frame().court?.phase).toBe('ballot');
  });
});
