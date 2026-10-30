import { performance } from 'node:perf_hooks';
import { ServerError } from '@colyseus/core';
import type { KingdomId, PersonId, EventCause } from '@chatdom/shared';
import type { CollisionWorld, RealmAuthenticator, RealmBootstrap, RealmCapability, RealmDomainCommand, RealmIngressCheckpoint, RealmIngressTransition,
  RealmIntent, RealmPrincipal, RealmPrivateMessage, RealmPrivateState, RealmPublicDelivery, RealmReceipt, RealmRepository,
  RealmStoredOutcome, RealmTransientMessage, RealmWriterLease } from '@chatdom/shared/realm';
import { decideRealm } from '@chatdom/world/realm';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import type { RealmIntentContext, RealmRoomEffects, RealmRoomHandle, RealmRoomServices } from '../ports';
import { RealmCommitUncertainError, RealmLeaseHeldError, RealmWriterFencedError, describeStorageFailure } from './database';
import { REALM_BASE_ANVILS, type PostgresRealmRepository } from './postgres-repository';
import { OutboxDispatcher, PublicProjection, TransientRelay, type RealmOutboxStore } from '../outbox';

/** Commands waiting for the kingdom's single writer. A full queue is an explicit hold, never an unbounded promise. */
export const REALM_PENDING_COMMANDS = 64;
/** Margin taken off the lease on the local monotonic clock, so this process stops before the database would fence it. */
const LEASE_MARGIN_MS = 2_000;
const DISPOSE_WAIT_MS = 5_000;

export interface DurableKingdomOptions {
  readonly world: CollisionWorld;
  readonly layoutRevision: string;
  /** Arrival point for the n-th entry since open. Must be supported floor in `world`. */
  readonly spawn: (principal: RealmPrincipal, arrival: number) => readonly [number, number, number];
  readonly log?: (line: string) => void;
}
export interface RealmCommandMeta {
  readonly anvilCapacity?: number;
  readonly occurredAt?: number; readonly receivedAt?: number;
  readonly actor?: PersonId | null; readonly cause?: EventCause;
}
export type DurableRepository = RealmRepository & Pick<PostgresRealmRepository, 'publishedPlots' | 'latestPresence' | 'committedState' | 'snapshot' | 'leaseMs'>;
export type RealmLifecycleEvent = Parameters<RealmRoomHandle['lifecycle']>[0];
export type RealmLifecycleListener = (event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string, now: number) => void;

export class RealmBusyError extends Error {
  readonly code = 'realm.busy';
  constructor() { super('The kingdom is still writing earlier work; try again shortly.'); this.name = 'RealmBusyError'; }
}

/**
 * One open kingdom under this process's writer lease. It is the room's `RealmRoomHandle` and the trusted in-process
 * entry for internal services (allocation, presence, Forge). Nothing is acknowledged or published before commit, and
 * losing the lease closes the gate: no command decides, walking stops and public delivery ends.
 */
export class DurableKingdom implements RealmRoomHandle {
  readonly origin: 'live' | 'simulated';
  readonly writerEpoch: string;
  private lease: RealmWriterLease;
  private state: RealmPrivateState;
  private open = true;
  private deadline: number;
  private renewal: ReturnType<typeof setInterval>;
  private watchdog!: ReturnType<typeof setTimeout>;
  private renewing = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private arrivals = 0;
  /** Database clock minus local clock, measured when the lease was last taken or renewed. */
  private clockOffset: number;
  private readonly projection: PublicProjection;
  private readonly dispatcher: OutboxDispatcher;
  private readonly relay = new TransientRelay();
  private readonly walkers = new Set<string>();
  private readonly principals = new Map<string, RealmPrincipal>();
  private readonly effects = new Set<RealmRoomEffects>();
  private readonly lifecycles = new Set<RealmLifecycleListener>();
  private readonly closed = new Set<(reason: string) => void>();

