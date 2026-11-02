import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FORGE_WISH_WORDS_MAX, KingdomIdSchema, PersonIdSchema, TokenSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import type { KingdomForgeCommand } from '@chatdom/shared/realm';
import { z } from 'zod';
import { PrivateWishFiles } from './files';
import { copyWishJson } from './json';
import { matchesWithdrawal, mergeWithdrawal, ownerDeliverySchema, ownerQuerySchema, ownerReplyId,
  withdrawalName, withdrawalRecordSchema, withdrawalSchema } from './lifecycle';
import { ForgeWishQueueError, type FileForgeWishQueueOptions, type ForgeWishCheckpoint,
  type ForgeWishCheckpointInput, type ForgeWishClaim, type ForgeWishClaimOptions, type ForgeWishCompletion,
  type ForgeWishModelStage, type ForgeWishOwnerAcknowledgement, type ForgeWishOwnerQuery,
  type ForgeWishReceipt, type ForgeWishTerminal, type ForgeWishWithdrawal } from './types';

export * from './types';

const MAX_RECORD_BYTES = 1_100_000;
const MAX_WITHDRAWAL_BYTES = 2_048;
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const keySchema = z.string().regex(/^forge-chat-[a-f0-9]{64}$/);
const modelStageSchema = z.enum(['words', 'drafting', 'result']);
const stageSchema = z.enum(['arrival', 'words', 'drafting', 'result', 'commit']);
const commandSchema = z.strictObject({
  kingdomId: KingdomIdSchema, personId: PersonIdSchema, messageId: z.string().min(1).max(128),
  slot: integer.max(65_534), words: z.string().trim().min(1).max(FORGE_WISH_WORDS_MAX), observedAt: integer,
});
const terminalSchema = z.union([
  z.strictObject({ kind: z.literal('committed'), runId: TokenSchema, committedAt: integer }),
  z.strictObject({ kind: z.enum(['refused', 'held', 'cold', 'canceled']) }),
]);
const completionSchema = z.strictObject({ terminal: terminalSchema, message: ownerDeliverySchema.shape.message });
const ownerAcknowledgementSchema = z.strictObject({ key: keySchema, attemptId: TokenSchema,
  replyId: ownerDeliverySchema.shape.replyId });
const checkpointSchema = z.strictObject({ id: TokenSchema, stage: z.enum(['words', 'drafting', 'result', 'commit']),
  modelCalls: integer.max(7), data: z.unknown() });
const recordSchema = z.strictObject({
  version: z.literal(1), origin: z.enum(['live', 'simulated']), key: keySchema, attemptId: TokenSchema,
  sequence: integer.min(1), kingdomId: KingdomIdSchema, personId: PersonIdSchema,
  messageId: z.string().min(1).max(128), slot: integer.max(65_534), observedAt: integer,
  state: z.enum(['queued', 'running', 'finished']), stage: stageSchema, generation: integer,
  binding: sha, callLimit: z.union([z.literal(5), z.literal(7)]),
  extension: z.enum(['fit', 'vocabulary']).optional(),
  calls: z.array(z.strictObject({ ordinal: integer.min(1).max(7), stage: modelStageSchema })).max(7),
  expiresAt: integer.optional(), outcome: terminalSchema.optional(), delivery: ownerDeliverySchema.optional(),
  private: z.strictObject({ words: z.string().min(1).max(FORGE_WISH_WORDS_MAX), checkpoints: z.array(checkpointSchema).max(16) }).optional(),
});
type RecordData = z.infer<typeof recordSchema>;
interface ActiveClaim { readonly claim: ForgeWishClaim; readonly abort: AbortController;
  readonly withdrawal: AbortController; readonly expiresAt: number;
  readonly timer: ReturnType<typeof setTimeout> }

const keyFor = (command: Pick<KingdomForgeCommand, 'kingdomId' | 'messageId'>) =>
  `forge-chat-${createHash('sha256').update(JSON.stringify([command.kingdomId, command.messageId])).digest('hex')}`;
