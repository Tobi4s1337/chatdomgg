import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { attachRealmRoomChannels, type RealmChannelClient, type RealmChannelHost, type RealmChannelPose, type RealmChannelRoom, type RealmChannelSender, type RealmRoomChannel } from '../room-channels';

const kingdomId = KingdomIdSchema.parse('129634568');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function setup(rate = 8, handler: (from: RealmChannelSender, raw: unknown) => void | Promise<void> = () => {}) {
  let at = 1000, active = true, world = REFERENCE_WORLD;
  const clients = new Map<string, RealmChannelClient>(), seats = new Map<string, string>(), held = new Set<string>();
  const listeners = new Map<string, (client: RealmChannelClient, raw: unknown) => void>();
  const current = vi.fn(async () => true), ended = vi.fn((id: string) => { held.add(id); });
  const pose = vi.fn((): RealmChannelPose => ({ position: [0, 0, 7], yaw: 0, grounded: true, collisionRevision: world.revision }));
  const host: RealmChannelHost = { kingdomId, origin: 'simulated', auth: { current }, now: () => at, active: () => active,
    receive(type, listener) { listeners.set(type, listener); return () => { listeners.delete(type); }; },
    clients: () => clients.values(), client: id => clients.get(id), seat: person => seats.get(person), held: id => held.has(id),
    pose, world: () => world, end: ended,
  };
  const add = (person: string, id = `walker-${person}`) => {
    const client = { sessionId: id, auth: { personId: PersonIdSchema.parse(person), kingdomId, origin: 'simulated' as const,
      sessionId: `session-${id}`, expiresAt: 100_000, publicName: 'A fisher', look: 'reference' }, send: vi.fn(), leave: vi.fn() };
    clients.set(id, client); seats.set(person, id); return client;
  };
  let room!: RealmChannelRoom;
  const detach = vi.fn();
  const channel: RealmRoomChannel = { type: 'pier', rate, attach(value) { room = value; value.onMessage(handler); return detach; } };
  const binding = attachRealmRoomChannels([channel], host);
  return { host, channel, binding, clients, seats, held, current, ended, pose, detach, add,
    room: () => room, stats: () => binding.counts.get('pier')!, send: (client: RealmChannelClient, raw: unknown = {}) => listeners.get('pier')?.(client, raw),
    time: (value: number) => { at = value; }, close: () => { active = false; }, world: () => { world = { ...world, revision: world.revision + 1 }; }, listeners,
  };
}

