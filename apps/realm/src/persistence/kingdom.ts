import { performance } from 'node:perf_hooks';
import { ServerError } from '@colyseus/core';
import { starterCitizenLook, type KingdomId, type PersonId, type EventCause, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmAuthenticator, RealmBootstrap, RealmCapability, RealmDomainCommand, RealmIngressCheckpoint, RealmIngressTransition,
  RealmIntent, RealmPrincipal, RealmPrivateMessage, RealmPrivateState, RealmPublicDelivery, RealmReceipt, RealmRepository,
  RealmStoredOutcome, RealmTransientMessage, RealmWriterLease } from '@chatdom/shared/realm';
import { WALK_BODY, REALM_NO_HOME_SLOT, REALM_WALKER_FRAME_MAX_BYTES, RealmWalkerFrameSchema, type RealmWalkerFrame } from '@chatdom/shared/realm';
import { decideRealm } from '@chatdom/world/realm';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import type { RealmIntentContext, RealmRoomEffects, RealmRoomHandle, RealmRoomServices } from '../ports';
import { RealmCommitUncertainError, RealmLeaseHeldError, RealmWriterFencedError, describeStorageFailure } from './database';
import { REALM_BASE_ANVILS, type PostgresRealmRepository } from './postgres-repository';
import { OutboxDispatcher, PublicProjection, TransientRelay, type RealmOutboxStore } from '../outbox';
import type { InteractionAuthority } from '../interactions';

/** Commands waiting for the kingdom's single writer. A full queue is an explicit hold, never an unbounded promise. */
export const REALM_PENDING_COMMANDS = 64;
/** A queued command that has not started by then is refused unstarted, so nothing was written; callers never wait longer. */
export const REALM_COMMAND_QUEUE_WAIT_MS = 10_000;
/** Shutdown waits this long for queued commits, and again for the last delivery. */
export const REALM_DISPOSE_WAIT_MS = 5_000;
/** Margin taken off the lease on the local monotonic clock, so this process stops before the database would fence it. */
const LEASE_MARGIN_MS = 2_000;

export interface DurableKingdomOptions {
  readonly world: CollisionWorld;
  readonly layoutRevision: string;
  /** Arrival point for the n-th entry since open. Must be supported floor in `world`. */
  readonly spawn: (principal: RealmPrincipal, arrival: number) => readonly [number, number, number];
  readonly log?: (line: string) => void;
  /**
   * Why owned actions are held right now (an unready dependency), or null. A held kingdom refuses new commands at once
   * with `realm.held` instead of queueing them behind a store that is not answering.
   */
  readonly hold?: () => string | null;
  /** Prepare from this writer's committed state. Publication stays with the held writer below. */
  readonly prepareWorld?: (state: RealmPrivateState) => Promise<DurableWorldAdoption>;
}
/** A checked immutable candidate, with no authority to publish itself during asynchronous preparation. */
export interface DurableWorldAdoption {
  readonly world: CollisionWorld;
  readonly layoutRevision: string;
  readonly spawn: DurableKingdomOptions['spawn'];
  /** Compare approved public homes/attachments, independently of the currently adopted collision revision. */
  matches(checkpoint: RealmBootstrap): boolean;
  positions(walkers: readonly { readonly id: string; readonly position: Vec3 }[]): ReadonlyMap<string, Vec3>;
  /** Called synchronously after room and handle adoption; makes the exact receipt discoverable. */
  adopted(): void;
}
export interface RealmCommandMeta {
  /** Optional trusted caller lease, rechecked alongside the writer through the final pre-COMMIT boundary. */
  readonly current?: () => boolean;
  readonly anvilCapacity?: number;
  readonly occurredAt?: number; readonly receivedAt?: number;
  readonly actor?: PersonId | null; readonly cause?: EventCause;
}
export type DurableRepository = RealmRepository & Pick<PostgresRealmRepository, 'committedState' | 'snapshot' | 'leaseMs'>;
export type RealmLifecycleEvent = Parameters<RealmRoomHandle['lifecycle']>[0];
export type RealmLifecycleListener = (event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string, now: number) => void;