const recordName = (key: string) => `wish-${key.slice('forge-chat-'.length)}.json`;
function inputData<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(value); }
  catch { throw new ForgeWishQueueError('invalid'); }
}
const plain = (record: RecordData): ForgeWishReceipt => ({
  key: record.key, attemptId: record.attemptId, sequence: record.sequence, kingdomId: record.kingdomId,
  personId: record.personId, messageId: record.messageId, slot: record.slot, observedAt: record.observedAt,
  state: record.state, stage: record.stage, generation: record.generation, modelCalls: record.calls.length,
  callLimit: record.callLimit, ...(record.outcome ? { outcome: structuredClone(record.outcome) } : {}),
  ...(record.delivery ? { delivery: structuredClone(record.delivery) } : {}),
});

/**
 * A local durable spool with one process owner and bounded independent workers. It cannot authorize a realm
 * mutation. Its recovery snapshots and spent-call debits survive interruption; the adapter must resume them.
 */
export class FileForgeWishQueue {
  private readonly records = new Map<string, RecordData>();
  private readonly active = new Map<string, ActiveClaim>();
  /** Includes synchronous in-flight barriers. Storage failure poisons this owner instead of relaxing one. */
  private readonly withdrawals = new Map<string, ForgeWishWithdrawal>();
  private serial: Promise<unknown> = Promise.resolve();
  private sequence = 0;
  private closed = false;
  private failed = false;
  private closing: Promise<void> | undefined;
  private constructor(private readonly files: PrivateWishFiles, private readonly secret: Buffer,
    private readonly options: Required<Omit<FileForgeWishQueueOptions, 'directory'>>) {}

  /** The persisted spool origin; adapters must match it to the authority they use. */
  get origin(): 'live' | 'simulated' { return this.options.origin; }

  static async open(input: FileForgeWishQueueOptions): Promise<FileForgeWishQueue> {
    try { return await FileForgeWishQueue.openSpool(input); }
    catch (error) { throw error instanceof ForgeWishQueueError ? error : new ForgeWishQueueError('unavailable'); }
  }

  private static async openSpool(input: FileForgeWishQueueOptions): Promise<FileForgeWishQueue> {
    const maxConcurrent = input.maxConcurrent ?? 2, maxPending = input.maxPending ?? 128;
    const claimMs = input.claimMs ?? 600_000;
    if (typeof input.directory !== 'string' || (input.origin !== 'live' && input.origin !== 'simulated')
      || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 64
      || !Number.isSafeInteger(maxPending) || maxPending < maxConcurrent || maxPending > 4_096
      || !Number.isSafeInteger(claimMs) || claimMs < 1_000 || claimMs > 600_000)
      throw new ForgeWishQueueError('invalid');
    const files = await PrivateWishFiles.open(input.directory).catch(error => {
      throw error instanceof ForgeWishQueueError ? error : new ForgeWishQueueError('unavailable');
    });
    try {
      const names = await files.names();
      for (const name of names) {
        if (name.startsWith('.pending-')) await files.clearTemporary(name);
        else if (!/^(?:owner\.lock|queue\.json|queue\.key|(?:wish|withdrawal)-[a-f0-9]{64}\.json)$/.test(name))
          throw new ForgeWishQueueError('corrupt');
      }
      let header = await files.read('queue.json', 256), key = await files.read('queue.key', 65);
      if (header === null) {
        if (names.some(name => name.startsWith('wish-') || name.startsWith('withdrawal-'))) throw new ForgeWishQueueError('corrupt');
        // The key is installed first; a death before the header can safely finish initialization on reopen.
        if (key === null) { key = randomBytes(32).toString('hex'); await files.write('queue.key', key); }
        header = JSON.stringify({ version: 1, origin: input.origin });
        await files.write('queue.json', header);
      }
      const parsedHeader = z.strictObject({ version: z.literal(1), origin: z.enum(['live', 'simulated']) }).safeParse(JSON.parse(header));
      if (!parsedHeader.success || key === null || !/^[a-f0-9]{64}$/.test(key))
        throw new ForgeWishQueueError('corrupt');
      if (parsedHeader.data.origin !== input.origin) throw new ForgeWishQueueError('conflict');
      const queue = new FileForgeWishQueue(files, Buffer.from(key, 'hex'), {
        origin: input.origin, maxConcurrent, maxPending, claimMs, now: input.now ?? Date.now,
      });
      const sequences = new Set<number>();
      for (const name of names.filter(name => name.startsWith('withdrawal-'))) {
        const bytes = await files.read(name, MAX_WITHDRAWAL_BYTES);
        if (bytes === null) throw new ForgeWishQueueError('corrupt');
        const record = queue.decodeWithdrawal(bytes);
        if (name !== withdrawalName(record)) throw new ForgeWishQueueError('corrupt');
        queue.withdrawals.set(name, record);
      }
      for (const name of names.filter(name => name.startsWith('wish-'))) {
        const bytes = await files.read(name, MAX_RECORD_BYTES);
        if (bytes === null) throw new ForgeWishQueueError('corrupt');
        const record = queue.decode(bytes);
        if (name !== recordName(record.key) || sequences.has(record.sequence)) throw new ForgeWishQueueError('corrupt');
        sequences.add(record.sequence); queue.sequence = Math.max(queue.sequence, record.sequence);
        queue.records.set(record.key, record);
      }
      // No old process can still own this directory's lock. Keep the exact attempt and every spent call;
      // only worker ownership is reset. There is no implicit model retry, release, refusal or publication.
      for (const record of queue.records.values()) if (record.state === 'running') {
        const recovered = { ...record, state: 'queued' as const };
        delete recovered.expiresAt;
        await queue.persist(recovered);
      }
      return queue;
    } catch (error) {
      await files.close().catch(() => {});
      throw error instanceof ForgeWishQueueError ? error : new ForgeWishQueueError('corrupt');
    }
  }

