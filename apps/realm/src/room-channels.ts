import type { KingdomId, PersonId, Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmAuthenticator, RealmPrincipal } from '@chatdom/shared/realm';

export interface RealmChannelPose {
  readonly position: Vec3; readonly yaw: number; readonly grounded: boolean; readonly collisionRevision: number;
}
export interface RealmChannelSender {
  readonly principal: RealmPrincipal; readonly walkerId: string;
  pose(): RealmChannelPose | null;
  /** Synchronous socket/seat/expiry/authority gate, for checks using a transaction's own session query. */
  present(): boolean;
  /** Recheck session, controlling seat and authority after every asynchronous admission. */
  current(): Promise<boolean>;
}
export interface RealmChannelRoom {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  onMessage(listener: (from: RealmChannelSender, raw: unknown) => void | Promise<void>): void;
  broadcast(message: unknown): void;
  toPerson(personId: PersonId, message: unknown): void;
  person(personId: PersonId): RealmChannelSender | null;
  world(): CollisionWorld;
}
export interface RealmRoomChannel {
  readonly type: string;
  /** Per person per second, across reconnects and replacement sockets. */
  readonly rate: number;
  attach(room: RealmChannelRoom): () => void;
}
export interface RealmChannelClient {
  readonly sessionId: string; readonly auth?: RealmPrincipal;
  send(type: string, message: unknown): void;
  leave(code: number, reason: string): unknown;
}
/** Capabilities from the existing room, never a parallel seat or presence authority. */
export interface RealmChannelHost {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated'; readonly auth: Pick<RealmAuthenticator, 'current'>;
  active(): boolean;
  receive(type: string, listener: (client: RealmChannelClient, raw: unknown) => void): () => void;
  clients(): Iterable<RealmChannelClient>;
  client(id: string): RealmChannelClient | undefined;
  seat(personId: PersonId): string | undefined;
  held(walkerId: string): boolean;
  pose(walkerId: string): RealmChannelPose | null;
  world(): CollisionWorld;
  end(walkerId: string, reason: 'session-ended' | 'unavailable'): void;
  now?(): number;
}
export interface RealmChannelCounts {
  received: number; delivered: number; rateDropped: number; busyDropped: number;
  capacityDropped: number; authRefused: number; failed: number;
}
const RESERVED = new Set(['intent', 'bootstrap', 'private', 'world', 'transient', 'revision', 'input']);
const MAX_CHANNELS = 16, MAX_PEOPLE = 300;
interface PersonSlot { start: number; count: number; busy: boolean }

/** Each pending operation retains its slot until it settles; timeouts never create another hidden queue. */
export function attachRealmRoomChannels(channels: readonly RealmRoomChannel[], host: RealmChannelHost) {
  const types = new Set<string>();
  if (channels.length > MAX_CHANNELS) throw new Error('Too many room channels.');
  for (const channel of channels) {
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(channel.type) || RESERVED.has(channel.type) || types.has(channel.type)
      || !Number.isInteger(channel.rate) || channel.rate < 1 || channel.rate > 60) throw new Error('Invalid room channel registration.');
    types.add(channel.type);
  }
  let disposed = false;
  const now = host.now ?? Date.now, cleanup: (() => void)[] = [];
  const counts = new Map<string, RealmChannelCounts>();
  const live = (client: RealmChannelClient, principal = client.auth): principal is RealmPrincipal =>
    !disposed && host.active() && !!principal && client.auth === principal && principal.expiresAt > now()
    && principal.kingdomId === host.kingdomId && principal.origin === host.origin
    && host.client(client.sessionId) === client && host.seat(principal.personId) === client.sessionId
    && !host.held(client.sessionId) && host.pose(client.sessionId) !== null;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    // All capabilities are closed before any feature disposer runs.
    for (const close of cleanup.reverse()) { try { close(); } catch { /* Continue detaching other channels. */ } }
  };
  const senderFor = (client: RealmChannelClient, principal: RealmPrincipal): RealmChannelSender => ({
    principal, walkerId: client.sessionId,
    present: () => live(client, principal),
    pose: () => live(client, principal) ? host.pose(client.sessionId) : null,
    async current() {
      if (!live(client, principal)) return false;
      try {
        const current = await host.auth.current(principal, now());
        if (!current) { if (live(client, principal)) host.end(client.sessionId, 'session-ended'); return false; }
        return live(client, principal);
      } catch (error) {
        if (live(client, principal)) host.end(client.sessionId, 'unavailable');
        throw error;
      }
    },
  });
  try {
    for (const channel of channels) {
      const stats: RealmChannelCounts = { received: 0, delivered: 0, rateDropped: 0, busyDropped: 0, capacityDropped: 0, authRefused: 0, failed: 0 };
      counts.set(channel.type, stats);
      const people = new Map<PersonId, PersonSlot>();
      let listener: Parameters<RealmChannelRoom['onMessage']>[0] | undefined;
      const room: RealmChannelRoom = {
        kingdomId: host.kingdomId, origin: host.origin,
        onMessage(callback) { if (listener) throw new Error('A room channel already has a handler.'); listener = callback; },
        broadcast(message) { for (const client of host.clients()) if (live(client)) client.send(channel.type, message); },
        toPerson(personId, message) {
          const id = host.seat(personId), client = id ? host.client(id) : undefined;
          if (client && client.auth?.personId === personId && live(client)) client.send(channel.type, message);
        },
        person(personId) {
          const id = host.seat(personId), client = id ? host.client(id) : undefined;
          return client?.auth && client.auth.personId === personId && live(client) ? senderFor(client, client.auth) : null;
        },
        world() { if (disposed || !host.active()) throw new Error('The kingdom room has ended.'); return host.world(); },
      };
      cleanup.push(channel.attach(room));
      if (!listener) throw new Error('A room channel needs a handler.');
      cleanup.push(host.receive(channel.type, (client, raw) => {
        stats.received++;
        const principal = client.auth;
        if (!live(client, principal) || !principal) { stats.authRefused++; return; }
        let slot = people.get(principal.personId);
        if (!slot) {
          // Old disconnected people do not occupy the map forever. Stalled work still owns its finite slot.
          for (const [person, state] of people) if (!state.busy && !host.seat(person) && now() - state.start >= 1000) people.delete(person);
          if (people.size >= MAX_PEOPLE) { stats.capacityDropped++; return; }
          slot = { start: now(), count: 0, busy: false }; people.set(principal.personId, slot);
        }
        const at = now();
        if (at < slot.start || at - slot.start >= 1000) { slot.start = at; slot.count = 0; }
        if (++slot.count > channel.rate) { stats.rateDropped++; return; }
        if (slot.busy) { stats.busyDropped++; return; }
        slot.busy = true;
        const sender = senderFor(client, principal);
        const work = async () => {
          if (!await sender.current()) { stats.authRefused++; return; }
          stats.delivered++;
          await listener!(sender, raw);
        };
        void work().catch(() => { stats.failed++; }).finally(() => {
          slot.busy = false;
          if (!host.seat(principal.personId) && now() - slot.start >= 1000) people.delete(principal.personId);
        });
      }));
      cleanup.push(() => people.clear());
    }
  } catch (error) { dispose(); throw error; }
  return { dispose, counts: counts as ReadonlyMap<string, Readonly<RealmChannelCounts>> };
}
