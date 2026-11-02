import { KingdomIdSchema } from '@chatdom/shared';
import { type FetchLike, isTwitchFailure, send, TWITCH_HELIX_URL } from '@chatdom/twitch';
import { type FileHandle, mkdir, open, readFile, rename, rm, stat, truncate } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { RAID_AUTHORITY_LIVE_KINGDOM, RaidAuthorityKeySchema, RaidAuthorityOutcomeSchema, RaidAuthorityWriteSchema,
  type RaidAuthorityOutcome, type RaidAuthorityWrite } from '../../../api/src/raid-gate/raid-authority-contracts';
import { isInside } from '../source/bindings';
import { syncDirectory } from './raid-authority-store';
import { RaidGrantUnavailable, type RaidUserSession } from './user-token';

export const RAID_WRITES_FILE = 'raid-writes.jsonl';
/** Twitch's Start/Cancel a Raid answer within this, or the write's outcome is unknown. */
export const RAID_WRITE_TIMEOUT_MS = 8_000;
/** Twitch's raid countdown: a pending raid that was neither cancelled nor sent ends by then. */
export const RAID_COUNTDOWN_MS = 90_000;
/** The ledger refuses to open beyond this rather than read without bound. */
export const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
/** Above this the ledger is rewritten to one line per key on open. */
const COMPACT_BYTES = 2 * 1024 * 1024;
/** Keys the ledger holds. Ten raid requests per ten minutes make this years of presses; beyond it, writes are refused. */
export const MAX_LEDGER_KEYS = 50_000;
export const MAX_RECENT_WRITES = 64;

export type RaidOp = 'start' | 'cancel';
type State = 'claimed' | 'accepted' | 'rejected' | 'unknown';

/** One key's latest record. `claimed` is on disk before Twitch is called; a claim without an outcome is unknown. */
export interface LedgerEntry {
  readonly key: string; readonly op: RaidOp; readonly requestId: string; readonly from: string; readonly to: string;
  readonly state: State; readonly createdAt?: number | undefined; readonly code?: string | undefined; readonly at: number;
}

const LineSchema = z.strictObject({
  v: z.literal(1), at: z.number().int().nonnegative(), key: RaidAuthorityKeySchema, op: z.enum(['start', 'cancel']),
  requestId: z.string().min(1).max(128), from: KingdomIdSchema, to: KingdomIdSchema,
  state: z.enum(['claimed', 'accepted', 'rejected', 'unknown']),
  createdAt: z.number().int().nonnegative().optional(), code: z.string().regex(/^[a-z0-9_-]{1,64}$/u).optional(),
});

export type RaidLedgerFault = 'corrupt' | 'insecure' | 'inside_repository' | 'too_large' | 'unwritable';
export class RaidLedgerError extends Error {
  override readonly name = 'RaidLedgerError';
  constructor(readonly fault: RaidLedgerFault) {
    super(`raid write ledger ${fault.replace('_', ' ')}`);
  }
}

/**
 * Herald's durable, append-only record of every raid write it was asked for: `<dir>/raid-writes.jsonl`, one JSON line
 * per state, each appended and fsynced before anything acts on it. The latest line per key wins, and an outcome
 * never changes once written. A line torn by a crash is dropped on open: it was never synced, so nothing acted on it.
 */
export class RaidWriteLedger {
  readonly path: string;
  readonly #entries = new Map<string, LedgerEntry>();
  #handle: FileHandle | null;
  #serial: Promise<unknown> = Promise.resolve();
  #fault: RaidLedgerFault | null = null;

  private constructor(path: string, handle: FileHandle) {
    this.path = path;
    this.#handle = handle;
  }