  async enqueue(input: KingdomForgeCommand): Promise<{ readonly kind: 'queued' | 'existing'; readonly receipt: ForgeWishReceipt }> {
    const command = inputData(commandSchema, input);
    return this.work(async () => {
      const key = keyFor(command), binding = this.binding(command), existing = this.records.get(key);
      if (existing) {
        if (existing.binding !== binding) throw new ForgeWishQueueError('conflict');
        return { kind: 'existing' as const, receipt: plain(existing) };
      }
      if ([...this.records.values()].filter(record => record.state !== 'finished').length >= this.options.maxPending)
        throw new ForgeWishQueueError('full');
      if (this.sequence >= Number.MAX_SAFE_INTEGER) throw new ForgeWishQueueError('full');
      const record: RecordData = {
        version: 1, origin: this.options.origin, key, attemptId: `attempt-${randomUUID()}`, sequence: ++this.sequence,
        kingdomId: command.kingdomId, personId: command.personId, messageId: command.messageId,
        slot: command.slot, observedAt: command.observedAt, state: 'queued', stage: 'arrival', generation: 0,
        binding, callLimit: 5, calls: [], private: { words: command.words, checkpoints: [] },
      };
      await this.persist(record);
      return { kind: 'queued' as const, receipt: plain(record) };
    });
  }

  /**
   * A witnessed withdrawal fences authority leases synchronously, even while an earlier write awaits sync.
   * Its promise acknowledges durable storage, not just that in-memory fence. Shutdown never calls this.
   */
  withdraw(input: ForgeWishWithdrawal): Promise<void> {
    try {
      const parsed = inputData(withdrawalSchema, input);
      if (this.closed) throw new ForgeWishQueueError('closed');
      if (this.failed) throw new ForgeWishQueueError('unavailable');
      const name = withdrawalName(parsed), previous = this.withdrawals.get(name);
      const next = mergeWithdrawal(previous, parsed);
      this.withdrawals.set(name, next);
      // Enqueue durability before abort listeners can enqueue their own cleanup. The public method does
      // not await anything before the fence, and a duplicate still waits for the first write to finish.
      const durable = this.work(async () => {
        if (next !== previous) await this.persistWithdrawal(next);
      });
      for (const active of this.active.values()) if (matchesWithdrawal(next, active.claim.receipt))
        active.withdrawal.abort();
      return durable;
    } catch (error) {
      return Promise.reject(error instanceof ForgeWishQueueError ? error : new ForgeWishQueueError('invalid'));
    }
  }

  /** Exact historical predicate only. Current rights, bans and coverage remain realm authority decisions. */
  isWithdrawn(wish: Pick<ForgeWishReceipt, 'kingdomId' | 'personId' | 'messageId' | 'observedAt'>): boolean {
    const scopes: ForgeWishWithdrawal['scope'][] = [
      { kind: 'message', messageId: wish.messageId },
      { kind: 'person', personId: wish.personId, through: 0 },
      { kind: 'kingdom', through: 0 },
    ];
    return scopes.some(scope => {
      const found = this.withdrawals.get(withdrawalName({ kingdomId: wish.kingdomId, reason: 'deleted', scope }));
      return found !== undefined && matchesWithdrawal(found, wish);
    });
  }