export class RealmBusyError extends Error {
  readonly code = 'realm.busy';
  constructor() { super('The kingdom is still writing earlier work; try again shortly.'); this.name = 'RealmBusyError'; }
}
/** A dependency is not ready, so the command was not started. Nothing was written. */
export class RealmHeldError extends Error {
  readonly code = 'realm.held';
  constructor(readonly reason: string) { super(`The kingdom is holding new work while ${reason}; nothing was changed. Try again shortly.`); this.name = 'RealmHeldError'; }
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
  private pendingHighWater = 0;
  private refused = { busy: 0, held: 0, expired: 0 };
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
  private readonly worldAdopted = new Set<() => void>();
  private walkerFrame: RealmWalkerFrame | null = null;
  private readonly walkerSubscribers = new Set<(frame: RealmWalkerFrame) => void>();
  private interactions: InteractionAuthority | null = null;
  private detachInteractions: (() => void) | null = null;
  private geometry: Pick<DurableKingdomOptions, 'world' | 'layoutRevision' | 'spawn'>;
  private preparingWorld: Promise<void> | null = null;
  private worldNeeded = false;
  private preparedGeometry: { readonly homes: RealmPrivateState['homes']; readonly castle: RealmPrivateState['castle']; readonly attachments: RealmPrivateState['attachments']; readonly candidate: DurableWorldAdoption } | null = null;