  static async open(repository: DurableRepository, outbox: RealmOutboxStore, kingdomId: KingdomId,
    options: DurableKingdomOptions | ((state: RealmPrivateState) => DurableKingdomOptions | Promise<DurableKingdomOptions>)): Promise<DurableKingdom> {
    const started = performance.now(), wall = Date.now();
    const lease = await repository.acquire(kingdomId);
    try {
      const state = await repository.load(lease);
      // Founded geometry reads this writer's committed state, including approved home replacements. Never
      // resolve it before acquiring the lease, or acquire a second writer inside the geometry loader.
      const resolved = typeof options === 'function' ? await options(state) : options;
      if (performance.now() >= started + repository.leaseMs - LEASE_MARGIN_MS) throw new RealmWriterFencedError(kingdomId);
      const delivered = await outbox.open(lease);
      // The projection is read after the state, inside the same lease: no other writer can add rows in between.
      const { plots, cursor } = await repository.publishedPlots(kingdomId);
      const recent = await repository.latestPresence(kingdomId);
      if (performance.now() >= started + repository.leaseMs - LEASE_MARGIN_MS) throw new RealmWriterFencedError(kingdomId);
      return new DurableKingdom(repository, outbox, lease, state, resolved, new PublicProjection({ plots, cursor, presence: recent, state }), delivered, started, wall);
    } catch (error) {
      await repository.release(lease).catch(() => {});
      throw error;
    }
  }

  private constructor(private readonly repository: DurableRepository, private readonly outbox: RealmOutboxStore, lease: RealmWriterLease, state: RealmPrivateState,
    private readonly options: DurableKingdomOptions, projection: PublicProjection, delivered: number, started: number, wall: number) {
    this.lease = lease; this.state = state; this.origin = state.origin; this.writerEpoch = lease.epoch;
    this.projection = projection;
    this.clockOffset = lease.expiresAt - repository.leaseMs - wall;
    this.deadline = started + repository.leaseMs - LEASE_MARGIN_MS;
    this.dispatcher = new OutboxDispatcher({
      kingdomId: lease.kingdomId, writerEpoch: lease.epoch, delivered,
      read: (after, limit) => this.outbox.read(this.kingdomId, after, limit),
      acknowledge: through => this.outbox.acknowledge(this.lease, through),
      project: row => this.projection.adopt([row]),
      current: () => this.current, fenced: () => this.close('fenced'), log: line => this.log(line),
    });
    this.renewal = setInterval(() => void this.renew(), Math.floor(repository.leaseMs / 3));
    this.renewal.unref?.();
    this.armWatchdog();
    this.log(`opened ${state.origin} kingdom ${state.kingdomId} at fact ${state.sequence}${delivered < projection.cursor ? `, redelivering outbox rows after ${delivered}` : ''}`);
  }

  get kingdomId(): KingdomId { return this.lease.kingdomId; }
  get layoutRevision(): string { return this.options.layoutRevision; }
  get world(): CollisionWorld { return this.options.world; }
  get sequence(): number { return this.state.sequence; }
  /** Private committed state for trusted in-process services. Never a public or Schema payload. */
  get privateState(): RealmPrivateState { return this.state; }
  /** True only while this process holds an unexpired lease by its own conservative clock. */
  get current(): boolean { return this.open && performance.now() < this.deadline; }
  /** Estimated database time, for stamping in-process observations on the clock that will judge them. */
  databaseNow(): number { return Date.now() + this.clockOffset; }
  /** Durable delivery cursor and counters, for diagnostics. */
  get delivery() { return { delivered: this.dispatcher.cursor, committed: this.projection.cursor, deliveries: this.dispatcher.deliveries, redeliveries: this.dispatcher.redeliveries, droppedTransient: this.relay.dropped }; }

  /**
   * Trusted internal command. Serialized behind this kingdom's writer, decided by the world reducer at database time,
   * committed with its outbox, and only then published. A lost COMMIT reply is resolved by lookup, never guessed.
   */
  execute(commandId: string, command: RealmDomainCommand, capability: RealmCapability, meta: RealmCommandMeta = {}): Promise<RealmStoredOutcome> {
    return this.serial(async () => {
      const decide = (state: RealmPrivateState, now: number) => decideRealm(state, command, {
        now, writerEpoch: this.lease.epoch, commandId, capability, current: this.current,
        anvilCapacity: meta.anvilCapacity ?? REALM_BASE_ANVILS,
        ...(meta.occurredAt === undefined ? {} : { occurredAt: meta.occurredAt }),
        ...(meta.receivedAt === undefined ? {} : { receivedAt: meta.receivedAt }),
        ...(meta.actor === undefined ? {} : { actor: meta.actor }),
        ...(meta.cause === undefined ? {} : { cause: meta.cause }),
      });
      return this.settle(commandId, () => this.repository.execute(this.lease, commandId, command, decide, () => this.current));
    });
  }