  /** First-commit order, never a claim that a ceremony was shown or acknowledged by a viewer. */
  canCommit(claim: ForgeWishClaim): boolean {
    let record: RecordData;
    try { record = this.owned(claim); } catch { return false; }
    if (this.isWithdrawn(record)) return false;
    for (const previous of this.records.values()) if (previous.kingdomId === record.kingdomId
      && previous.sequence < record.sequence && previous.state !== 'finished') return false;
    return true;
  }

  /** Never fill the anvils behind a head wish that has not acquired its own reservation yet. */
  canReserve(claim: ForgeWishClaim): boolean {
    let record: RecordData;
    try { record = this.owned(claim); } catch { return false; }
    if (this.isWithdrawn(record)) return false;
    for (const previous of this.records.values()) if (previous.kingdomId === record.kingdomId
      && previous.sequence < record.sequence && previous.state !== 'finished'
      && !previous.private?.checkpoints.some(value => value.id === 'application-binding' || value.id === 'application-terminal')) return false;
    return true;
  }

  async claimNext(options: ForgeWishClaimOptions = {}): Promise<ForgeWishClaim | null> {
    let excluded: Set<string>;
    try {
      excluded = new Set(options.excludeKeys ?? []);
      if ([...excluded].some(key => !keySchema.safeParse(key).success)) throw new Error();
    } catch { throw new ForgeWishQueueError('invalid'); }
    return this.work(async () => {
      await this.reclaimExpired();
      if (this.active.size >= this.options.maxConcurrent) return null;
      const busy = new Set([...this.active.values()].map(({ claim }) =>
        `${claim.receipt.kingdomId}:${claim.receipt.personId}`));
      const firstByMaker = new Map<string, number>();
      for (const pending of this.records.values()) if (pending.state !== 'finished') {
        const maker = `${pending.kingdomId}:${pending.personId}`;
        firstByMaker.set(maker, Math.min(firstByMaker.get(maker) ?? Infinity, pending.sequence));
      }
      const record = [...this.records.values()].filter(record => record.state === 'queued'
        && !excluded.has(record.key)
        && firstByMaker.get(`${record.kingdomId}:${record.personId}`) === record.sequence
        && !busy.has(`${record.kingdomId}:${record.personId}`))
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (!record) return null;
      if (!record.private || record.generation >= Number.MAX_SAFE_INTEGER) throw new ForgeWishQueueError('corrupt');
      const at = this.now(), expiresAt = at + this.options.claimMs;
      if (!Number.isSafeInteger(expiresAt)) throw new ForgeWishQueueError('invalid');
      const claimed = { ...record, state: 'running' as const, generation: record.generation + 1, expiresAt };
      await this.persist(claimed);
      const abort = new AbortController(), withdrawal = new AbortController();
      if (this.isWithdrawn(claimed)) withdrawal.abort();
      const claim: ForgeWishClaim = Object.freeze({
        receipt: Object.freeze(plain(claimed)), attempt: Object.freeze({ key: claimed.key, attemptId: claimed.attemptId }),
        command: Object.freeze({ kingdomId: claimed.kingdomId, personId: claimed.personId, messageId: claimed.messageId,
          slot: claimed.slot, observedAt: claimed.observedAt, words: claimed.private!.words }),
        checkpoints: structuredClone(claimed.private!.checkpoints) as ForgeWishCheckpoint[], signal: abort.signal,
        withdrawal: withdrawal.signal,
        current: () => !this.closed && !this.failed && !abort.signal.aborted
          && this.active.get(claimed.key)?.claim === claim && this.safeNow() < expiresAt,
      });
      const timer = setTimeout(() => abort.abort(), this.options.claimMs); timer.unref?.();
      this.active.set(claimed.key, { claim, abort, withdrawal, expiresAt, timer });
      return claim;
    });
  }

