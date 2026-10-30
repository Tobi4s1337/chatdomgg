import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import type { RealmDecision, RealmDomainCommand, RealmFact, RealmIngressCheckpoint, RealmIngressTransition, RealmPrivateState,
  RealmPublicMessage, RealmRepository, RealmStoredOutcome, RealmWriterLease } from '@chatdom/shared/realm';
import type { PresenceInput } from '@chatdom/shared';
import { applyRealmFact, createRealmState, decideRealm } from '@chatdom/world/realm';
import { canonicalJson, digestOf, sha256Hex } from './codec';
import { RealmCommitUncertainError, RealmLeaseHeldError, RealmRecoveryError, RealmStorageUnavailableError, RealmWriterFencedError, type RealmDatabase } from './database';

/** Writer lease length. The holder renews at a third of this; an expired lease can never write again. */
export const REALM_LEASE_MS = 15_000;
/** R3: a snapshot after this many facts, in the same transaction as the fact it covers. */
export const REALM_SNAPSHOT_EVERY = 1_000;
/** Tech.md: two anvils before the presence bonus. Callers that know the crowd pass the current capacity. */
export const REALM_BASE_ANVILS = 2;

const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';

type Tx = pg.PoolClient;
/** Extra durable constraints checked inside the commit, before anything is written (allocation receipts, …). */
export type RealmCommitGuard = (tx: Tx, fact: RealmFact, prior: RealmPrivateState) => Promise<'ok' | 'conflict'>;

export interface PostgresRealmRepositoryOptions {
  /** A live repository never opens a simulated kingdom, and the reverse. */
  readonly origin: 'live' | 'simulated';
  readonly leaseMs?: number;
  readonly snapshotEvery?: number;
  readonly anvilCapacity?: number;
  readonly guards?: readonly RealmCommitGuard[];
}

/** The committed public rows produced by one transaction, in delivery order. */
export interface RealmOutboxRow { readonly id: number; readonly sequence: number; readonly eventId: string; readonly plotId: string | null; readonly message: RealmPublicMessage }

interface Fence { readonly sequence: number; readonly now: number }
interface Written { readonly fact: RealmFact; readonly next: RealmPrivateState; readonly public: readonly RealmPublicMessage[]; readonly commandId: string }

/**
 * The one durable realm writer (spec 34 R1–R3). Every write locks the kingdom row, compares the caller's epoch with
 * an unexpired lease on database time, compares the expected sequence and writes fact, command outcome, coal ledger,
 * design claims, snapshot and public outbox in one transaction. The final fence is the last statement before COMMIT,
 * and a takeover needs the same row lock, so a commit is always ordered before any newer epoch.
 */
export class PostgresRealmRepository implements RealmRepository {
  readonly origin: 'live' | 'simulated';
  readonly leaseMs: number;
  private readonly snapshotEvery: number;
  private readonly anvilCapacity: number;
  private readonly guards: readonly RealmCommitGuard[];
  /** Committed state per held lease. Valid only while its sequence equals the locked row's sequence. */
  private readonly cache = new Map<string, RealmPrivateState>();

  constructor(private readonly db: RealmDatabase, options: PostgresRealmRepositoryOptions) {
    this.origin = options.origin;
    this.leaseMs = bounded(options.leaseMs ?? REALM_LEASE_MS, 1_000, 120_000, 'leaseMs');
    this.snapshotEvery = bounded(options.snapshotEvery ?? REALM_SNAPSHOT_EVERY, 1, 100_000, 'snapshotEvery');
    this.anvilCapacity = bounded(options.anvilCapacity ?? REALM_BASE_ANVILS, 1, 64, 'anvilCapacity');
    this.guards = [claimDesign, ...(options.guards ?? [])];
  }

