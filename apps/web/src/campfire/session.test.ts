import { describe, expect, it } from 'vitest';
import { CAMPFIRE_MESSAGES, type CampfireFrame, type CampfireSelf, type DuskCourtView } from '@chatdom/shared';
import { createCampfireSession, selfFor, type CampfireRoomPort } from './session';

const AT = Date.UTC(2026, 10, 2, 21, 0, 0);

function fakeRoom() {
  const handlers = new Map<string, Set<(message: unknown) => void>>();
  const sent: { type: string; payload: unknown }[] = [];
  const signal = () => {
    const listeners = new Set<() => void>();
    const fn = ((listener: () => void) => { listeners.add(listener); }) as CampfireRoomPort['onDrop'] & { fire(): void };
    fn.remove = (listener: () => void) => { listeners.delete(listener); };
    fn.fire = () => { for (const l of [...listeners]) l(); };
    return fn;
  };
  const onDrop = signal(), onReconnect = signal(), onLeave = signal();
  const room: CampfireRoomPort = {
    onMessage(type, callback) {
      let set = handlers.get(type); if (!set) handlers.set(type, set = new Set());
      set.add(callback as (message: unknown) => void);
      return () => { set!.delete(callback as (message: unknown) => void); };
    },
    send(type, payload) { sent.push({ type, payload }); },
    onDrop, onReconnect, onLeave,
  };
  const deliver = (type: string, message: unknown) => { for (const h of [...handlers.get(type) ?? []]) h(message); };
  return { room, sent, deliver, onDrop, onReconnect, onLeave, listening: (type: string) => handlers.get(type)?.size ?? 0 };
}

function court(overrides: Partial<DuskCourtView> = {}): DuskCourtView {
  return { match: 'm1', revision: 3, phase: 'night', night: 1, startedAt: AT - 5_000, deadline: AT + 25_000, waiting: false, wolves: 1,
    players: [1, 2, 3, 4].map(seat => ({ seat, name: `Player ${seat}`, lantern: 'lit' as const, role: null, away: false, gone: false, embers: 0 as const, voted: false })),
    dawn: null, verdict: null, result: null, ...overrides };
}
const frame = (overrides: Partial<CampfireFrame> = {}): CampfireFrame => ({ at: AT, site: 'clearing', live: false, magistrate: null,
  seated: [1, 2, 3, 4].map(seat => ({ seat, name: `Player ${seat}` })), court: court(), ...overrides });
const self = (overrides: Partial<CampfireSelf> = {}): CampfireSelf => ({ seat: 2, magistrate: false, canAsk: false, canCall: false, match: 'm1',
  role: 'wolf', wolves: [], choice: { kind: 'snuff', targets: [1, 3, 4], chosen: null, deadline: AT + 25_000 }, answers: [], ...overrides });
const manualTimers = () => {
  const queue = new Map<number, () => void>(); let next = 0;
  return { queue, set: (callback: () => void) => { queue.set(++next, callback); return next; }, clear: (handle: unknown) => { queue.delete(handle as number); },
    fire() { for (const [id, callback] of [...queue]) { queue.delete(id); callback(); } } };
};