  /** Persist the debit before making a model request. A crash with no returned result still spends that call. */
  async beginModelCall(claim: ForgeWishClaim, stage: ForgeWishModelStage): Promise<number> {
    if (!modelStageSchema.safeParse(stage).success) throw new ForgeWishQueueError('invalid');
    return this.work(async () => {
      const record = this.owned(claim);
      if (this.isWithdrawn(record)) throw new ForgeWishQueueError('stale');
      if (record.calls.length >= record.callLimit) throw new ForgeWishQueueError('budget');
      const ordinal = record.calls.length + 1;
      await this.persist({ ...record, stage, calls: [...record.calls, { ordinal, stage }] });
      return ordinal;
    });
  }

  async extendBudget(claim: ForgeWishClaim, reason: 'fit' | 'vocabulary'): Promise<ForgeWishReceipt> {
    if (reason !== 'fit' && reason !== 'vocabulary') throw new ForgeWishQueueError('invalid');
    return this.work(async () => {
      const record = this.owned(claim);
      if (record.callLimit === 7) return plain(record);
      const next: RecordData = { ...record, callLimit: 7, extension: reason };
      await this.persist(next); return plain(next);
    });
  }

  async checkpoint(claim: ForgeWishClaim, input: ForgeWishCheckpointInput): Promise<ForgeWishReceipt> {
    const parsed = inputData(checkpointSchema.omit({ modelCalls: true }), input);
    let data: ReturnType<typeof copyWishJson>;
    try { data = copyWishJson(parsed.data); }
    catch { throw new ForgeWishQueueError('invalid'); }
    return this.work(async () => {
      const record = this.owned(claim), previous = record.private!.checkpoints.find(checkpoint => checkpoint.id === parsed.id);
      if (previous) {
        if (previous.stage !== parsed.stage || JSON.stringify(previous.data) !== JSON.stringify(data))
          throw new ForgeWishQueueError('conflict');
        return plain(record);
      }
      if (record.private!.checkpoints.length >= 16) throw new ForgeWishQueueError('full');
      const checkpoint = { id: parsed.id, stage: parsed.stage, modelCalls: record.calls.length, data };
      const next: RecordData = { ...record, stage: checkpoint.stage,
        private: { words: record.private!.words, checkpoints: [...record.private!.checkpoints, checkpoint] } };
      await this.persist(next); return plain(next);
    });
  }

  /** Suspension is not cancellation: retain the same attempt, words, evidence and spent-call ledger. */
  async retry(claim: ForgeWishClaim): Promise<ForgeWishReceipt> {
    return this.work(async () => {
      const record = this.owned(claim), next = { ...record, state: 'queued' as const };
      delete next.expiresAt;
      await this.persist(next); this.revoke(record.key); return plain(next);
    });
  }

  /** Call only once authoritative recovery confirms the actual outcome and any created piece is stored. */
  async finish(claim: ForgeWishClaim, input: ForgeWishTerminal): Promise<ForgeWishReceipt> {
    const parsed = inputData(terminalSchema, input);
    return this.work(async () => {
      const record = this.owned(claim), next = { ...record, state: 'finished' as const, outcome: parsed };
      delete next.private; delete next.expiresAt;
      // One atomic replacement removes every queued copy of words and stage data. The old inode is not
      // retained; no success is returned until both file and directory durability are confirmed.
      await this.persist(next); this.revoke(record.key); return plain(next);
    });
  }

  /**
   * Production terminal boundary: save the actual finite owner outcome in the SAME durable replacement
   * that erases words and recovery evidence. A delivery failure can never require running this wish again.
   */
  async complete(claim: ForgeWishClaim, input: ForgeWishCompletion): Promise<ForgeWishReceipt> {
    const parsed = inputData(completionSchema, input);
    return this.work(async () => {
      const record = this.owned(claim);
      const next: RecordData = { ...record, state: 'finished', outcome: parsed.terminal,
        delivery: { replyId: ownerReplyId(record.messageId), message: parsed.message, acknowledged: false } };
      delete next.private; delete next.expiresAt;
      await this.persist(next); this.revoke(record.key); return plain(next);
    });
  }