  async acquire(kingdomId: KingdomId): Promise<RealmWriterLease> {
    KingdomIdSchema.parse(kingdomId);
    return this.transaction(async tx => {
      await tx.query(`INSERT INTO realm_kingdoms (kingdom_id, origin, created_ms) VALUES ($1, $2, ${NOW_MS}) ON CONFLICT (kingdom_id) DO NOTHING`, [kingdomId, this.origin]);
      const row = (await tx.query<{ origin: string; held: boolean }>(
        `SELECT origin, coalesce(lease_expires_ms > ${NOW_MS}, false) AS held FROM realm_kingdoms WHERE kingdom_id = $1 FOR UPDATE`, [kingdomId])).rows[0]!;
      if (row.origin !== this.origin) throw new RealmStorageUnavailableError(`Kingdom ${kingdomId} is ${row.origin}; this ${this.origin} realm cannot open it.`);
      if (row.held) throw new RealmLeaseHeldError(kingdomId);
      const epoch = randomBytes(32).toString('hex');
      const lease = (await tx.query<{ expires: string }>(
        `UPDATE realm_kingdoms SET writer_epoch = $2, writer_generation = writer_generation + 1, lease_expires_ms = ${NOW_MS} + $3
         WHERE kingdom_id = $1 RETURNING lease_expires_ms AS expires`, [kingdomId, epoch, this.leaseMs])).rows[0]!;
      return { kingdomId, epoch, expiresAt: Number(lease.expires) };
    });
  }

  async renew(lease: RealmWriterLease): Promise<RealmWriterLease> {
    const row = (await this.db.query<{ expires: string }>(
      `UPDATE realm_kingdoms SET lease_expires_ms = ${NOW_MS} + $3
       WHERE kingdom_id = $1 AND writer_epoch = $2 AND lease_expires_ms > ${NOW_MS} RETURNING lease_expires_ms AS expires`,
      [lease.kingdomId, lease.epoch, this.leaseMs])).rows[0];
    if (!row) { this.forget(lease); throw new RealmWriterFencedError(lease.kingdomId); }
    return { ...lease, expiresAt: Number(row.expires) };
  }

  /** Releases only this epoch; another writer's newer lease is untouched. */
  async release(lease: RealmWriterLease): Promise<void> {
    this.forget(lease);
    await this.db.query(`UPDATE realm_kingdoms SET writer_epoch = NULL, lease_expires_ms = NULL WHERE kingdom_id = $1 AND writer_epoch = $2`, [lease.kingdomId, lease.epoch]);
  }

  async load(lease: RealmWriterLease): Promise<RealmPrivateState> {
    return this.transaction(async tx => {
      const fence = await this.fence(tx, lease);
      const state = await this.replay(tx, lease.kingdomId, fence.sequence);
      this.cache.set(key(lease), state);
      return state;
    });
  }

  /**
   * Final answer for a command. The shared row lock waits out any writer transaction still holding the kingdom,
   * so a null here means the command was not committed, not that its commit is still in flight.
   */
  async lookup(kingdomId: KingdomId, commandId: string): Promise<RealmStoredOutcome | null> {
    return this.transaction(async tx => {
      await tx.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1 FOR SHARE', [kingdomId]);
      const row = (await tx.query<OutcomeRow>('SELECT status, sequence, reason, decided_ms FROM realm_commands WHERE kingdom_id = $1 AND command_id = $2', [kingdomId, commandId])).rows[0];
      return row ? outcome(row) : null;
    });
  }

  async execute(lease: RealmWriterLease, commandId: string, command: RealmDomainCommand,
    decide: (state: RealmPrivateState, now: number) => RealmDecision, current: () => boolean): Promise<RealmStoredOutcome> {
    if (!commandId || commandId.length > 128) throw new TypeError('A command needs a 1–128 character id');
    const digest = digestOf(command);
    return this.commit(lease, commandId, async (tx, fence, state) => {
      const prior = await storedCommand(tx, lease.kingdomId, commandId);
      // Committed and unchanged are final. A rejection is the latest answer: the command may be asked again (a night's credit
      // held before ten covered minutes must not stay held forever). Reusing an id for another payload is a conflict.
      if (prior && prior.digest !== digest) return { done: { status: 'rejected', reason: 'conflict' } };
      if (prior && (prior.status === 'committed' || prior.status === 'unchanged')) return { done: outcome(prior) };
      // Cancelled before deciding: nothing is stored, so the command stays undecided and retryable by the next writer.
      if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
      const decision = decide(state, fence.now);
      if (decision.kind !== 'accepted') {
        if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
        await recordCommand(tx, lease, commandId, digest, { status: decision.kind, reason: decision.reason }, fence.now);
        return { written: [], result: { status: decision.kind, reason: decision.reason } };
      }
      const written = this.check(lease, state, decision, commandId);
      const conflict = await this.guard(tx, written.fact, state);
      if (conflict) {
        if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
        await recordCommand(tx, lease, commandId, digest, { status: 'rejected', reason: 'conflict' }, fence.now);
        return { written: [], result: { status: 'rejected', reason: 'conflict' } };
      }
      if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
      await this.writeFact(tx, lease, written, state, fence.now);
      const result: RealmStoredOutcome = { status: 'committed', sequence: written.fact.seq, at: fence.now };
      await recordCommand(tx, lease, commandId, digest, result, fence.now);
      return { written: [written], result };
    });
  }