describe('room feature channels', () => {
  it('uses server identity and the latest pose after asynchronous admission', async () => {
    const gate = deferred(), received: unknown[] = [];
    const test = setup(8, (from, raw) => { received.push([from.principal.personId, from.walkerId, from.pose(), raw]); });
    try {
      const client = test.add('100');
      test.current.mockImplementation(async () => { await gate.promise; return true; });
      test.send(client, { ownerId: '999', position: [90, 9, 90] });
      test.pose.mockReturnValue({ position: [1, 0, 8], yaw: 0, grounded: true, collisionRevision: 1 });
      expect(received).toHaveLength(0);
      gate.resolve(); await flush();
      expect(received).toEqual([['100', 'walker-100', { position: [1, 0, 8], yaw: 0, grounded: true, collisionRevision: 1 }, { ownerId: '999', position: [90, 9, 90] }]]);
      test.world(); expect(test.room().world().revision).toBe(2);
    } finally { gate.resolve(); test.binding.dispose(); }
  });

  it('bounds real work across rate windows and replacement tabs, counting every drop', async () => {
    const gate = deferred(), run = vi.fn(async () => { await gate.promise; });
    const test = setup(3, run);
    try {
      const first = test.add('100');
      test.send(first); await flush();
      test.send(first);
      const replacement = test.add('100', 'new-window');
      test.send(replacement); test.send(replacement);
      expect(test.stats()).toMatchObject({ delivered: 1, busyDropped: 2, rateDropped: 1 });
      test.time(2000); test.send(replacement);
      expect(test.stats().busyDropped).toBe(3);
      expect(run).toHaveBeenCalledTimes(1);
      gate.resolve(); await flush(); test.send(replacement); await flush();
      expect(run).toHaveBeenCalledTimes(2);
      expect(test.current).toHaveBeenCalledTimes(2);
    } finally { gate.resolve(); test.binding.dispose(); }
  });

  it('rechecks seats, room authority and expiry after auth answers, without ending a replacement seat', async () => {
    for (const change of ['replace', 'close', 'expire', 'hold', 'remove'] as const) {
      const gate = deferred(), run = vi.fn(), test = setup(8, run);
      try {
        const client = test.add('100');
        test.current.mockImplementation(async () => { await gate.promise; return true; });
        test.send(client);
        if (change === 'replace') test.add('100', 'replacement');
        if (change === 'close') test.close();
        if (change === 'expire') test.time(100_000);
        if (change === 'hold') test.held.add(client.sessionId);
        if (change === 'remove') test.clients.delete(client.sessionId);
        gate.resolve(); await flush();
        expect(run, change).not.toHaveBeenCalled();
        expect(test.stats().authRefused, change).toBe(1);
        expect(test.ended, change).not.toHaveBeenCalled();
      } finally { gate.resolve(); test.binding.dispose(); }
    }
    const test = setup(8, vi.fn());
    try {
      const client = test.add('100'); test.current.mockResolvedValue(false); test.send(client); await flush();
      expect(test.ended).toHaveBeenCalledWith(client.sessionId, 'session-ended');
      expect(test.stats().delivered).toBe(0);
    } finally { test.binding.dispose(); }
  });

  it('routes private and public data only to connected, current, unheld seats in this room', async () => {
    const test = setup();
    try {
      const old = test.add('100'), current = test.add('100', 'replacement'), other = test.add('101'), paused = test.add('102');
      const wrongOrigin = test.add('103'), wrongKingdom = test.add('104');
      Object.assign(wrongOrigin.auth, { origin: 'live' }); Object.assign(wrongKingdom.auth, { kingdomId: '200' });
      test.held.add(paused.sessionId);
      test.room().toPerson(PersonIdSchema.parse('100'), { private: true });
      expect(current.send).toHaveBeenCalledWith('pier', { private: true });
      expect(old.send).not.toHaveBeenCalled(); expect(other.send).not.toHaveBeenCalled();
      test.room().broadcast({ public: true });
      expect(current.send).toHaveBeenCalledWith('pier', { public: true });
      expect(other.send).toHaveBeenCalledWith('pier', { public: true });
      for (const client of [old, paused, wrongOrigin, wrongKingdom]) expect(client.send).not.toHaveBeenCalled();
      test.time(100_000); test.room().broadcast({ expired: true });
      expect(current.send).toHaveBeenCalledTimes(2);
    } finally { test.binding.dispose(); }
  });

  it('disposes every callback and closes retained send/current/world capabilities', async () => {
    let sender!: RealmChannelSender;
    const gate = deferred(), test = setup(8, async from => { sender = from; await gate.promise; test.room().broadcast('late'); });
    const client = test.add('100');
    test.send(client); await flush(); test.binding.dispose(); test.binding.dispose();
    expect(test.listeners.size).toBe(0); expect(test.detach).toHaveBeenCalledTimes(1);
    expect(sender.pose()).toBeNull(); expect(await sender.current()).toBe(false);
    expect(() => test.room().world()).toThrow('ended');
    test.room().toPerson(client.auth.personId, 'late');
    gate.resolve(); await flush(); expect(client.send).not.toHaveBeenCalled();
  });

  it('contains rejected auth and handlers, keeping a slot until the actual work settles', async () => {
    const run = vi.fn(async () => { throw new Error('private storage details'); }), test = setup(8, run);
    try {
      const client = test.add('100'); test.current.mockRejectedValueOnce(new Error('private auth details'));
      test.send(client); await flush(); expect(run).not.toHaveBeenCalled();
      expect(test.ended).toHaveBeenCalledWith(client.sessionId, 'unavailable');
      test.send(test.add('100', 'fresh-entry')); await flush(); expect(run).toHaveBeenCalledTimes(1);
      expect(test.stats()).toMatchObject({ failed: 2, delivered: 1 });
      expect(client.send).not.toHaveBeenCalled();
    } finally { test.binding.dispose(); }
  });

  it('validates the whole registration before attaching and unwinds a partially attached set', () => {
    const test = setup(), attach = vi.fn((room: RealmChannelRoom) => { room.onMessage(() => {}); return () => {}; });
    try {
      for (const channels of [
        [{ type: 'intent', rate: 1, attach }], [{ type: '*', rate: 1, attach }], [{ type: 'new', rate: 0, attach }],
        [{ type: 'new', rate: 61, attach }], [{ type: 'new', rate: 1.5, attach }],
        [{ type: 'new', rate: 1, attach }, { type: 'new', rate: 1, attach }],
        Array.from({ length: 17 }, (_, i) => ({ type: `new-${i}`, rate: 1, attach })),
      ]) expect(() => attachRealmRoomChannels(channels, test.host)).toThrow();
      expect(attach).not.toHaveBeenCalled();
      const close = vi.fn();
      expect(() => attachRealmRoomChannels([
        { type: 'first', rate: 1, attach(room) { room.onMessage(() => {}); return close; } },
        { type: 'second', rate: 1, attach() { throw new Error('setup failed'); } },
      ], test.host)).toThrow('setup failed');
      expect(close).toHaveBeenCalledTimes(1); expect(test.listeners.has('first')).toBe(false);
    } finally { test.binding.dispose(); }
  });

  it('caps person slots even when disconnected work stalls, and reclaims them when it settles', async () => {
    const gate = deferred(), run = vi.fn(async () => { await gate.promise; }), test = setup(8, run);
    try {
      for (let person = 100; person < 400; person++) test.send(test.add(String(person)));
      await flush(); expect(run).toHaveBeenCalledTimes(300);
      const newcomer = test.add('400'); test.send(newcomer); expect(test.stats().capacityDropped).toBe(1);
      test.seats.delete('100'); test.send(newcomer); expect(test.stats().capacityDropped).toBe(2);
      gate.resolve(); await flush(); test.time(2000); test.send(newcomer); await flush();
      expect(run).toHaveBeenCalledTimes(301);
    } finally { gate.resolve(); test.binding.dispose(); }
  });
  it('retains a disconnected person’s rate window across cleanup and a fresh entry', async () => {
    const run = vi.fn(), test = setup(1, run);
    try {
      const a = test.add('100'); test.send(a); await flush();
      test.seats.delete('100'); test.clients.delete(a.sessionId);
      test.send(test.add('101')); await flush();
      const again = test.add('100', 'rejoined'); test.send(again); await flush();
      expect(run).toHaveBeenCalledTimes(2); expect(test.stats().rateDropped).toBe(1);
      test.time(2000); test.send(again); await flush(); expect(run).toHaveBeenCalledTimes(3);
    } finally { test.binding.dispose(); }
  });
});