  /** Private owner-scoped pages, including acknowledged outcomes so pagination never implies receipt. */
  async ownerOutcomes(kingdomId: KingdomId, personId: PersonId,
    input: ForgeWishOwnerQuery = {}): Promise<ForgeWishReceipt[]> {
    const owner = inputData(z.strictObject({ kingdomId: KingdomIdSchema, personId: PersonIdSchema }), { kingdomId, personId });
    const query = inputData(ownerQuerySchema, input);
    return this.work(async () => [...this.records.values()].filter(record => record.kingdomId === owner.kingdomId
      && record.personId === owner.personId && record.state === 'finished' && record.delivery !== undefined
      && record.sequence > (query.afterSequence ?? 0))
      .sort((a, b) => a.sequence - b.sequence).slice(0, query.limit ?? 32).map(plain));
  }

  /** A trusted adapter must authenticate this exact owner before calling; socket handoff is never an ACK. */
  async acknowledgeOwner(kingdomId: KingdomId, personId: PersonId,
    input: ForgeWishOwnerAcknowledgement): Promise<void> {
    const owner = inputData(z.strictObject({ kingdomId: KingdomIdSchema, personId: PersonIdSchema }), { kingdomId, personId });
    const ack = inputData(ownerAcknowledgementSchema, input);
    return this.work(async () => {
      const record = this.records.get(ack.key);
      if (!record || record.state !== 'finished' || record.kingdomId !== owner.kingdomId
        || record.personId !== owner.personId || record.attemptId !== ack.attemptId
        || record.delivery?.replyId !== ack.replyId) throw new ForgeWishQueueError('conflict');
      if (record.delivery.acknowledged) return;
      await this.persist({ ...record, delivery: { ...record.delivery, acknowledged: true } });
    });
  }

  /**
   * Forget finished wishes whose maker has heard the outcome and that arrived before `before`. They hold no words;
   * dropping them bounds startup and disk. Unfinished or unacknowledged wishes are never touched.
   */
  async prune(before: number): Promise<number> {
    if (!Number.isSafeInteger(before)) throw new ForgeWishQueueError('invalid');
    return this.work(async () => {
      let removed = 0;
      for (const record of [...this.records.values()]) {
        if (record.state !== 'finished' || record.observedAt >= before || this.active.has(record.key)
          || (record.delivery !== undefined && !record.delivery.acknowledged)) continue;
        await this.files.remove(recordName(record.key));
        this.records.delete(record.key); removed++;
      }
      return removed;
    });
  }

  async get(key: string): Promise<ForgeWishReceipt | null> {
    if (!keySchema.safeParse(key).success) throw new ForgeWishQueueError('invalid');
    return this.work(async () => { const record = this.records.get(key); return record ? plain(record) : null; });
  }

  async list(): Promise<ForgeWishReceipt[]> {
    return this.work(async () => [...this.records.values()].sort((a, b) => a.sequence - b.sequence).map(plain));
  }

