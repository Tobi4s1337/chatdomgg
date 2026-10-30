import { performance } from 'node:perf_hooks';
import { ServerError } from '@colyseus/core';
import type { KingdomId, PersonId, EventCause } from '@chatdom/shared';
import type { CollisionWorld, RealmAuthenticator, RealmBootstrap, RealmCapability, RealmDomainCommand, RealmIngressCheckpoint, RealmIngressTransition,
  RealmIntent, RealmPrincipal, RealmPrivateState, RealmPublicDelivery, RealmPublicMessage, RealmReceipt, RealmRepository,
  RealmStoredOutcome, RealmWriterLease } from '@chatdom/shared/realm';
import { decideRealm } from '@chatdom/world/realm';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import type { RealmIntentContext, RealmRoomEffects, RealmRoomHandle, RealmRoomServices } from '../ports';
import { RealmCommitUncertainError, RealmLeaseHeldError, RealmWriterFencedError, describeStorageFailure } from './database';
import { REALM_BASE_ANVILS, type PostgresRealmRepository, type RealmOutboxRow } from './postgres-repository';

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
export type DurableRepository = RealmRepository & Pick<PostgresRealmRepository, 'readOutbox' | 'publishedPlots' | 'latestPresence' | 'committedState' | 'snapshot' | 'leaseMs'>;

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
  private cursor: number;
  private pumping: Promise<void> = Promise.resolve();
  private latestPresence: RealmPublicMessage | null;
  private publicSequence: number;
  private readonly publicHomes = new Map<string, Extract<RealmPublicMessage, { type: 'home' }>>();
  private readonly walkers = new Set<string>();
  private readonly principals = new Map<string, RealmPrincipal>();
  private readonly effects = new Set<RealmRoomEffects>();
  private readonly listeners = new Set<(message: RealmPublicDelivery) => void>();
  private readonly closed = new Set<(reason: string) => void>();

  static async open(repository: DurableRepository, kingdomId: KingdomId, options: DurableKingdomOptions): Promise<DurableKingdom> {
    const started = performance.now();
    const lease = await repository.acquire(kingdomId);
    try {
      const state = await repository.load(lease);
      const { plots, cursor } = await repository.publishedPlots(kingdomId);
      const recent = await repository.latestPresence(kingdomId);
      return new DurableKingdom(repository, lease, state, options, plots, cursor, recent, started);
    } catch (error) {
      await repository.release(lease).catch(() => {});
      throw error;
    }
  }

  private constructor(private readonly repository: DurableRepository, lease: RealmWriterLease, state: RealmPrivateState,
    private readonly options: DurableKingdomOptions, published: Set<string>, cursor: number, presence: RealmPublicMessage | null, started: number) {
    this.lease = lease; this.state = state; this.origin = state.origin; this.writerEpoch = lease.epoch;
    this.cursor = cursor; this.latestPresence = presence; this.publicSequence = state.sequence;
    for (const plot of published) {
      const home = state.homes[plot];
      if (home) this.publicHomes.set(plot, { type: 'home', plotId: home.id, revision: home.revision, assetHash: home.digest,
        attachments: Object.values(home.attachments).flatMap(id => state.attachments[id] ? [state.attachments[id].attachment] : []) });
    }
    this.deadline = started + repository.leaseMs - LEASE_MARGIN_MS;
    this.renewal = setInterval(() => void this.renew(), Math.floor(repository.leaseMs / 3));
    this.renewal.unref?.();
    this.armWatchdog();
    this.log(`opened ${state.origin} kingdom ${state.kingdomId} at fact ${state.sequence}`);
  }

  get kingdomId(): KingdomId { return this.lease.kingdomId; }
  get layoutRevision(): string { return this.options.layoutRevision; }
  get world(): CollisionWorld { return this.options.world; }
  get sequence(): number { return this.state.sequence; }
  /** Private committed state for trusted in-process services. Never a public or Schema payload. */
  get privateState(): RealmPrivateState { return this.state; }
  /** True only while this process holds an unexpired lease by its own conservative clock. */
  get current(): boolean { return this.open && performance.now() < this.deadline; }

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

  bootstrap(principal: RealmPrincipal): RealmBootstrap {
    void principal;
    const current: RealmPublicMessage[] = [];
    if (this.latestPresence) current.push(this.latestPresence);
    for (const plot of [...this.publicHomes.keys()].sort()) current.push(this.publicHomes.get(plot)!);
    return { version: 1, kingdomId: this.kingdomId, writerEpoch: this.writerEpoch, throughSequence: this.publicSequence, throughCursor: this.cursor,
      layoutRevision: this.layoutRevision, collisionRevision: this.world.revision, current };
  }

  bindRoom(effects: RealmRoomEffects): () => void {
    if (!this.current) { effects.close('authority-lost'); return () => {}; }
    this.effects.add(effects);
    return () => { this.effects.delete(effects); };
  }

  lifecycle(event: 'join' | 'drop' | 'reconnect' | 'leave', principal: RealmPrincipal, walkerId: string): void {
    if (event === 'leave') { this.walkers.delete(walkerId); this.principals.delete(walkerId); return; }
    this.walkers.add(walkerId); this.principals.set(walkerId, principal);
    if (!this.current) for (const effects of this.effects) effects.allowWalking(walkerId, false);
  }

  subscribe(deliver: (message: RealmPublicDelivery) => void): () => void {
    if (!this.current) return () => {};
    this.listeners.add(deliver);
    return () => { this.listeners.delete(deliver); };
  }

  bindTransient(): () => void {
    // Transient chat and seats are composed by the wiring lane; this durable handle never stores them.
    return () => {};
  }

  onClosed(listener: (reason: string) => void): () => void {
    this.closed.add(listener);
    return () => { this.closed.delete(listener); };
  }

  /** Bounded shutdown: stop new work, let queued commits finish, snapshot committed state, release only our own lease. */
  async dispose(): Promise<void> {
    clearInterval(this.renewal);
    const drained = await Promise.race([this.queue.then(() => true, () => true), delay(DISPOSE_WAIT_MS).then(() => false)]);
    await this.pumping.catch(() => {});
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

  /** Adopt the committed state, then deliver what that commit published. A refresh failure never un-commits work. */
  private async refresh() {
    const cached = this.repository.committedState(this.lease);
    if (cached) this.state = cached;
    else {
      try { this.state = await this.repository.load(this.lease); }
      catch (error) { if (error instanceof RealmWriterFencedError) this.close('fenced'); else this.log(`state refresh failed: ${describeStorageFailure(error)}`); }
    }
    this.pumping = this.pumping.then(() => this.pump());
    await this.pumping;
  }

  /** Applies each committed public row and cursor before notifying listeners at that exact prefix. */
  private async pump(): Promise<void> {
    for (;;) {
      if (!this.current) return;
      let rows: RealmOutboxRow[];
      try { rows = await this.repository.readOutbox(this.kingdomId, this.cursor, 256); }
      catch (error) { this.log(`outbox read failed: ${describeStorageFailure(error)}`); return; }
      if (!this.current || rows.length === 0) return;
      for (const row of rows) {
        if (!this.current) return;
        if (row.message.type === 'home') this.publicHomes.set(row.message.plotId, row.message);
        if (row.message.type === 'presence') this.latestPresence = row.message;
        const delivery: RealmPublicDelivery = { version: 1, kingdomId: this.kingdomId, writerEpoch: this.writerEpoch, sequence: row.sequence, cursor: row.id, eventId: row.eventId, message: row.message };
        this.cursor = row.id; this.publicSequence = Math.max(this.publicSequence, row.sequence);
        for (const listener of this.listeners) { try { listener(delivery); } catch (error) { this.log(`delivery listener failed: ${(error as Error).name}`); } }
      }
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
      const renewed = await this.repository.renew(this.lease);
      // A response after the old deadline cannot revive a closed authority.
      if (!this.current) { this.close('lease deadline passed'); return; }
      this.lease = renewed;
      this.deadline = started + this.repository.leaseMs - LEASE_MARGIN_MS;
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
    clearInterval(this.renewal); clearTimeout(this.watchdog);
    this.listeners.clear();
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

/**
 * Durable `RealmRoomServices`: the injected authenticator plus kingdoms opened under exclusive Postgres writer leases.
 * The registry is an in-process service capability for trusted callers, never a browser-facing URL.
 */
export function createDurableRealmServices(input: {
  readonly repository: DurableRepository;
  readonly auth: RealmAuthenticator;
  /** World, layout revision and arrivals for a kingdom (a live kingdom reads its adopted founded layout here). */
  readonly kingdom: (kingdomId: KingdomId) => DurableKingdomOptions | Promise<DurableKingdomOptions>;
  /**
   * Trusted work after the lease is held and before the first walker enters, such as installing deeds left pending
   * by an interrupted allocation. Its failure is logged; it never fails the open or skips the lease.
   */
  readonly afterOpen?: (kingdom: DurableKingdom) => Promise<unknown>;
  readonly log?: (line: string) => void;
}): RealmRoomServices & { readonly kingdoms: ReadonlyMap<KingdomId, DurableKingdom> } {
  const kingdoms = new Map<KingdomId, DurableKingdom>();
  return {
    auth: input.auth,
    kingdoms,
    async open(kingdomId) {
      const prior = kingdoms.get(kingdomId);
      if (prior?.current) throw new ServerError(409, 'This kingdom is already open on this server.');
      let kingdom: DurableKingdom;
      try {
        const options = await input.kingdom(kingdomId);
        kingdom = await DurableKingdom.open(input.repository, kingdomId, { ...options, ...(input.log ? { log: input.log } : {}) });
      } catch (error) {
        if (error instanceof RealmLeaseHeldError) throw new ServerError(409, 'Another server holds this kingdom right now. Try again in a moment.');
        input.log?.(`[realm] kingdom ${kingdomId} did not open: ${describeStorageFailure(error)}`);
        throw new ServerError(503, 'The kingdom could not be opened from storage. Nothing was changed.');
      }
      kingdoms.set(kingdomId, kingdom);
      kingdom.onClosed(() => { if (kingdoms.get(kingdomId) === kingdom) kingdoms.delete(kingdomId); });
      if (input.afterOpen) {
        try { await input.afterOpen(kingdom); }
        catch (error) { input.log?.(`[realm] kingdom ${kingdomId} opened, but its open-time recovery did not finish: ${describeStorageFailure(error)}`); }
      }
      return kingdom;
    },
  };
}