describe('the fire session', () => {
  it('decodes frames and the private view, and drops anything that does not decode', () => {
    const r = fakeRoom(), session = createCampfireSession(r.room, { clock: () => AT });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame());
    r.deliver(CAMPFIRE_MESSAGES.self, self());
    expect(session.current().frame?.court?.phase).toBe('night');
    expect(session.current().self?.role).toBe('wolf');
    r.deliver(CAMPFIRE_MESSAGES.frame, { ...frame(), secret: 'wolf is 2' });
    r.deliver(CAMPFIRE_MESSAGES.self, { ...self(), role: 'witch' });
    expect(session.current().frame).not.toHaveProperty('secret');
    expect(session.current().self?.role).toBe('wolf');
    session.dispose();
  });

  it('shows a self view only with the round it belongs to', () => {
    expect(selfFor(frame(), self())).not.toBeNull();
    expect(selfFor(frame({ court: court({ match: 'm2' }) }), self())).toBeNull();
    expect(selfFor(frame({ court: null }), self())).toBeNull();
    expect(selfFor(frame({ court: null }), self({ match: null, role: null, choice: null }))).not.toBeNull();
  });

  it('never keeps an older revision of the same round, and always takes a whole new frame', () => {
    const r = fakeRoom(), session = createCampfireSession(r.room, { clock: () => AT });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame({ court: court({ revision: 5, phase: 'dawn' }) }));
    r.deliver(CAMPFIRE_MESSAGES.frame, frame({ court: court({ revision: 4, phase: 'night' }) }));
    expect(session.current().frame?.court?.phase).toBe('dawn');
    r.deliver(CAMPFIRE_MESSAGES.frame, frame({ court: court({ match: 'm2', revision: 1, phase: 'call' }) }));
    expect(session.current().frame?.court?.match).toBe('m2');
    session.dispose();
  });

  it('sends acts with fresh ids, checked against the contract, and resolves them by receipt', async () => {
    const r = fakeRoom(); let n = 0;
    const session = createCampfireSession(r.room, { clock: () => AT, nextId: () => `act-${++n}` });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame()); r.deliver(CAMPFIRE_MESSAGES.self, self());
    const chose = session.choose(3), asked = session.ask();
    expect(r.sent).toEqual([
      { type: CAMPFIRE_MESSAGES.hello, payload: undefined },
      { type: CAMPFIRE_MESSAGES.act, payload: { action: 'choose', id: 'act-1', match: 'm1', seat: 3 } },
      { type: CAMPFIRE_MESSAGES.act, payload: { action: 'ask', id: 'act-2' } },
    ]);
    expect(session.current().pending).toBe(2);
    r.deliver(CAMPFIRE_MESSAGES.receipt, { id: 'act-2', accepted: false });
    r.deliver(CAMPFIRE_MESSAGES.receipt, { id: 'act-1', accepted: true });
    await expect(chose).resolves.toBe(true);
    await expect(asked).resolves.toBe(false);
    expect(session.current().pending).toBe(0);
    // Out of contract: a seat past the ring, or a choice without a round, is never sent.
    await expect(session.choose(13)).resolves.toBe(false);
    r.deliver(CAMPFIRE_MESSAGES.frame, frame({ court: null }));
    await expect(session.call()).resolves.toBe(false);
    expect(r.sent).toHaveLength(3);
    session.dispose();
  });

  it('counts an unanswered act as not accepted, and a dropped connection settles everything at once', async () => {
    const r = fakeRoom(), timers = manualTimers();
    const session = createCampfireSession(r.room, { clock: () => AT, timers });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame()); r.deliver(CAMPFIRE_MESSAGES.self, self());
    const quiet = session.choose(1);
    timers.fire();
    await expect(quiet).resolves.toBe(false);
    const lost = session.choose(4);
    r.onDrop.fire();
    await expect(lost).resolves.toBe(false);
    expect(session.current().connected).toBe(false);
    await expect(session.ask()).resolves.toBe(false);
    r.onReconnect.fire();
    expect(session.current().connected).toBe(true);
    session.dispose();
  });

  it('survives a reconnect by taking the next whole frame', () => {
    const r = fakeRoom(), session = createCampfireSession(r.room, { clock: () => AT });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame()); r.deliver(CAMPFIRE_MESSAGES.self, self());
    r.onDrop.fire(); r.onReconnect.fire();
    expect(r.sent.filter(m => m.type === CAMPFIRE_MESSAGES.hello)).toHaveLength(2);
    r.deliver(CAMPFIRE_MESSAGES.frame, frame({ court: court({ revision: 9, phase: 'talk', night: 1 }) }));
    expect(session.current().frame?.court?.phase).toBe('talk');
    expect(session.current().self?.role).toBe('wolf');
    session.dispose();
  });

  it('a broadcast surface never reads a private view', () => {
    const r = fakeRoom(), session = createCampfireSession(r.room, { clock: () => AT, private: false });
    expect(r.listening(CAMPFIRE_MESSAGES.self)).toBe(0);
    r.deliver(CAMPFIRE_MESSAGES.frame, frame()); r.deliver(CAMPFIRE_MESSAGES.self, self());
    expect(session.current().self).toBeNull();
    session.dispose();
  });

  it('clears private state and every listener on dispose', () => {
    const r = fakeRoom(), session = createCampfireSession(r.room, { clock: () => AT });
    let seen = 0; session.subscribe(() => { seen++; });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame()); r.deliver(CAMPFIRE_MESSAGES.self, self());
    session.dispose();
    expect(session.current()).toEqual({ frame: null, self: null, connected: false, pending: 0 });
    for (const type of Object.values(CAMPFIRE_MESSAGES)) expect(r.listening(type)).toBe(0);
    const before = seen;
    r.deliver(CAMPFIRE_MESSAGES.frame, frame());
    expect(seen).toBe(before);
  });

  it('keeps the room clock from the frames', () => {
    const r = fakeRoom(); let local = AT - 2_000;
    const session = createCampfireSession(r.room, { clock: () => local });
    r.deliver(CAMPFIRE_MESSAGES.frame, frame({ at: AT }));
    local += 500;
    expect(session.now()).toBe(AT + 500);
    session.dispose();
  });
});