  async loadIngress(lease: RealmWriterLease): Promise<RealmIngressCheckpoint | null> {
    return this.transaction(async tx => {
      await this.fence(tx, lease);
      return checkpointRow(tx, lease.kingdomId);
    });
  }

  async executeIngress(lease: RealmWriterLease,
    input: { readonly source: 'herald' | 'panel' | 'walker'; readonly digest: string; readonly receivedAt: number; readonly observation: PresenceInput },
    transition: (state: RealmPrivateState, checkpoint: RealmIngressCheckpoint | null, now: number) => RealmIngressTransition,
    current: () => boolean): Promise<RealmStoredOutcome> {
    if (!/^[a-f0-9]{64}$/.test(input.digest)) throw new TypeError('Ingress digest must be a SHA-256 hex digest');
    const observation = input.observation, id = `${input.source}:${observation.id}`;
    return this.commit(lease, id, async (tx, fence, state) => {
      const prior = (await tx.query<OutcomeRow & { digest: string }>(
        'SELECT digest, status, sequence, reason, decided_ms FROM realm_ingress_receipts WHERE kingdom_id = $1 AND source = $2 AND observation_id = $3',
        [lease.kingdomId, input.source, observation.id])).rows[0];
      if (prior) return { done: prior.digest === input.digest ? outcome(prior) : { status: 'rejected', reason: 'conflict' } };
      const origin = observation.origin === 'simulated' ? 'simulated' : 'live';
      if (observation.kingdomId !== lease.kingdomId || origin !== state.origin || input.receivedAt > fence.now) return { done: { status: 'rejected', reason: 'conflict' } };
      if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
      const checkpoint = await checkpointRow(tx, lease.kingdomId);
      const next = transition(state, checkpoint, fence.now);
      if (next.checkpoint.version !== 1 || next.checkpoint.codec !== 'presence-v1' || next.checkpoint.revision !== (checkpoint?.revision ?? 0) + 1
        || next.presence.kingdomId !== lease.kingdomId || next.presence.origin !== state.origin) return { done: { status: 'rejected', reason: 'conflict' } };
      const written: Written[] = [];
      let s = state;
      const ids = new Set<string>();
      for (const { command, capability, commandId } of next.commands) {
        if (ids.has(commandId)) return { done: { status: 'rejected', reason: 'conflict' } };
        ids.add(commandId);
        const digest = digestOf(command), stored = await storedCommand(tx, lease.kingdomId, commandId);
        if (stored && stored.digest !== digest) return { done: { status: 'rejected', reason: 'conflict' } };
        if (stored && (stored.status === 'committed' || stored.status === 'unchanged')) continue;
        const decision = decideRealm(s, command, { now: fence.now, writerEpoch: lease.epoch, commandId, capability, current: current(), anvilCapacity: this.anvilCapacity,
          occurredAt: observation.observedAt, receivedAt: input.receivedAt, actor: null, cause: { kind: 'external', source: input.source, id: observation.id } });
        if (decision.kind !== 'accepted') {
          if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
          await recordCommand(tx, lease, commandId, digest, { status: decision.kind, reason: decision.reason }, fence.now);
          continue;
        }
        const fact = this.check(lease, s, decision, commandId);
        if (await this.guard(tx, fact.fact, s)) {
          await recordCommand(tx, lease, commandId, digest, { status: 'rejected', reason: 'conflict' }, fence.now);
          continue;
        }
        await this.writeFact(tx, lease, fact, s, fence.now);
        await recordCommand(tx, lease, commandId, digest, { status: 'committed', sequence: fact.fact.seq, at: fence.now }, fence.now);
        written.push(fact);
        s = fact.next;
      }
      if (!current()) return { done: { status: 'rejected', reason: 'cold' } };
      await insertOutbox(tx, lease.kingdomId, s.sequence, `${lease.kingdomId}:${s.sequence}:p${next.checkpoint.revision}`, null, { type: 'presence', frame: next.presence }, fence.now);
      await tx.query(`INSERT INTO realm_ingress_checkpoints (kingdom_id, revision, codec, data, updated_ms) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (kingdom_id) DO UPDATE SET revision = excluded.revision, codec = excluded.codec, data = excluded.data, updated_ms = excluded.updated_ms`,
      [lease.kingdomId, next.checkpoint.revision, next.checkpoint.codec, Buffer.from(next.checkpoint.data), fence.now]);
      const result: RealmStoredOutcome = { status: 'committed', sequence: s.sequence, at: fence.now };
      await tx.query(`INSERT INTO realm_ingress_receipts (kingdom_id, source, observation_id, digest, status, sequence, reason, checkpoint_revision, writer_epoch, decided_ms)
        VALUES ($1, $2, $3, $4, 'committed', $5, NULL, $6, $7, $8)`,
      [lease.kingdomId, input.source, observation.id, input.digest, s.sequence, next.checkpoint.revision, lease.epoch, fence.now]);
      return { written, result };
    });
  }