  /** Trusted presence ingress through the repository's atomic checkpoint transaction (spec 34 R7). */
  ingest(input: Parameters<RealmRepository['executeIngress']>[1],
    transition: (state: RealmPrivateState, checkpoint: RealmIngressCheckpoint | null, now: number) => RealmIngressTransition): Promise<RealmStoredOutcome> {
    return this.serial(() => this.settle(`${input.source}:${input.observation.id}`, () => this.repository.executeIngress(this.lease, input, transition, () => this.current)));
  }

  loadIngress(): Promise<RealmIngressCheckpoint | null> { return this.repository.loadIngress(this.lease); }
  lookup(commandId: string): Promise<RealmStoredOutcome | null> { return this.repository.lookup(this.kingdomId, commandId); }

  // RealmRoomHandle -------------------------------------------------------------------------------------------------

  spawn(principal: RealmPrincipal): readonly [number, number, number] {
    return this.options.spawn(principal, this.arrivals++);
  }

  recoverWalker(walkerId: string, collisionRevision: number): boolean {
    const principal = this.principals.get(walkerId);
    if (!this.current || !principal || collisionRevision !== this.world.revision) return false;
    const position = this.options.spawn(principal, this.arrivals++);
    if (position.some(value => !Number.isFinite(value))) return false;
    const body = { x: position[0], y: position[1], z: position[2] };
    if (embeddedSolids(body, this.world).length || !supported(body, this.world)) return false;
    for (const effects of this.effects) if (effects.readWalker(walkerId) && effects.placeWalker(walkerId, position, collisionRevision)) return true;
    return false;
  }

  async intent(context: RealmIntentContext, intent: RealmIntent): Promise<RealmReceipt> {
    void context;
    if (!this.current) return { version: 1, id: intent.id, status: 'unavailable', message: 'This kingdom lost its writer. Reconnect to check the result before continuing.' };
    return { version: 1, id: intent.id, status: 'unavailable', message: 'This server does not take building, forging or seat requests. Nothing in your kingdom was changed.' };
  }

  /**
   * Synchronous checkpoint of the published row prefix, independent of private state that may be ahead.
   * `current` holds every public change through `throughCursor`. The client buffers deltas while installing
   * it, then applies only deliveries newer than this (see README: delivery cursor).
   */
  bootstrap(principal: RealmPrincipal): RealmBootstrap {
    void principal;
    return { version: 1, kingdomId: this.kingdomId, writerEpoch: this.writerEpoch, throughSequence: this.projection.sequence, throughCursor: this.projection.cursor,
      layoutRevision: this.layoutRevision, collisionRevision: this.world.revision, current: this.projection.current() };
  }

  bindRoom(effects: RealmRoomEffects): () => void {
    if (!this.current) { effects.close('authority-lost'); return () => {}; }
    this.effects.add(effects);
    return () => { this.effects.delete(effects); };
  }

  lifecycle(event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string, now: number): void {
    if (event === 'leave') { this.walkers.delete(walkerId); this.principals.delete(walkerId); }
    else {
      this.walkers.add(walkerId); this.principals.set(walkerId, principal);
      if (!this.current) for (const effects of this.effects) effects.allowWalking(walkerId, false);
    }
    // Walker presence is observed by ingress from these authenticated events; a listener failure never blocks the room.
    for (const listener of this.lifecycles) { try { listener(event, principal, walkerId, now); } catch (error) { this.log(`lifecycle listener failed: ${(error as Error).name}`); } }
  }

  onLifecycle(listener: RealmLifecycleListener): () => void {
    this.lifecycles.add(listener);
    return () => { this.lifecycles.delete(listener); };
  }

  /** Committed public deliveries, at least once, in commit order. A new subscriber first receives any unacknowledged rows. */
  subscribe(deliver: (message: RealmPublicDelivery) => void): () => void {
    if (!this.current) return () => {};
    return this.dispatcher.subscribe(deliver);
  }