  static async open(options: { readonly dir: string; readonly repositoryRoot?: string | null }): Promise<RaidWriteLedger> {
    const dir = options.dir;
    if (!isAbsolute(dir)) throw new RaidLedgerError('unwritable');
    if (options.repositoryRoot && isInside(resolve(options.repositoryRoot), resolve(dir))) throw new RaidLedgerError('inside_repository');
    await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => { throw new RaidLedgerError('unwritable'); });
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw new RaidLedgerError('unwritable');
    if ((info.mode & 0o022) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new RaidLedgerError('insecure');
    const path = join(dir, RAID_WRITES_FILE);
    const entries = new Map<string, LedgerEntry>();
    let size = 0;
    try {
      const file = await stat(path);
      if ((file.mode & 0o077) !== 0 || (process.getuid && file.uid !== process.getuid())) throw new RaidLedgerError('insecure');
      if (file.size > MAX_LEDGER_BYTES) throw new RaidLedgerError('too_large');
      const bytes = await readFile(path);
      const complete = bytes.lastIndexOf(0x0a) + 1;
      if (complete < bytes.length) await truncate(path, complete);
      for (const line of bytes.subarray(0, complete).toString('utf8').split('\n')) {
        if (!line) continue;
        let parsed;
        try { parsed = LineSchema.parse(JSON.parse(line)); } catch { throw new RaidLedgerError('corrupt'); }
        const entry: LedgerEntry = { ...parsed };
        delete (entry as { v?: unknown }).v;
        const previous = entries.get(entry.key);
        if (previous && previous.state !== 'claimed') continue;
        entries.set(entry.key, entry);
      }
      size = complete;
    } catch (error) {
      if (error instanceof RaidLedgerError) throw error;
      if (!isCode(error, 'ENOENT')) throw new RaidLedgerError('unwritable');
    }
    if (size > COMPACT_BYTES) await compact(path, entries);
    let handle: FileHandle;
    try {
      handle = await open(path, 'a', 0o600);
      await syncDirectory(dir);
    } catch { throw new RaidLedgerError('unwritable'); }
    const ledger = new RaidWriteLedger(path, handle);
    for (const [key, entry] of entries) ledger.#entries.set(key, entry);
    return ledger;
  }

  get fault(): RaidLedgerFault | null { return this.#fault; }
  get size(): number { return this.#entries.size; }
  get(key: string): LedgerEntry | undefined { return this.#entries.get(key); }

  /** The latest records, newest first, for private health. */
  recent(limit = MAX_RECENT_WRITES): LedgerEntry[] {
    return [...this.#entries.values()].sort((a, b) => b.at - a.at).slice(0, limit);
  }

  /** Appends and syncs one record; it is in memory only once it is on disk. Throws if it could not be kept. */
  append(entry: LedgerEntry): Promise<void> {
    const run = this.#serial.then(async () => {
      const handle = this.#handle;
      if (!handle) throw new RaidLedgerError('unwritable');
      const previous = this.#entries.get(entry.key);
      if (previous && previous.state !== 'claimed') throw new RaidLedgerError('corrupt');
      try {
        await handle.appendFile(`${JSON.stringify({ v: 1, ...entry })}\n`);
        await handle.sync();
      } catch {
        this.#fault = 'unwritable';
        throw new RaidLedgerError('unwritable');
      }
      this.#fault = null;
      this.#entries.set(entry.key, entry);
    });
    this.#serial = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.#serial;
    const handle = this.#handle;
    this.#handle = null;
    await handle?.close();
  }
}

async function compact(path: string, entries: ReadonlyMap<string, LedgerEntry>): Promise<void> {
  const temporary = `${path}.compact.tmp`;
  try {
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile([...entries.values()].map(entry => `${JSON.stringify({ v: 1, ...entry })}\n`).join(''));
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, path);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new RaidLedgerError('unwritable');
  }
}

/**
 * The one Twitch write behind a ledger: Start a Raid or Cancel a Raid, or a recording of one. `ready` runs before the
 * claim and refuses anything that would fail without reaching Twitch; `send` makes exactly one write and reduces
 * every answer to an outcome, never throwing for what Twitch said.
 */
export interface RaidWire {
  readonly origin: 'live' | 'simulated';
  ready(): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }>;
  send(op: RaidOp, write: RaidAuthorityWrite): Promise<RaidAuthorityOutcome>;
}

/**
 * Herald's half of the gate's `AuthorizedRaidTransport`. Every start and cancel is claimed on disk before Twitch is
 * called; any key that already has a record never reaches Twitch again and answers that record (`unknown` for a
 * claim without an outcome). `reconcile` never writes. Only the configured broadcaster may raid, and on a live origin
 * only tobi4s_. The caller's signal never reaches a write that has been sent: Twitch's answer belongs to the ledger.
 */
export class RaidWrites {
  readonly origin: 'live' | 'simulated';
  readonly #inflight = new Map<string, { readonly op: RaidOp; readonly write: RaidAuthorityWrite; readonly outcome: Promise<RaidAuthorityOutcome> }>();
  readonly #now: () => number;
  readonly counters = { claimed: 0, accepted: 0, rejected: 0, unknown: 0, repeated: 0, refused: 0 };

  constructor(readonly options: { readonly ledger: RaidWriteLedger; readonly wire: RaidWire; readonly broadcasterId: string; readonly now?: () => number }) {
    this.origin = options.wire.origin;
    this.#now = options.now ?? Date.now;
    KingdomIdSchema.parse(options.broadcasterId);
  }