  /** Committed public rows after `afterId`, in commit order. Delivery is at-least-once; event IDs are stable. */
  async readOutbox(kingdomId: KingdomId, afterId: number, limit = 256): Promise<RealmOutboxRow[]> {
    const rows = await this.db.query<{ id: string; sequence: string; event_id: string; plot_id: string | null; message: string }>(
      'SELECT id, sequence, event_id, plot_id, message FROM realm_outbox WHERE kingdom_id = $1 AND id > $2 ORDER BY id LIMIT $3', [kingdomId, afterId, Math.min(Math.max(1, limit), 1024)]);
    return rows.rows.map(r => ({ id: Number(r.id), sequence: Number(r.sequence), eventId: r.event_id, plotId: r.plot_id, message: JSON.parse(r.message) as RealmPublicMessage }));
  }

  /** Plots that have ever been published, and the outbox cursor they were read at. */
  async publishedPlots(kingdomId: KingdomId): Promise<{ plots: Set<string>; cursor: number }> {
    const plots = await this.db.query<{ plot_id: string }>('SELECT DISTINCT plot_id FROM realm_outbox WHERE kingdom_id = $1 AND plot_id IS NOT NULL', [kingdomId]);
    const cursor = await this.db.query<{ id: string | null }>('SELECT max(id) AS id FROM realm_outbox WHERE kingdom_id = $1', [kingdomId]);
    return { plots: new Set(plots.rows.map(r => r.plot_id)), cursor: Number(cursor.rows[0]?.id ?? 0) };
  }

  /** The newest committed presence frame: the current public crowd, not a replay of history. */
  async latestPresence(kingdomId: KingdomId): Promise<RealmPublicMessage | null> {
    const row = (await this.db.query<{ message: string }>(`SELECT message FROM realm_outbox WHERE kingdom_id = $1 AND kind = 'presence' ORDER BY id DESC LIMIT 1`, [kingdomId])).rows[0];
    return row ? JSON.parse(row.message) as RealmPublicMessage : null;
  }

  /** The committed state this process holds for its lease, if it is still known to match the database. */
  committedState(lease: RealmWriterLease): RealmPrivateState | null {
    return this.cache.get(key(lease)) ?? null;
  }