  bindTransient(send: (message: RealmTransientMessage) => void, owner: (personId: string, message: RealmPrivateMessage) => void): () => void {
    return this.relay.bind(send, owner);
  }

  /** Relays ephemeral speech/seats to the rooms present now. Never stored or replayed. */
  transient(message: RealmTransientMessage): boolean { return this.current && this.relay.transient(message); }
  /** A private reply to one person present in this kingdom. */
  toOwner(personId: string, message: RealmPrivateMessage): boolean { return this.current && this.relay.owner(personId, message); }

  onClosed(listener: (reason: string) => void): () => void {
    this.closed.add(listener);
    return () => { this.closed.delete(listener); };
  }

  /** Bounded shutdown: stop new work, let queued commits finish, snapshot committed state, release only our own lease. */
  async dispose(): Promise<void> {
    clearInterval(this.renewal);
    const drained = await Promise.race([this.queue.then(() => true, () => true), delay(DISPOSE_WAIT_MS).then(() => false)]);
    // Hand over what committed; anything unacknowledged stays behind the durable cursor for the next writer.
    if (this.current) await Promise.race([this.dispatcher.kick(), delay(DISPOSE_WAIT_MS)]);
    if (this.current && drained) {
      try { await this.repository.snapshot(this.lease); } catch (error) { this.log(`snapshot on close failed: ${describeStorageFailure(error)}`); }
    }
    const held = this.open;
    this.close('disposed');
    if (held) await this.repository.release(this.lease).catch(error => this.log(`lease release failed: ${describeStorageFailure(error)}`));
  }

  // -----------------------------------------------------------------------------------------------------------------

  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (!this.current) return Promise.reject(new RealmWriterFencedError(this.kingdomId));
    if (this.pending >= REALM_PENDING_COMMANDS) return Promise.reject(new RealmBusyError());
    this.pending++;
    const run = this.queue.then(work, work).finally(() => { this.pending--; });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Runs one repository write and refreshes the committed state. An uncertain COMMIT is looked up before anything else. */
  private async settle(id: string, write: () => Promise<RealmStoredOutcome>): Promise<RealmStoredOutcome> {
    let result: RealmStoredOutcome;
    try {
      result = await write();
    } catch (error) {
      if (error instanceof RealmWriterFencedError) { this.close('fenced'); throw error; }
      if (!(error instanceof RealmCommitUncertainError)) throw error;
      // Throws again (still uncertain) if the store cannot answer; the caller must not treat that as a refusal.
      const known = await this.repository.lookup(this.kingdomId, id);
      // Not committed: the same id is safe to decide again (it is idempotent by id and digest).
      result = known ?? await write();
    }
    await this.refresh();
    return result;
  }

  /**
   * Remember newly committed home bases, then hand public rows to the dispatcher in commit order.
   * A refresh failure never un-commits work or advances the public bootstrap beyond its installed prefix.
   */
  private async refresh() {
    let committed = this.repository.committedState(this.lease);
    const after = this.projection.cursor;
    try {
      committed ??= await this.repository.load(this.lease);
      this.projection.rememberHomes(committed);
      const rows = await this.outbox.read(this.kingdomId, after, 1_024);
      if (!this.current) return;
      this.state = committed;
      // The dispatcher folds each row into the public projection before notifying at that prefix.
      await this.dispatcher.offer(after, rows);
    } catch (error) {
      if (error instanceof RealmWriterFencedError) this.close('fenced');
      else this.log(`state refresh failed: ${describeStorageFailure(error)}`);
    }
  }

  /** Runs independently of a renewal request that may never settle. */
  private armWatchdog() {
    clearTimeout(this.watchdog);
    if (!this.open) return;
    this.watchdog = setTimeout(() => {
      if (performance.now() >= this.deadline) this.close('lease deadline passed');
      else this.armWatchdog();
    }, Math.max(0, Math.ceil(this.deadline - performance.now())));
    this.watchdog.unref?.();
  }