  start(write: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> { return this.#write('start', write); }
  cancel(write: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> { return this.#write('cancel', write); }

  async reconcile(raw: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> {
    const write = RaidAuthorityWriteSchema.parse(raw);
    const entry = this.options.ledger.get(write.key);
    return entry && sameWrite(entry, entry.op, write) ? outcomeOf(entry) : { kind: 'unknown' };
  }

  /** The bounded recent writes for private health: no tokens, no provider text. */
  recent(limit = MAX_RECENT_WRITES) {
    return this.options.ledger.recent(limit).map(entry => ({ key: entry.key, op: entry.op, from: entry.from, to: entry.to, outcome: outcomeOf(entry), at: entry.at }));
  }

  async #write(op: RaidOp, raw: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> {
    const write = RaidAuthorityWriteSchema.parse(raw);
    // The key names its write: `<requestId>/start` for a start, `<requestId>/cancel` for a cancel.
    if (!write.key.endsWith(`/${op}`)) return { kind: 'unknown' };
    if (write.from !== this.options.broadcasterId || (this.origin === 'live' && write.from !== RAID_AUTHORITY_LIVE_KINGDOM)) {
      this.counters.refused++;
      return { kind: 'rejected', code: 'not-this-channel' };
    }
    const inflight = this.#inflight.get(write.key);
    if (inflight) {
      this.counters.repeated++;
      return inflight.op === op && sameWrite({ ...inflight.write, op }, op, write) ? inflight.outcome : { kind: 'unknown' };
    }
    const recorded = this.options.ledger.get(write.key);
    if (recorded) {
      this.counters.repeated++;
      return sameWrite(recorded, op, write) ? outcomeOf(recorded) : { kind: 'unknown' };
    }
    const outcome = this.#dispatch(op, write).finally(() => this.#inflight.delete(write.key));
    this.#inflight.set(write.key, { op, write, outcome });
    return outcome;
  }

  async #dispatch(op: RaidOp, write: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> {
    const { ledger, wire } = this.options;
    if (ledger.size >= MAX_LEDGER_KEYS) return this.#settle(op, write, { kind: 'rejected', code: 'ledger-full' }, false);
    const ready = await wire.ready();
    // Nothing reached Twitch: the refusal is final for this key, so a repeat never sends later.
    if (!ready.ok) return this.#settle(op, write, { kind: 'rejected', code: ready.code }, false);
    await ledger.append({ key: write.key, op, requestId: write.requestId, from: write.from, to: write.to, state: 'claimed', at: this.#now() });
    this.counters.claimed++;
    let outcome: RaidAuthorityOutcome;
    try {
      outcome = RaidAuthorityOutcomeSchema.parse(await wire.send(op, write));
    } catch {
      outcome = { kind: 'unknown' };
    }
    return this.#settle(op, write, outcome, true);
  }

  async #settle(op: RaidOp, write: RaidAuthorityWrite, outcome: RaidAuthorityOutcome, claimed: boolean): Promise<RaidAuthorityOutcome> {
    this.counters[outcome.kind]++;
    try {
      await this.options.ledger.append({ key: write.key, op, requestId: write.requestId, from: write.from, to: write.to, state: outcome.kind,
        ...(outcome.kind === 'accepted' ? { createdAt: outcome.createdAt } : {}), ...(outcome.kind === 'rejected' ? { code: outcome.code } : {}), at: this.#now() });
    } catch {
      // The claim (if any) is on disk: after a restart this key answers unknown, never a second write.
      if (!claimed) throw new RaidLedgerError('unwritable');
    }
    return outcome;
  }
}

function sameWrite(entry: Pick<LedgerEntry, 'op' | 'requestId' | 'from' | 'to'>, op: RaidOp, write: RaidAuthorityWrite): boolean {
  return entry.op === op && entry.requestId === write.requestId && entry.from === write.from && entry.to === write.to;
}

function outcomeOf(entry: LedgerEntry): RaidAuthorityOutcome {
  if (entry.state === 'accepted' && entry.createdAt !== undefined) return { kind: 'accepted', createdAt: entry.createdAt };
  if (entry.state === 'rejected' && entry.code !== undefined) return { kind: 'rejected', code: entry.code };
  return { kind: 'unknown' };
}

const StartReply = z.object({ data: z.array(z.object({ created_at: z.string().max(64) })).length(1) });

/** Short codes for Twitch's definite refusals. Provider text never leaves this file. */
function refusal(op: RaidOp, status: number): string | null {
  if (status === 409 && op === 'start') return 'already-raiding';
  if (status === 429) return 'rate-limited';
  if (status === 404) return op === 'start' ? 'target-not-found' : 'nothing-pending';
  if (status === 400) return op === 'start' ? 'raid-refused' : 'bad-request';
  if (status === 403) return 'forbidden';
  if (status === 422) return 'unprocessable';
  // 408 says Twitch never finished reading the request; still, nothing here vouches for it.
  if (status >= 400 && status < 500 && status !== 408) return `http-${status}`;
  return null;
}

/**
 * Start a Raid / Cancel a Raid with the broadcaster's user token. A `401` is Twitch refusing the token, so the
 * write did not happen: the token is refreshed once and the write tried once more; a second `401` revokes the grant.
 * Anything after the request may have left without a definite answer (timeout, dropped connection, 5xx, an
 * unreadable 200) is `unknown`.
 */
export class HelixRaidWire implements RaidWire {
  readonly origin = 'live' as const;
  readonly #now: () => number;

  constructor(readonly options: { readonly session: RaidUserSession; readonly clientId: string; readonly fetch: FetchLike;
    readonly now?: () => number; readonly helixUrl?: string; readonly timeoutMs?: number }) {
    this.#now = options.now ?? Date.now;
  }

  async ready(): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }> {
    try {
      await this.options.session.token();
      return { ok: true };
    } catch (error) {
      return { ok: false, code: grantCode(error) };
    }
  }

  async send(op: RaidOp, write: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> {
    const session = this.options.session;
    let token;
    try { token = await session.token(); } catch (error) { return { kind: 'rejected', code: grantCode(error) }; }
    const url = new URL('raids', this.options.helixUrl ?? TWITCH_HELIX_URL);
    if (op === 'start') { url.searchParams.set('from_broadcaster_id', write.from); url.searchParams.set('to_broadcaster_id', write.to); }
    else url.searchParams.set('broadcaster_id', write.from);
    for (let attempt = 0; ; attempt++) {
      try {
        // Server-owned deadline only: a caller hanging up must not abort a write Twitch may already be acting on.
        const result = await send(this.options.fetch, { operation: op === 'start' ? 'start a raid' : 'cancel a raid', method: op === 'start' ? 'POST' : 'DELETE', url,
          headers: { Authorization: `Bearer ${token.reveal()}`, 'Client-Id': this.options.clientId }, timeoutMs: this.options.timeoutMs ?? RAID_WRITE_TIMEOUT_MS });
        if (op === 'cancel') return { kind: 'accepted', createdAt: Math.floor(this.#now()) };
        const parsed = StartReply.safeParse(result.body);
        const createdAt = parsed.success ? Date.parse(parsed.data.data[0]!.created_at) : Number.NaN;
        return result.status === 200 && Number.isFinite(createdAt) && createdAt >= 0 ? { kind: 'accepted', createdAt: Math.floor(createdAt) } : { kind: 'unknown' };
      } catch (error) {
        if (!isTwitchFailure(error) || error.status === null) return { kind: 'unknown' };
        if (error.status === 401) {
          if (attempt > 0) { await session.revoke(); return { kind: 'rejected', code: 'grant-revoked' }; }
          try { token = await session.renew(token); } catch (renewal) { return { kind: 'rejected', code: grantCode(renewal) }; }
          continue;
        }
        const code = refusal(op, error.status);
        return code ? { kind: 'rejected', code } : { kind: 'unknown' };
      }
    }
  }
}

function grantCode(error: unknown): string {
  if (error instanceof RaidGrantUnavailable) return error.state === 'missing' ? 'grant-missing' : error.state === 'revoked' ? 'grant-revoked' : 'grant-unavailable';
  return 'grant-unavailable';
}

/**
 * SIMULATED raid writes for `herald mock`: no token, no network. A start holds one pending raid for Twitch's
 * countdown; a second start meanwhile is refused as Twitch would, and a cancel clears it.
 */
export class RecordingRaidWire implements RaidWire {
  readonly origin = 'simulated' as const;
  readonly #now: () => number;
  #pending: { readonly from: string; readonly to: string; readonly createdAt: number } | null = null;

  constructor(now: () => number = Date.now) { this.#now = now; }

  get pending() { return this.#pending && this.#pending.createdAt + RAID_COUNTDOWN_MS > this.#now() ? { ...this.#pending } : null; }

  async ready(): Promise<{ readonly ok: true }> { return { ok: true }; }

  async send(op: RaidOp, write: RaidAuthorityWrite): Promise<RaidAuthorityOutcome> {
    const now = Math.floor(this.#now());
    if (op === 'start') {
      if (this.pending) return { kind: 'rejected', code: 'already-raiding' };
      this.#pending = { from: write.from, to: write.to, createdAt: now };
      return { kind: 'accepted', createdAt: now };
    }
    if (!this.pending) return { kind: 'rejected', code: 'nothing-pending' };
    this.#pending = null;
    return { kind: 'accepted', createdAt: now };
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code;
}