  /** Revokes worker leases immediately, then waits for accepted writes before releasing ownership. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const key of this.active.keys()) this.revoke(key);
    this.closing = this.serial.catch(() => {}).then(async () => {
      // An already-running claim write may have completed after the immediate revocation sweep.
      for (const key of this.active.keys()) this.revoke(key);
      try { await this.files.close(); }
      catch { throw new ForgeWishQueueError('unavailable'); }
      finally { this.secret.fill(0); this.records.clear(); this.withdrawals.clear(); }
    });
    return this.closing;
  }

  private async work<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new ForgeWishQueueError('closed');
    const result = this.serial.then(async () => {
      if (this.closed) throw new ForgeWishQueueError('closed');
      if (this.failed) throw new ForgeWishQueueError('unavailable');
      try { return await operation(); }
      catch (error) {
        if (error instanceof ForgeWishQueueError) throw error;
        this.fail(); throw new ForgeWishQueueError('unavailable');
      }
    });
    this.serial = result.catch(() => {});
    return result;
  }

  private fail() { this.failed = true; for (const key of this.active.keys()) this.revoke(key); }
  private now() { const at = this.options.now(); if (!Number.isSafeInteger(at) || at < 0) throw new ForgeWishQueueError('invalid'); return at; }
  private safeNow() { try { return this.now(); } catch { return Infinity; } }
  private revoke(key: string) {
    const active = this.active.get(key);
    if (active) { active.abort.abort(); clearTimeout(active.timer); this.active.delete(key); }
  }
  private owned(claim: ForgeWishClaim): RecordData {
    const active = this.active.get(claim.receipt.key), record = this.records.get(claim.receipt.key);
    if (active?.claim !== claim || !claim.current() || record?.state !== 'running'
      || record.generation !== claim.receipt.generation || !record.private) throw new ForgeWishQueueError('stale');
    return record;
  }
  private async reclaimExpired() {
    for (const [key, active] of this.active) if (!active.claim.current()) {
      const record = this.records.get(key)!;
      const next = { ...record, state: 'queued' as const }; delete next.expiresAt;
      this.revoke(key); await this.persist(next);
    }
  }
  private binding(command: KingdomForgeCommand) {
    return this.mac(JSON.stringify([this.options.origin, command.kingdomId, command.personId, command.messageId,
      command.slot, command.observedAt, command.words]));
  }
  private mac(bytes: string) { return createHmac('sha256', this.secret).update(bytes).digest('hex'); }
  private async persist(record: RecordData) {
    const payload = JSON.stringify(record), bytes = JSON.stringify({ payload: record, mac: this.mac(payload) });
    if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) throw new ForgeWishQueueError('full');
    try { await this.files.write(recordName(record.key), bytes); }
    catch { this.fail(); throw new ForgeWishQueueError('unavailable'); }
    this.records.set(record.key, record);
  }
  private async persistWithdrawal(withdrawal: ForgeWishWithdrawal) {
    const record = { version: 1, origin: this.options.origin, withdrawal };
    const payload = JSON.stringify(record), bytes = JSON.stringify({ payload: record, mac: this.mac(payload) });
    if (Buffer.byteLength(bytes) > MAX_WITHDRAWAL_BYTES) { this.fail(); throw new ForgeWishQueueError('full'); }
    try { await this.files.write(withdrawalName(withdrawal), bytes); }
    catch { this.fail(); throw new ForgeWishQueueError('unavailable'); }
  }
  private decodeWithdrawal(bytes: string): ForgeWishWithdrawal {
    try {
      const outer = z.strictObject({ payload: z.unknown(), mac: sha }).parse(JSON.parse(bytes));
      const payload = JSON.stringify(outer.payload);
      if (!timingSafeEqual(Buffer.from(this.mac(payload), 'hex'), Buffer.from(outer.mac, 'hex'))) throw new Error();
      const record = withdrawalRecordSchema.parse(outer.payload);
      if (record.origin !== this.options.origin) throw new Error();
      return record.withdrawal;
    } catch { throw new ForgeWishQueueError('corrupt'); }
  }
  private decode(bytes: string): RecordData {
    try {
      const outer = z.strictObject({ payload: z.unknown(), mac: sha }).parse(JSON.parse(bytes));
      const payload = JSON.stringify(outer.payload);
      if (!timingSafeEqual(Buffer.from(this.mac(payload), 'hex'), Buffer.from(outer.mac, 'hex'))) throw new Error();
      const record = recordSchema.parse(outer.payload);
      if (record.origin !== this.options.origin || record.key !== keyFor(record)
        || record.calls.length > record.callLimit || (record.callLimit === 7) !== (record.extension !== undefined)
        || record.calls.some((call, index) => call.ordinal !== index + 1)
        || (record.state === 'running') !== (record.expiresAt !== undefined)
        || (record.state === 'finished') !== (record.outcome !== undefined)
        || (record.state === 'finished') === (record.private !== undefined)
        || record.delivery !== undefined && (record.state !== 'finished'
          || record.delivery.replyId !== ownerReplyId(record.messageId))) throw new Error();
      if (record.private) {
        if (this.binding({ kingdomId: record.kingdomId, personId: record.personId, messageId: record.messageId,
          slot: record.slot, observedAt: record.observedAt, words: record.private.words }) !== record.binding) throw new Error();
        const ids = new Set<string>(); let spent = 0;
        for (const checkpoint of record.private.checkpoints) {
          if (ids.has(checkpoint.id) || checkpoint.modelCalls < spent || checkpoint.modelCalls > record.calls.length) throw new Error();
          ids.add(checkpoint.id); spent = checkpoint.modelCalls; checkpoint.data = copyWishJson(checkpoint.data);
        }
      }
      return record;
    } catch { throw new ForgeWishQueueError('corrupt'); }
  }
}