  static async open(repository: DurableRepository, outbox: RealmOutboxStore, kingdomId: KingdomId,
    options: DurableKingdomOptions | ((state: RealmPrivateState) => DurableKingdomOptions | Promise<DurableKingdomOptions>)): Promise<DurableKingdom> {
    let started = performance.now(), wall = Date.now();
    let lease = await repository.acquire(kingdomId);
    // Cold geometry is asynchronous work under this same writer, before a room/handle exists to renew it.
    // Keep its epoch alive without ever accepting a renewal response beyond the previous safe deadline.
    let active = true, fenced = false;
    let renewing: Promise<void> | null = null;
    const current = () => !fenced && performance.now() < started + repository.leaseMs - LEASE_MARGIN_MS;
    const assertCurrent = () => { if (!current()) throw new RealmWriterFencedError(kingdomId); };
    const renew = () => {
      if (!active || renewing) return;
      if (!current()) { fenced = true; return; }
      const nextStarted = performance.now(), nextWall = Date.now();
      renewing = (async () => {
        try {
          const next = await repository.renew(lease);
          if (!active) return;
          if (!current()) { fenced = true; return; }
          lease = next; started = nextStarted; wall = nextWall;
        } catch (error) {
          if (error instanceof RealmWriterFencedError || !current()) fenced = true;
        }
      })().finally(() => { renewing = null; });
    };
    const interval = Math.max(100, Math.floor((repository.leaseMs - LEASE_MARGIN_MS) / 3));
    let renewal = setTimeout(() => {
      renewal = setInterval(renew, interval); renewal.unref?.(); renew();
    }, Math.max(0, started + interval - performance.now()));
    renewal.unref?.();
    try {
      assertCurrent();
      const state = await repository.load(lease);
      assertCurrent();
      // Founded geometry reads this writer's committed state, including approved home replacements. Never
      // resolve it before acquiring the lease, or acquire a second writer inside the geometry loader.
      const resolved = typeof options === 'function' ? await options(state) : options;
      assertCurrent();
      const delivered = await outbox.open(lease);
      const prefix = await outbox.prefix(kingdomId, delivered);
      // Stop opening's cadence and settle its in-flight request before handing the latest lease to the handle.
      // A stalled reply may only hold that handoff until the existing deadline, never create another window.
      clearInterval(renewal);
      if (renewing) {
        assertCurrent();
        let expiry: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([renewing, new Promise<never>((_, reject) => {
            expiry = setTimeout(() => reject(new RealmWriterFencedError(kingdomId)),
              Math.max(0, Math.ceil(started + repository.leaseMs - LEASE_MARGIN_MS - performance.now())));
            expiry.unref?.();
          })]);
        } finally { clearTimeout(expiry); }
      }
      assertCurrent();
      const sequence = delivered >= prefix.committed ? state.sequence : prefix.sequence;
      const projection = new PublicProjection({ ...prefix, cursor: delivered, sequence });
      return new DurableKingdom(repository, outbox, lease, state, resolved, projection, delivered, prefix.committed, started, wall);
    } catch (error) {
      active = false;
      await repository.release(lease).catch(() => {});
      throw error;
    } finally { active = false; clearInterval(renewal); }
  }

  private constructor(private readonly repository: DurableRepository, private readonly outbox: RealmOutboxStore, lease: RealmWriterLease, state: RealmPrivateState,
    private readonly options: DurableKingdomOptions, projection: PublicProjection, delivered: number, committed: number, started: number, wall: number) {
    this.lease = lease; this.state = state; this.origin = state.origin; this.writerEpoch = lease.epoch;
    this.geometry = options;
    this.projection = projection;
    this.clockOffset = lease.expiresAt - repository.leaseMs - wall;
    this.deadline = started + repository.leaseMs - LEASE_MARGIN_MS;
    this.dispatcher = new OutboxDispatcher({
      kingdomId: lease.kingdomId, writerEpoch: lease.epoch, delivered, committed,
      read: (after, limit) => this.outbox.read(this.kingdomId, after, limit),
      acknowledge: through => this.outbox.acknowledge(this.lease, through),
      project: row => {
        this.projection.adopt([row]);
        // Run only after the synchronous delivery listeners have been handed this public prefix.
        queueMicrotask(() => { void this.prepareWorld(); });
      },
      current: () => this.current, fenced: () => this.close('fenced'), log: line => this.log(line),
    });
    // Opening's founded preparation already consumes this lease. Anchor the first renewal to acquisition,
    // not construction, or a valid slow opening can expire before its first renewal is even attempted.
    const interval = Math.max(100, Math.floor((repository.leaseMs - LEASE_MARGIN_MS) / 3));
    this.renewal = setTimeout(() => {
      this.renewal = setInterval(() => void this.renew(), interval);
      this.renewal.unref?.();
      void this.renew();
    }, Math.max(0, started + interval - performance.now()));
    this.renewal.unref?.();
    this.armWatchdog();
    this.log(`opened ${state.origin} kingdom ${state.kingdomId} at fact ${state.sequence}${delivered < committed ? `, redelivering outbox rows after ${delivered}` : ''}`);
  }

  get kingdomId(): KingdomId { return this.lease.kingdomId; }
  get layoutRevision(): string { return this.geometry.layoutRevision; }
  get world(): CollisionWorld { return this.geometry.world; }
  get sequence(): number { return this.state.sequence; }
  /** Private committed state for trusted in-process services. Never a public or Schema payload. */
  get privateState(): RealmPrivateState { return this.state; }
  /** True only while this process holds an unexpired lease by its own conservative clock. */
  get current(): boolean { return this.open && performance.now() < this.deadline; }
  /** Lease health by the local monotonic clock: remaining time before this process stops writing, of its full window. */
  get writer() {
    return { current: this.current, remainingMs: Math.max(0, Math.round(this.deadline - performance.now())), windowMs: this.repository.leaseMs - LEASE_MARGIN_MS };
  }
  /** Estimated database time, for stamping in-process observations on the clock that will judge them. */
  databaseNow(): number { return Date.now() + this.clockOffset; }
  /** Durable delivery cursor and counters, for diagnostics. */
  get delivery() { return { delivered: this.dispatcher.cursor, committed: this.dispatcher.newest, deliveries: this.dispatcher.deliveries, redeliveries: this.dispatcher.redeliveries, largestBatch: this.dispatcher.largestBatch, droppedTransient: this.relay.dropped }; }
  /** The writer queue: commands waiting or running now, its high-water mark, and commands refused unstarted by cause. */
  get commands() { return { pending: this.pending, highWater: this.pendingHighWater, limit: REALM_PENDING_COMMANDS, refused: { ...this.refused } }; }

  /**
   * Trusted internal command. Serialized behind this kingdom's writer, decided by the world reducer at database time,
   * committed with its outbox, and only then published. A lost COMMIT reply is resolved by lookup, never guessed.
   */
  execute(commandId: string, command: RealmDomainCommand, capability: RealmCapability, meta: RealmCommandMeta = {}): Promise<RealmStoredOutcome> {
    const current = () => {
      try { return this.current && (meta.current?.() ?? true); } catch { return false; }
    };
    return this.serial(async () => {
      const decide = (state: RealmPrivateState, now: number) => decideRealm(state, command, {
        now, writerEpoch: this.lease.epoch, commandId, capability, current: current(),
        anvilCapacity: meta.anvilCapacity ?? REALM_BASE_ANVILS,
        ...(meta.occurredAt === undefined ? {} : { occurredAt: meta.occurredAt }),
        ...(meta.receivedAt === undefined ? {} : { receivedAt: meta.receivedAt }),
        ...(meta.actor === undefined ? {} : { actor: meta.actor }),
        ...(meta.cause === undefined ? {} : { cause: meta.cause }),
      });
      return this.settle(commandId, () => this.repository.execute(this.lease, commandId, command, decide, current));
    });
  }

  /** Trusted presence ingress through the repository's atomic checkpoint transaction (spec 34 R7). */
  ingest(input: Parameters<RealmRepository['executeIngress']>[1],
    transition: (state: RealmPrivateState, checkpoint: RealmIngressCheckpoint | null, now: number) => RealmIngressTransition): Promise<RealmStoredOutcome> {
    return this.serial(() => this.settle(`${input.source}:${input.observation.id}`, () => this.repository.executeIngress(this.lease, input, transition, () => this.current)));
  }

  loadIngress(): Promise<RealmIngressCheckpoint | null> { return this.repository.loadIngress(this.lease); }
  /** Trusted normalized moments share this writer's queue and lease; no external writer or domain command. */
  writeMoments<T>(work: (lease: RealmWriterLease, current: () => boolean) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      try {
        const result = await work(this.lease, () => this.current);
        void this.dispatcher.kick();
        return result;
      } catch (error) {
        if (error instanceof RealmWriterFencedError) this.close('fenced');
        throw error;
      }
    });
  }
  lookup(commandId: string): Promise<RealmStoredOutcome | null> { return this.repository.lookup(this.kingdomId, commandId); }

  // RealmRoomHandle -------------------------------------------------------------------------------------------------

  spawn(principal: RealmPrincipal): readonly [number, number, number] {
    return this.geometry.spawn(principal, this.arrivals++);
  }

  recoverWalker(walkerId: string, collisionRevision: number): boolean {
    const principal = this.principals.get(walkerId);
    if (!this.current || !principal || collisionRevision !== this.world.revision) return false;
    let position: Vec3;
    try { position = this.geometry.spawn(principal, this.arrivals++); }
    catch { return false; }
    if (position.some(value => !Number.isFinite(value))) return false;
    const body = { x: position[0], y: position[1], z: position[2] };
    if (embeddedSolids(body, this.world).length || !supported(body, this.world)) return false;
    for (const id of this.walkers) if (id !== walkerId) for (const effects of this.effects) {
      const peer = effects.readWalker(id);
      if (peer && Math.abs(peer.x - position[0]) < WALK_BODY.radius * 2 + .05
        && Math.abs(peer.z - position[2]) < WALK_BODY.radius * 2 + .05
        && Math.abs(peer.y - position[1]) < WALK_BODY.height) return false;
    }
    for (const effects of this.effects) if (effects.readWalker(walkerId) && effects.placeWalker(walkerId, position, collisionRevision)) return true;
    return false;
  }

  async intent(context: RealmIntentContext, intent: RealmIntent): Promise<RealmReceipt> {
    if (!this.current) return { version: 1, id: intent.id, status: 'unavailable', message: 'This kingdom lost its writer. Reconnect to check the result before continuing.' };
    if (intent.type === 'interact' && this.interactions) return this.interactions.intent(context, intent);
    return { version: 1, id: intent.id, status: 'unavailable', message: 'This server does not take building, forging or seat requests. Nothing in your kingdom was changed.' };
  }

  /**
   * Synchronous checkpoint of the published row prefix, independent of private state that may be ahead.
   * `current` holds every public change through `throughCursor`. The client buffers deltas while installing
   * it, then applies only deliveries newer than this (see README: delivery cursor).
   */
  bootstrap(principal: RealmPrincipal): RealmBootstrap {
    const active = [...this.principals.values()].reverse().find(active => active.personId === principal.personId);
    if (this.current && active?.sessionId === principal.sessionId) {
      this.toOwner(principal.personId, { type: 'home.owned', plotId: this.ownedPlotId(principal.personId) });
      if (this.interactions) {
        this.transient(this.interactions.seats());
        this.toOwner(principal.personId, { type: 'interaction', requestId: null, writerEpoch: this.writerEpoch,
          state: this.interactions.selfState(principal.sessionId) });
      }
    }
    return this.publicCheckpoint();
  }

  /**
   * Trusted in-process public read, including before the first walker joins. A founded-scene reader retains
   * this kingdom through the existing registry, prepares its scene against this delivered prefix, then releases
   * the hold. No principal, entry ticket or second writer is needed. This frozen view alone does not assert
   * readiness: the reader must also check `current` and matching scene/layout/collision versions before serving.
   */
  publicCheckpoint(): RealmBootstrap {
    return { version: 1, kingdomId: this.kingdomId, writerEpoch: this.writerEpoch, throughSequence: this.projection.sequence, throughCursor: this.projection.cursor,
      layoutRevision: this.layoutRevision, collisionRevision: this.world.revision, current: this.projection.current() };
  }

  /**
   * A cold founded-scene read is a trusted consumer of approved public views, even with no socket present.
   * Drain their durable prefix before comparing it with prepared geometry; otherwise a recovered publication
   * could wait for a join which itself needs this manifest. No historical ritual is replayed to a later join.
   */
  async preparePublicCheckpoint(): Promise<RealmBootstrap> {
    if (!this.current) throw new RealmWriterFencedError(this.kingdomId);
    const unsubscribe = this.subscribe(() => {});
    try {
      await this.dispatcher.kick();
      if (!this.current) throw new RealmWriterFencedError(this.kingdomId);
      // The dispatcher logs/retries storage failures. A swallowed read/ack failure isn't a ready manifest.
      if (this.delivery.delivered !== this.delivery.committed) throw new RealmBusyError();
      await this.prepareWorld();
      if (!this.current) throw new RealmWriterFencedError(this.kingdomId);
      return this.publicCheckpoint();
    } finally { unsubscribe(); }
  }

  bindRoom(effects: RealmRoomEffects): () => void {
    if (!this.current) { effects.close('authority-lost'); return () => {}; }
    if (this.effects.size) throw new Error('This kingdom already has a walker room');
    this.effects.add(effects);
    return () => { if (this.effects.delete(effects)) this.clearWalkers(); };
  }

  /** Compose transient interactions into this retained writer and its actual room, without replacing either. */
  bindInteractionAuthority(authority: InteractionAuthority): () => void {
    if (!this.current) { authority.dispose(); return () => {}; }
    if (this.interactions) throw new Error('This kingdom already has an interaction authority');
    this.interactions = authority;
    const detachRoom = authority.bindRoom({
      readWalker: id => {
        for (const effects of this.effects) { const walker = effects.readWalker(id); if (walker) return walker; }
        return null;
      },
      placeWalker: (id, position, revision) => {
        if (!this.current || revision !== this.world.revision) return false;
        for (const effects of this.effects) if (effects.readWalker(id) && effects.placeWalker(id, position, revision)) return true;
        return false;
      },
      allowWalking: (id, allowed) => { for (const effects of this.effects) effects.allowWalking(id, allowed && this.current); },
    });
    const detachDelivery = authority.bindDelivery({
      transient: message => { this.transient(message); },
      owner: (personId, message) => { this.toOwner(personId, message); },
    });
    const detachLifecycle = this.onLifecycle((event, principal, walkerId, now) => authority.lifecycle(event, principal, walkerId, now));
    const detachWorld = this.onWorldAdopted(() => authority.adoptRegistry());
    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      authority.dispose();
      detachRoom(); detachDelivery(); detachLifecycle(); detachWorld();
      if (this.interactions === authority) { this.interactions = null; this.detachInteractions = null; }
    };
    this.detachInteractions = detach;
    return detach;
  }

  lifecycle(event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string, now: number): void {
    if (event === 'leave') { this.walkers.delete(walkerId); this.principals.delete(walkerId); }
    else {
      this.walkers.add(walkerId); this.principals.set(walkerId, principal);
      if (!this.current) for (const effects of this.effects) effects.allowWalking(walkerId, false);
      else if (event === 'join' || event === 'reconnect') this.presentWalker(walkerId, principal);
    }
    // Walker presence is observed by ingress from these authenticated events; a listener failure never blocks the room.
    for (const listener of this.lifecycles) { try { listener(event, principal, walkerId, now); } catch (error) { this.log(`lifecycle listener failed: ${(error as Error).name}`); } }
  }

  /** Latest actual room sample only: poses never enter durable history or transient speech quotas. */
  currentWalkers(): RealmWalkerFrame {
    return this.current && this.walkerFrame ? this.walkerFrame : this.emptyWalkers();
  }

  subscribeWalkers(receive: (frame: RealmWalkerFrame) => void): () => void {
    if (!this.current) return () => {};
    this.walkerSubscribers.add(receive);
    return () => { this.walkerSubscribers.delete(receive); };
  }

  publishWalkers(frame: RealmWalkerFrame): void {
    if (!this.current || this.effects.size !== 1 || frame.kingdomId !== this.kingdomId || frame.origin !== this.origin
      || frame.writerEpoch !== this.writerEpoch || frame.layoutRevision !== this.layoutRevision || frame.collisionRevision !== this.world.revision) return;
    // The room's seat book owns posture. A movement publisher cannot claim a lease or a seated position.
    const parsed = RealmWalkerFrameSchema.safeParse({ ...frame, seats: this.interactions?.seats().seats ?? [] });
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > REALM_WALKER_FRAME_MAX_BYTES) return;
    // A publisher may only describe walkers admitted to this same room, never a simulated crowd or private identity.
    if (parsed.data.walkers.some(walker => !this.walkers.has(walker.id) || ![...this.effects].some(effects => effects.readWalker(walker.id)))) return;
    this.walkerFrame = parsed.data;
    this.deliverWalkers(parsed.data);
  }

  private emptyWalkers(): RealmWalkerFrame {
    return { version: 1, kingdomId: this.kingdomId, origin: this.origin, writerEpoch: this.writerEpoch,
      layoutRevision: this.layoutRevision, collisionRevision: this.world.revision, sampledAt: Date.now(), walkers: [], seats: [] };
  }

  private clearWalkers() { this.walkerFrame = null; this.deliverWalkers(this.emptyWalkers()); }
  private deliverWalkers(frame: RealmWalkerFrame) {
    for (const receive of this.walkerSubscribers) {
      try { receive(frame); } catch { this.log('walker listener failed'); }
    }
  }

  private presentWalker(walkerId: string, principal: RealmPrincipal) {
    const home = Object.values(this.state.homes).find(home => home.ownerId === principal.personId && home.layoutRevision === this.layoutRevision);
    const homeSlot = this.state.castle?.ownerId === principal.personId ? this.state.castle.slot : home?.slot ?? REALM_NO_HOME_SLOT;
    const look = principal.look && principal.look !== 'neutral' && principal.look !== 'reference' ? principal.look : starterCitizenLook(principal.personId);
    for (const effects of this.effects) effects.presentWalker?.(walkerId, { homeSlot, look });
  }

  private refreshPresentations() { for (const [id, principal] of this.principals) this.presentWalker(id, principal); }

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
    if (!this.current) return () => {};
    const detach = this.relay.bind(send, owner);
    if (this.interactions) send(this.interactions.seats());
    return detach;
  }

  /** Relays ephemeral speech/seats to the rooms present now. Never stored or replayed. */
  transient(message: RealmTransientMessage): boolean { return this.current && this.relay.transient(message); }
  /** A private reply to one person present in this kingdom. */
  toOwner(personId: string, message: RealmPrivateMessage): boolean { return this.current && this.relay.owner(personId, message); }

  onClosed(listener: (reason: string) => void): () => void {
    this.closed.add(listener);
    return () => { this.closed.delete(listener); };
  }

  /** Public geometry changed only after the exact candidate is atomically installed and discoverable. */
  onWorldAdopted(listener: () => void): () => void {
    if (!this.current) return () => {};
    this.worldAdopted.add(listener);
    return () => { this.worldAdopted.delete(listener); };
  }

  /** Bounded shutdown: stop new work, let queued commits finish, snapshot committed state, release only our own lease. */
  async dispose(): Promise<void> {
    clearInterval(this.renewal);
    const drained = await Promise.race([this.queue.then(() => true, () => true), delay(REALM_DISPOSE_WAIT_MS).then(() => false)]);
    // Hand over what committed; anything unacknowledged stays behind the durable cursor for the next writer.
    if (this.current) await Promise.race([this.dispatcher.kick(), delay(REALM_DISPOSE_WAIT_MS)]);
    if (this.current && drained) {
      try { await this.repository.snapshot(this.lease); } catch (error) { this.log(`snapshot on close failed: ${describeStorageFailure(error)}`); }
    }
    const held = this.open;
    this.close('disposed');
    if (held) await this.repository.release(this.lease).catch(error => this.log(`lease release failed: ${describeStorageFailure(error)}`));
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * One writer, a finite queue. A command is refused before it starts when the writer is gone, a dependency is held,
   * the queue is full, or it waited `REALM_COMMAND_QUEUE_WAIT_MS` without starting. A refused command never ran, so
   * the caller may retry it unchanged. Once started, it runs to its own (database-bounded) end.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (!this.current) return Promise.reject(new RealmWriterFencedError(this.kingdomId));
    const held = this.options.hold?.() ?? null;
    if (held) { this.refused.held++; return Promise.reject(new RealmHeldError(held)); }
    if (this.pending >= REALM_PENDING_COMMANDS) { this.refused.busy++; return Promise.reject(new RealmBusyError()); }
    this.pending++;
    this.pendingHighWater = Math.max(this.pendingHighWater, this.pending);
    let state: 'waiting' | 'started' | 'expired' = 'waiting';
    return new Promise<T>((resolve, reject) => {
      const expiry = setTimeout(() => {
        if (state !== 'waiting') return;
        state = 'expired'; this.refused.expired++;
        reject(new RealmBusyError());
      }, REALM_COMMAND_QUEUE_WAIT_MS);
      expiry.unref?.();
      const run = this.queue.then(async () => {
        clearTimeout(expiry);
        if (state === 'expired') return;
        state = 'started';
        if (!this.current) throw new RealmWriterFencedError(this.kingdomId);
        const late = this.options.hold?.() ?? null;
        if (late) { this.refused.held++; throw new RealmHeldError(late); }
        resolve(await work());
      }).catch(reject).finally(() => { this.pending--; });
      this.queue = run;
    });
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
    try {
      committed ??= await this.repository.load(this.lease);
      this.projection.rememberHomes(committed);
      if (!this.current) return;
      const previous = this.state;
      this.state = committed;
      if (previous.homes !== committed.homes) {
        const owners = new Set([...Object.values(previous.homes), ...Object.values(committed.homes)].map(home => home.ownerId));
        for (const owner of owners) {
          const before = Object.values(previous.homes).find(home => home.ownerId === owner && home.layoutRevision === this.layoutRevision)?.id ?? null;
          const plotId = this.ownedPlotId(owner);
          if (before !== plotId) this.toOwner(owner, { type: 'home.owned', plotId });
        }
      }
      if (previous.homes !== committed.homes || previous.castle !== committed.castle) this.refreshPresentations();
      // A durable moderation decision ends occupancy and cancels pending admission in the same refresh turn.
      for (const principal of this.principals.values()) if (committed.rights[principal.personId]?.blocked) this.interactions?.revoke(principal.personId);
    } catch (error) {
      if (error instanceof RealmWriterFencedError) { this.close('fenced'); return; }
      this.log(`state refresh failed: ${describeStorageFailure(error)}`);
    }
    // Public rows move the bootstrap prefix only as they are handed to the transport (see PublicProjection).
    await this.dispatcher.kick();
    await this.prepareWorld();
  }

  /** Async bytes preparation, then one synchronous authority/prefix/pose check and atomic room adoption. */
  private prepareWorld(): Promise<void> {
    if (!this.options.prepareWorld || !this.current) return Promise.resolve();
    this.worldNeeded = true;
    if (this.preparingWorld) return this.preparingWorld;
    this.preparingWorld = (async () => {
      while (this.worldNeeded && this.current) {
        this.worldNeeded = false;
        const state = this.state;
        try {
          const cached = this.preparedGeometry;
          const candidate = cached?.homes === state.homes && cached.castle === state.castle && cached.attachments === state.attachments
            ? cached.candidate : await this.options.prepareWorld!(state);
          if (!this.current) return;
          if (state.homes !== this.state.homes || state.castle !== this.state.castle || state.attachments !== this.state.attachments) {
            this.worldNeeded = true; continue;
          }
          this.preparedGeometry = { homes: state.homes, castle: state.castle, attachments: state.attachments, candidate };
          if (!candidate.matches(this.publicCheckpoint())) continue;
          // Geometry identity can stay fixed while committed ownership changes the authorised spawn lookup.
          if (candidate.world === this.world) { this.geometry = candidate; candidate.adopted(); continue; }
          const walkers: { id: string; position: Vec3 }[] = [];
          for (const id of this.walkers) {
            for (const effects of this.effects) {
              const walker = effects.readWalker(id);
              if (walker) { walkers.push({ id, position: [walker.x, walker.y, walker.z] }); break; }
            }
          }
          const positions = candidate.positions(walkers);
          // No await between reading occupied poses and publishing the exact matching world/receipt.
          for (const effects of this.effects) effects.adoptWorld(candidate.world, candidate.layoutRevision, positions);
          this.geometry = candidate;
          this.refreshPresentations();
          this.clearWalkers();
          this.arrivals = 0;
          candidate.adopted();
          for (const listener of this.worldAdopted) {
            try { listener(); } catch (error) { this.log(`world adoption listener failed: ${(error as Error).name}`); }
          }
        } catch (error) {
          // A failed scene never changes the committed outcome or withdraws the previous adopted world.
          this.log(`founded world preparation held: ${(error as Error).name}`);
        }
      }
    })().finally(() => { this.preparingWorld = null; });
    return this.preparingWorld;
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
      this.clockOffset = renewed.expiresAt - this.repository.leaseMs - wall;
      this.armWatchdog();
    } catch (error) {
      if (error instanceof RealmWriterFencedError) this.close('fenced');
      else if (performance.now() >= this.deadline) this.close('lease expired while the database was unreachable');
      else this.log(`lease renewal failed, retrying: ${describeStorageFailure(error)}`);
    } finally { this.renewing = false; }
  }

  private close(reason: string) {
    if (!this.open) return;
    this.open = false;
    this.detachInteractions?.();
    clearInterval(this.renewal); clearTimeout(this.watchdog);
    this.dispatcher.stop();
    this.relay.clear();
    this.worldAdopted.clear();
    this.clearWalkers();
    this.walkerSubscribers.clear();
    for (const walker of this.walkers) for (const effects of this.effects) effects.allowWalking(walker, false);
    for (const effects of this.effects) {
      try { effects.close(reason === 'disposed' ? 'shutdown' : 'authority-lost'); }
      catch { this.log('room close callback failed'); }
    }
    if (reason !== 'disposed') this.log(`writer authority closed for kingdom ${this.kingdomId}: ${reason}`);
    for (const listener of this.closed) listener(reason);
  }

  private log(line: string) { this.options.log?.(`[realm] ${line}`); }

  private ownedPlotId(personId: PersonId): string | null {
    return Object.values(this.state.homes).find(home => home.ownerId === personId && home.layoutRevision === this.layoutRevision)?.id ?? null;
  }
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
   * Opening renews its held epoch while this awaits; the loader never acquires another writer. */
  readonly kingdom: (kingdomId: KingdomId, state: RealmPrivateState) => DurableKingdomOptions | Promise<DurableKingdomOptions>;
  /**
   * Trusted work after the lease is held and before the first walker enters, such as installing deeds left pending
   * by an interrupted allocation. Its failure is logged; it never fails the open or skips the lease.
   */
  readonly afterOpen?: (kingdom: DurableKingdom) => Promise<unknown>;
  readonly attach?: (kingdom: DurableKingdom) => () => void;
  readonly hold?: () => string | null;
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
        return { ...options, ...(input.hold ? { hold: input.hold } : {}), ...(input.log ? { log: input.log } : {}) };
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
  publishWalkers(frame: RealmWalkerFrame) { this.k.publishWalkers(frame); }
  bindRoom(effects: RealmRoomEffects) { return this.k.bindRoom(effects); }
  lifecycle(event: RealmLifecycleEvent, principal: RealmPrincipal, walkerId: string, now: number) { this.k.lifecycle(event, principal, walkerId, now); }
  subscribe(deliver: (message: RealmPublicDelivery) => void) { return this.k.subscribe(deliver); }
  bindTransient(send: (message: RealmTransientMessage) => void, owner: (personId: string, message: RealmPrivateMessage) => void) { return this.k.bindTransient(send, owner); }
  dispose() { return this.hold.release(); }
}