  private async renew() {
    if (!this.current) { this.close('lease deadline passed'); return; }
    if (this.renewing) return;
    this.renewing = true;
    const started = performance.now();
    try {
      const wall = Date.now();
      const renewed = await this.repository.renew(this.lease);
      // A response after the old deadline cannot revive a closed authority.
      if (!this.current) { this.close('lease deadline passed'); return; }
      this.lease = renewed;
      this.deadline = started + this.repository.leaseMs - LEASE_MARGIN_MS;
      this.armWatchdog();
      this.clockOffset = this.lease.expiresAt - this.repository.leaseMs - wall;
    } catch (error) {
      if (error instanceof RealmWriterFencedError) this.close('fenced');
      else if (performance.now() >= this.deadline) this.close('lease expired while the database was unreachable');
      else this.log(`lease renewal failed, retrying: ${describeStorageFailure(error)}`);
    } finally { this.renewing = false; }
  }

  private close(reason: string) {
    if (!this.open) return;
    this.open = false;
    clearInterval(this.renewal); clearTimeout(this.watchdog);
    this.dispatcher.stop();
    this.relay.clear();
    for (const walker of this.walkers) for (const effects of this.effects) effects.allowWalking(walker, false);
    for (const effects of this.effects) {
      try { effects.close(reason === 'disposed' ? 'shutdown' : 'authority-lost'); }
      catch { this.log('room close callback failed'); }
    }
    if (reason !== 'disposed') this.log(`writer authority closed for kingdom ${this.kingdomId}: ${reason}`);
    for (const listener of this.closed) listener(reason);
  }

  private log(line: string) { this.options.log?.(`[realm] ${line}`); }
}

const delay = (ms: number) => new Promise<void>(resolve => { const t = setTimeout(resolve, ms); t.unref?.(); });

/** A trusted in-process share of one open kingdom. The writer lease is released when the last hold is. */
export interface DurableKingdomHold { readonly kingdom: DurableKingdom; release(): Promise<void> }
export interface DurableRealmServices extends RealmRoomServices {
  readonly kingdoms: ReadonlyMap<KingdomId, DurableKingdom>;
  /** Holds a kingdom's writer without a room, e.g. while ingress observes a live night nobody is walking in. */
  retain(kingdomId: KingdomId): Promise<DurableKingdomHold>;
}

/**
 * Durable `RealmRoomServices`: the injected authenticator plus kingdoms opened under exclusive Postgres writer leases.
 * One process opens a kingdom once; its room and in-process services (ingress) share it through counted holds, and the
 * last release disposes it. A second room for the same kingdom in this process is refused. `attach` wires per-kingdom
 * services (ingress drain, walker presence) when a kingdom opens and detaches them when it closes. The registry is an
 * in-process capability for trusted callers, never a browser-facing URL.
 */
