import { CAMPFIRE_MESSAGES, CampfireActSchema, CampfireFrameSchema, CampfireSelfSchema, type CampfireAct, type CampfireFrame, type CampfireSelf } from '@chatdom/shared';

/*
 * The fire's side of the kingdom room, in the browser. The room sends the whole public frame (`campfire`) to everyone
 * when it changes and as a heartbeat, and a seat's own card and choice (`campfire.self`) to that person alone. Both are
 * decoded with the shared schemas; anything that does not decode is dropped, never shown.
 *
 * Frames are whole, so a reconnect needs no replay: the session says hello again and the answer replaces everything. Private state lives only here
 * and is cleared on dispose. A stream surface opens the session with `private: false` and never stores a self view.
 */

interface Signal { (listener: () => void): unknown; remove?(listener: () => void): void }
/** The retained kingdom room (play's walk lends `onMessage`/`send`; a full SDK room also has the lifecycle signals). */
export interface CampfireRoomPort {
  onMessage<T = unknown>(type: string, callback: (message: T) => void): () => void;
  send(type: string, payload?: unknown): void;
  readonly onDrop?: Signal;
  readonly onReconnect?: Signal;
  readonly onLeave?: Signal;
}

export interface CampfireSessionState {
  readonly frame: CampfireFrame | null;
  /** Your own view, only while it belongs to the frame's round (or to no round at all). */
  readonly self: CampfireSelf | null;
  readonly connected: boolean;
  /** Acts sent and not yet answered. */
  readonly pending: number;
}

export interface CampfireSession {
  current(): CampfireSessionState;
  subscribe(listener: (state: CampfireSessionState) => void): () => void;
  /** The room's clock, from its frames' own times. */
  now(): number;
  /** Ask the fire for a round (seated), or call one (the Magistrate). Resolves with the room's answer. */
  ask(): Promise<boolean>;
  /** Your night tap or your vote; null rests or abstains. */
  choose(seat: number | null): Promise<boolean>;
  /** The Magistrate calls the next phase. */
  call(): Promise<boolean>;
  dispose(): void;
}

export interface CampfireSessionOptions {
  /** False for surfaces that may be broadcast: `campfire.self` is then never read. */
  readonly private?: boolean;
  readonly clock?: () => number;
  /** An act the room never answers counts as not accepted after this long. */
  readonly answerMs?: number;
  readonly timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
  readonly nextId?: () => string;
}

let sequence = 0;
const freshId = (): string => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.floor(Math.random() * 0xffffffff).toString(16);
  return `fire-${Date.now().toString(36)}-${(++sequence).toString(36)}-${random}`;
};

/** A self view belongs to the frame it is shown with only when both speak of the same round. */
export function selfFor(frame: CampfireFrame | null, self: CampfireSelf | null): CampfireSelf | null {
  if (!self) return null;
  const match = frame?.court?.match ?? null;
  if (self.match !== null && self.match !== match) return null;
  return self;
}

export function createCampfireSession(room: CampfireRoomPort, options: CampfireSessionOptions = {}): CampfireSession {
  const clock = options.clock ?? Date.now, answerMs = options.answerMs ?? 6_000, nextId = options.nextId ?? freshId;
  const timers = options.timers ?? { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const wantsSelf = options.private !== false;
  const listeners = new Set<(state: CampfireSessionState) => void>();
  const pending = new Map<string, { resolve(accepted: boolean): void; timer: unknown }>();
  let frame: CampfireFrame | null = null, self: CampfireSelf | null = null, connected = true, disposed = false;
  // The room's clock minus ours, from the freshest frame. Frames are sent as they are made, so the smallest gap seen
  // in a short window is the best estimate of the wire's delay; it is refreshed so a drifting clock cannot stick.
  let offset: number | null = null, offsetAt = -Infinity;
  let state: CampfireSessionState = { frame: null, self: null, connected: true, pending: 0 };
  const publish = () => {
    if (disposed) return;
    state = { frame, self: selfFor(frame, self), connected, pending: pending.size };
    for (const listener of [...listeners]) listener(state);
  };
  const settle = (id: string, accepted: boolean) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id); timers.clear(entry.timer); entry.resolve(accepted);
  };
  const settleAll = () => { for (const id of [...pending.keys()]) settle(id, false); };

  const offs: (() => void)[] = [];
  offs.push(room.onMessage(CAMPFIRE_MESSAGES.frame, raw => {
    const parsed = CampfireFrameSchema.safeParse(raw);
    if (!parsed.success || disposed) return;
    const next = parsed.data, local = clock(), gap = next.at - local;
    // Within a round, an older revision never replaces a newer one (a late heartbeat after a change).
    const current = frame?.court, incoming = next.court;
    if (current && incoming && current.match === incoming.match && incoming.revision < current.revision) return;
    if (offset === null || local - offsetAt > 10_000 || gap > offset) { offset = gap; offsetAt = local; }
    frame = next;
    publish();
  }));
  if (wantsSelf) offs.push(room.onMessage(CAMPFIRE_MESSAGES.self, raw => {
    const parsed = CampfireSelfSchema.safeParse(raw);
    if (!parsed.success || disposed) return;
    self = parsed.data;
    publish();
  }));
  offs.push(room.onMessage(CAMPFIRE_MESSAGES.receipt, raw => {
    const receipt = raw as { id?: unknown; accepted?: unknown } | null;
    if (receipt && typeof receipt.id === 'string' && typeof receipt.accepted === 'boolean') { settle(receipt.id, receipt.accepted); publish(); }
  }));
  const dropped = () => { connected = false; settleAll(); publish(); };
  const back = () => { connected = true; room.send(CAMPFIRE_MESSAGES.hello); publish(); };
  const left = () => { connected = false; settleAll(); frame = null; self = null; publish(); };
  room.onDrop?.(dropped); room.onReconnect?.(back); room.onLeave?.(left);
  // Ask for the whole frame and your own view now; the same hello follows every reconnect.
  room.send(CAMPFIRE_MESSAGES.hello);

  const act = (build: (id: string) => CampfireAct | null): Promise<boolean> => {
    if (disposed || !connected) return Promise.resolve(false);
    const id = nextId(), message = build(id);
    if (!message) return Promise.resolve(false);
    const checked = CampfireActSchema.safeParse(message);
    if (!checked.success) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const timer = timers.set(() => { settle(id, false); publish(); }, answerMs);
      pending.set(id, { resolve, timer });
      room.send(CAMPFIRE_MESSAGES.act, checked.data);
      publish();
    });
  };
  const match = (): string | null => selfFor(frame, self)?.match ?? frame?.court?.match ?? null;

  return {
    current: () => state,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    now: () => clock() + (offset ?? 0),
    ask: () => act(id => ({ action: 'ask', id })),
    choose: seat => act(id => { const m = match(); return m ? { action: 'choose', id, match: m, seat } : null; }),
    call: () => act(id => { const m = match(); return m ? { action: 'call', id, match: m } : null; }),
    dispose() {
      if (disposed) return;
      settleAll();
      disposed = true;
      for (const off of offs) off();
      room.onDrop?.remove?.(dropped); room.onReconnect?.remove?.(back); room.onLeave?.remove?.(left);
      listeners.clear();
      frame = null; self = null;
      state = { frame: null, self: null, connected: false, pending: 0 };
    },
  };
}