  /** Writes a snapshot of the committed state for this lease (graceful shutdown, offline). */
  async snapshot(lease: RealmWriterLease): Promise<number> {
    return this.transaction(async tx => {
      const fence = await this.fence(tx, lease);
      const cached = this.cache.get(key(lease));
      const state = cached?.sequence === fence.sequence ? cached : await this.replay(tx, lease.kingdomId, fence.sequence);
      await writeSnapshot(tx, state, fence.now);
      await this.finalFence(tx, lease, fence.sequence, fence.sequence);
      return state.sequence;
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  private async commit(lease: RealmWriterLease, label: string,
    work: (tx: Tx, fence: Fence, state: RealmPrivateState) => Promise<{ done: RealmStoredOutcome } | { written: readonly Written[]; result: RealmStoredOutcome }>): Promise<RealmStoredOutcome> {
    const tx = await this.connect();
    let phase: 'open' | 'committing' | 'committed' = 'open';
    try {
      await tx.query('BEGIN');
      const fence = await this.fence(tx, lease);
      const cached = this.cache.get(key(lease));
      const state = cached?.sequence === fence.sequence ? cached : await this.replay(tx, lease.kingdomId, fence.sequence);
      const step = await work(tx, fence, state);
      if ('done' in step) { await tx.query('ROLLBACK'); return step.done; }
      const last = step.written.at(-1);
      await this.finalFence(tx, lease, fence.sequence, last ? last.fact.seq : fence.sequence);
      phase = 'committing';
      await tx.query('COMMIT');
      phase = 'committed';
      this.cache.set(key(lease), last ? last.next : state);
      return step.result;
    } catch (error) {
      if (phase === 'committing') {
        // The server may have committed. Only a lookup can tell; the cached state is no longer trustworthy.
        this.cache.delete(key(lease));
        throw new RealmCommitUncertainError(lease.kingdomId, label);
      }
      await tx.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      // A connection whose COMMIT reply was lost is discarded rather than reused.
      tx.release(phase === 'committing' ? true : undefined);
    }
  }

  private async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = await this.connect();
    try {
      await tx.query('BEGIN');
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { tx.release(); }
  }

  private async connect(): Promise<Tx> {
    try { return await this.db.connect(); }
    catch { throw new RealmStorageUnavailableError('The realm database is unavailable.'); }
  }

  /** Lock the kingdom row and prove this epoch is the current unexpired writer on database time. */
  private async fence(tx: Tx, lease: RealmWriterLease): Promise<Fence> {
    const row = (await tx.query<{ sequence: string; mine: boolean; now: string; origin: string }>(
      `SELECT sequence, origin, (writer_epoch = $2 AND lease_expires_ms > ${NOW_MS}) IS TRUE AS mine, ${NOW_MS} AS now
       FROM realm_kingdoms WHERE kingdom_id = $1 FOR UPDATE`, [lease.kingdomId, lease.epoch])).rows[0];
    if (!row?.mine) { this.forget(lease); throw new RealmWriterFencedError(lease.kingdomId); }
    if (row.origin !== this.origin) throw new RealmStorageUnavailableError(`Kingdom ${lease.kingdomId} is ${row.origin}; this ${this.origin} realm cannot write it.`);
    return { sequence: Number(row.sequence), now: Number(row.now) };
  }

  /** The last statement before COMMIT: still our unexpired epoch, still the sequence we read. */
  private async finalFence(tx: Tx, lease: RealmWriterLease, expected: number, next: number) {
    const moved = await tx.query(`UPDATE realm_kingdoms SET sequence = $4
      WHERE kingdom_id = $1 AND writer_epoch = $2 AND lease_expires_ms > ${NOW_MS} AND sequence = $3`, [lease.kingdomId, lease.epoch, expected, next]);
    if (moved.rowCount !== 1) { this.forget(lease); throw new RealmWriterFencedError(lease.kingdomId); }
  }

  /** One valid snapshot plus the contiguous digested tail, replayed by the world reducer. Fails closed. */
  private async replay(tx: Tx, kingdomId: KingdomId, through: number): Promise<RealmPrivateState> {
    const snap = (await tx.query<{ seq: string; version: number; state: string; digest: string }>(
      'SELECT seq, version, state, digest FROM realm_snapshots WHERE kingdom_id = $1 AND seq <= $2 ORDER BY seq DESC LIMIT 1', [kingdomId, through])).rows[0];
    let state: RealmPrivateState;
    if (snap) {
      if (snap.version !== 1) throw new RealmRecoveryError(kingdomId, `unsupported snapshot version ${snap.version}`);
      if (sha256Hex(snap.state) !== snap.digest) throw new RealmRecoveryError(kingdomId, `snapshot ${snap.seq} fails its digest`);
      state = JSON.parse(snap.state) as RealmPrivateState;
      if (state.version !== 1 || state.kingdomId !== kingdomId || state.sequence !== Number(snap.seq) || state.origin !== this.origin) throw new RealmRecoveryError(kingdomId, `snapshot ${snap.seq} does not belong to this kingdom`);
    } else state = createRealmState(kingdomId, this.origin);
    const tail = await tx.query<{ seq: string; fact: string; digest: string }>('SELECT seq, fact, digest FROM realm_facts WHERE kingdom_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq', [kingdomId, state.sequence, through]);
    for (const row of tail.rows) {
      if (Number(row.seq) !== state.sequence + 1) throw new RealmRecoveryError(kingdomId, `history gap after fact ${state.sequence}`);
      if (sha256Hex(row.fact) !== row.digest) throw new RealmRecoveryError(kingdomId, `fact ${row.seq} fails its digest`);
      try { state = applyRealmFact(state, JSON.parse(row.fact) as RealmFact); }
      catch { throw new RealmRecoveryError(kingdomId, `fact ${row.seq} cannot be replayed`); }
    }
    if (state.sequence !== through) throw new RealmRecoveryError(kingdomId, `history ends at ${state.sequence}, expected ${through}`);
    return state;
  }

  /** A decision becomes a write only if it is exactly the next fact of this kingdom under this epoch. */
  private check(lease: RealmWriterLease, state: RealmPrivateState, decision: Extract<RealmDecision, { kind: 'accepted' }>, commandId: string): Written {
    const f = decision.fact;
    if (f.version !== 1 || f.kingdomId !== lease.kingdomId || f.writerEpoch !== lease.epoch || f.seq !== state.sequence + 1 || f.origin !== state.origin || f.type !== 'realm.transaction') {
      throw new RealmRecoveryError(lease.kingdomId, 'a decision proposed a fact out of continuity');
    }
    // The stored state is always what replay will produce, never a decision's own copy.
    return { fact: f, next: applyRealmFact(state, f), public: decision.public, commandId };
  }

  private async guard(tx: Tx, fact: RealmFact, prior: RealmPrivateState): Promise<boolean> {
    for (const guard of this.guards) if (await guard(tx, fact, prior) === 'conflict') return true;
    return false;
  }

  private async writeFact(tx: Tx, lease: RealmWriterLease, w: Written, prior: RealmPrivateState, now: number) {
    const text = canonicalJson(w.fact);
    await tx.query('INSERT INTO realm_facts (kingdom_id, seq, writer_epoch, command_id, fact, digest, committed_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [lease.kingdomId, w.fact.seq, lease.epoch, w.commandId, text, sha256Hex(text), now]);
    for (const person of new Set([...Object.keys(prior.coals), ...Object.keys(w.next.coals)])) {
      const before = prior.coals[person] ?? 0, after = w.next.coals[person] ?? 0;
      if (before !== after) await tx.query('INSERT INTO realm_coal_ledger (kingdom_id, seq, person_id, delta, balance, reason) VALUES ($1, $2, $3, $4, $5, $6)',
        [lease.kingdomId, w.fact.seq, person, after - before, after, w.fact.body.type]);
    }
    for (const [position, message] of w.public.entries()) {
      await insertOutbox(tx, lease.kingdomId, w.fact.seq, `${lease.kingdomId}:${w.fact.seq}:${position}`, plotOf(message, w.next), message, now);
    }
    if (w.fact.seq % this.snapshotEvery === 0) await writeSnapshot(tx, w.next, now);
  }

  private forget(lease: RealmWriterLease) { this.cache.delete(key(lease)); }
}

type OutcomeRow = { status: 'committed' | 'unchanged' | 'rejected'; sequence: string | null; reason: string | null; decided_ms: string };

function outcome(row: OutcomeRow): RealmStoredOutcome {
  return row.status === 'committed' ? { status: 'committed', sequence: Number(row.sequence), at: Number(row.decided_ms) } : { status: row.status, reason: row.reason ?? 'unknown' };
}

async function storedCommand(tx: Tx, kingdomId: string, commandId: string) {
  return (await tx.query<OutcomeRow & { digest: string }>('SELECT digest, status, sequence, reason, decided_ms FROM realm_commands WHERE kingdom_id = $1 AND command_id = $2 FOR UPDATE', [kingdomId, commandId])).rows[0];
}

async function recordCommand(tx: Tx, lease: RealmWriterLease, commandId: string, digest: string, result: RealmStoredOutcome, now: number) {
  // Only a rejection is replaced; both committed and unchanged outcomes are terminal.
  const written = await tx.query(`INSERT INTO realm_commands (kingdom_id, command_id, digest, status, sequence, reason, writer_epoch, decided_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (kingdom_id, command_id) DO UPDATE SET status = excluded.status, sequence = excluded.sequence, reason = excluded.reason,
      writer_epoch = excluded.writer_epoch, decided_ms = excluded.decided_ms
    WHERE realm_commands.status = 'rejected' AND realm_commands.digest = excluded.digest`,
  [lease.kingdomId, commandId, digest, result.status, result.status === 'committed' ? result.sequence : null, result.status === 'committed' ? null : result.reason, lease.epoch, now]);
  if (written.rowCount !== 1) throw new RealmRecoveryError(lease.kingdomId, `command ${commandId} already has a final outcome`);
}

async function insertOutbox(tx: Tx, kingdomId: string, sequence: number, eventId: string, plotId: string | null, message: RealmPublicMessage, now: number) {
  await tx.query('INSERT INTO realm_outbox (kingdom_id, sequence, event_id, kind, plot_id, message, created_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [kingdomId, sequence, eventId, message.type, plotId, canonicalJson(message), now]);
}

async function writeSnapshot(tx: Tx, state: RealmPrivateState, now: number) {
  const text = canonicalJson(state);
  await tx.query(`INSERT INTO realm_snapshots (kingdom_id, seq, version, state, digest, created_ms) VALUES ($1, $2, 1, $3, $4, $5)
    ON CONFLICT (kingdom_id, seq) DO NOTHING`, [state.kingdomId, state.sequence, text, sha256Hex(text), now]);
}

async function checkpointRow(tx: Tx, kingdomId: string): Promise<RealmIngressCheckpoint | null> {
  const row = (await tx.query<{ revision: string; codec: string; data: Buffer }>('SELECT revision, codec, data FROM realm_ingress_checkpoints WHERE kingdom_id = $1', [kingdomId])).rows[0];
  if (!row) return null;
  if (row.codec !== 'presence-v1') throw new RealmRecoveryError(kingdomId, `unsupported ingress codec ${row.codec}`);
  return { version: 1, revision: Number(row.revision), codec: 'presence-v1', data: new Uint8Array(row.data) };
}

/** Globally unique original designs: a second kingdom cannot commit the same design ID. */
const claimDesign: RealmCommitGuard = async (tx, fact) => {
  if (fact.body.type !== 'forge.commitApproved') return 'ok';
  const attachment = fact.body.attachment;
  const claimed = await tx.query(`INSERT INTO realm_designs (design_id, kingdom_id, seq, attachment_id) VALUES ($1, $2, $3, $4) ON CONFLICT (design_id) DO NOTHING`,
    [attachment.provenance.designId, fact.kingdomId, fact.seq, attachment.id]);
  return claimed.rowCount === 1 ? 'ok' : 'conflict';
};

function plotOf(message: RealmPublicMessage, state: RealmPrivateState): string | null {
  if (message.type === 'home') return message.plotId;
  if (message.type === 'forge' && message.event.type === 'committed') return state.attachments[message.event.attachment.id]?.homeId ?? null;
  return null;
}

const key = (lease: RealmWriterLease) => `${lease.kingdomId}\u0000${lease.epoch}`;

function bounded(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  return value;
}