export function createDurableRealmServices(input: {
  readonly repository: DurableRepository;
  readonly outbox: RealmOutboxStore;
  readonly auth: RealmAuthenticator;
  /** Resolve adopted geometry from committed state after writer acquisition/load, before public bootstrap.
   * The loader must finish within the opening lease's safe window; it never acquires another writer. */
  readonly kingdom: (kingdomId: KingdomId, state: RealmPrivateState) => DurableKingdomOptions | Promise<DurableKingdomOptions>;
  /**
   * Trusted work after the lease is held and before the first walker enters, such as installing deeds left pending
   * by an interrupted allocation. Its failure is logged; it never fails the open or skips the lease.
   */
  readonly afterOpen?: (kingdom: DurableKingdom) => Promise<unknown>;
  readonly attach?: (kingdom: DurableKingdom) => () => void;
  readonly log?: (line: string) => void;
}): DurableRealmServices {
  interface Entry { readonly kingdom: DurableKingdom; holds: number; room: boolean; detach: () => void }
  const entries = new Map<KingdomId, Entry>(), kingdoms = new Map<KingdomId, DurableKingdom>();
  const opening = new Map<KingdomId, Promise<Entry>>(), closing = new Map<KingdomId, Promise<void>>();
  const forget = (kingdomId: KingdomId, entry: Entry) => {
    if (entries.get(kingdomId) !== entry) return;
    entries.delete(kingdomId); kingdoms.delete(kingdomId);
  };

  async function openEntry(kingdomId: KingdomId): Promise<Entry> {
    await closing.get(kingdomId);
    let kingdom: DurableKingdom;
    try {
      kingdom = await DurableKingdom.open(input.repository, input.outbox, kingdomId, async state => {
        const options = await input.kingdom(kingdomId, state);
        return { ...options, ...(input.log ? { log: input.log } : {}) };
      });
    } catch (error) {
      if (error instanceof RealmLeaseHeldError) throw new ServerError(409, 'Another server holds this kingdom right now. Try again in a moment.');
      input.log?.(`[realm] kingdom ${kingdomId} did not open: ${describeStorageFailure(error)}`);
      throw new ServerError(503, 'The kingdom could not be opened from storage. Nothing was changed.');
    }
    const entry: Entry = { kingdom, holds: 0, room: false, detach: () => {} };
    if (input.afterOpen) {
      try { await input.afterOpen(kingdom); }
      catch (error) { input.log?.(`[realm] kingdom ${kingdomId} opened, but its open-time recovery did not finish: ${describeStorageFailure(error)}`); }
    }
    entries.set(kingdomId, entry); kingdoms.set(kingdomId, kingdom);
    kingdom.onClosed(() => forget(kingdomId, entry));
    try { entry.detach = input.attach?.(kingdom) ?? entry.detach; }
    catch (error) { input.log?.(`[realm] kingdom ${kingdomId} services did not attach: ${(error as Error).name}`); }
    return entry;
  }

  async function acquire(kingdomId: KingdomId, room: boolean): Promise<DurableKingdomHold> {
    for (;;) {
      let entry = entries.get(kingdomId);
      if (!entry?.kingdom.current) {
        let pending = opening.get(kingdomId);
        if (!pending) { pending = openEntry(kingdomId).finally(() => opening.delete(kingdomId)); opening.set(kingdomId, pending); }
        entry = await pending;
      }
      // A release may have closed it while we waited; take the next one instead.
      if (entries.get(kingdomId) !== entry || !entry.kingdom.current) continue;
      if (room && entry.room) throw new ServerError(409, 'This kingdom is already open on this server.');
      const held = entry;
      held.holds++;
      if (room) held.room = true;
      let released = false;
      return {
        kingdom: held.kingdom,
        async release() {
          if (released) return;
          released = true;
          held.holds--;
          if (room) held.room = false;
          if (held.holds > 0) return;
          forget(kingdomId, held);
          held.detach();
          const done = held.kingdom.dispose().finally(() => { if (closing.get(kingdomId) === done) closing.delete(kingdomId); });
          closing.set(kingdomId, done);
          await done;
        },
      };
    }
  }

  return {
    auth: input.auth,
    kingdoms,
    retain: kingdomId => acquire(kingdomId, false),
    async open(kingdomId) { return new HeldRoomHandle(await acquire(kingdomId, true)); },
  };
}

/** The room's view of a shared kingdom: everything delegates, and dispose releases only the room's hold. */
class HeldRoomHandle implements RealmRoomHandle {
  constructor(private readonly hold: DurableKingdomHold) {}
  private get k() { return this.hold.kingdom; }
  get kingdomId() { return this.k.kingdomId; }
  get origin() { return this.k.origin; }
  get writerEpoch() { return this.k.writerEpoch; }
  get layoutRevision() { return this.k.layoutRevision; }
  get world() { return this.k.world; }
  get sequence() { return this.k.sequence; }
  spawn(principal: RealmPrincipal) { return this.k.spawn(principal); }
  recoverWalker(walkerId: string, collisionRevision: number) { return this.k.recoverWalker(walkerId, collisionRevision); }
  intent(context: RealmIntentContext, intent: RealmIntent) { return this.k.intent(context, intent); }
  bootstrap(principal: RealmPrincipal) { return this.k.bootstrap(principal); }
  bindRoom(effects: RealmRoomEffects) { return this.k.bindRoom(effects); }
  lifecycle(event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string, now: number) { this.k.lifecycle(event, principal, walkerId, now); }
  subscribe(deliver: (message: RealmPublicDelivery) => void) { return this.k.subscribe(deliver); }
  bindTransient(send: (message: RealmTransientMessage) => void, owner: (personId: string, message: RealmPrivateMessage) => void) { return this.k.bindTransient(send, owner); }
  dispose() { return this.hold.release(); }
}
