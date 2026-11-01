import { KingdomIdSchema, PersonIdSchema, TokenSchema, TwitchLoginSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import { isTwitchFailure, type HelixSession } from '@chatdom/twitch';
import { z } from 'zod';
import { RAID_CRIER_ALLOWED_LIVE_KINGDOM, RAID_CRIER_CLAIM_ROUTE, RAID_CRIER_LIFETIME_MS, RAID_CRIER_RECEIPT_ROUTE,
  RaidCrierClaimReplySchema, RaidCrierClaimRequestSchema, RaidCrierClaimSchema, RaidCrierOutcomeSchema, RaidCrierReceiptSchema,
  type RaidCrierClaim, type RaidCrierOutcome, type RaidCrierReceipt } from '../../../api/src/raid-gate/crier-contracts';
import type { AuthReport } from '../auth/authority';
import { TtlMap } from '../ingest/ttl';

export const RAID_CRIER_AUTH_MAX_AGE_MS = 60_000;
export const MAX_CRIER_RECEIPTS = 64;
export interface RaidCrierTransport {
  readonly origin: 'live' | 'simulated';
  /** One attempted mutation only; ambiguous outcomes must never trigger another chat post. */
  send(claim: RaidCrierClaim): Promise<RaidCrierOutcome>;
}

const ChatReply = z.object({ data: z.array(z.object({ is_sent: z.boolean(), message_id: z.string().max(128).optional(),
  drop_reason: z.object({ code: z.string().max(128) }).nullish() })).length(1) });

/** Uses the live source's existing app-token session and request budget. Never accepts simulated evidence. */
export class HelixRaidCrierTransport implements RaidCrierTransport {
  readonly origin = 'live' as const;
  constructor(readonly session: Pick<HelixSession, 'call'>, readonly now: () => number = Date.now) {}

  async send(raw: RaidCrierClaim): Promise<RaidCrierOutcome> {
    const claim = RaidCrierClaimSchema.parse(raw);
    if (claim.origin !== 'live' || claim.kingdomId !== RAID_CRIER_ALLOWED_LIVE_KINGDOM || String(claim.senderId) === claim.kingdomId) {
      return { status: 'refused', code: 'channel_not_allowed' };
    }
    const remaining = claim.expiresAt - this.now();
    if (remaining <= 0) return { status: 'refused', code: 'claim_expired' };
    try {
      const response = await this.session.call({ operation: 'send raid welcome', method: 'POST', path: 'chat/messages', retryRateLimit: false,
        json: { broadcaster_id: claim.kingdomId, sender_id: claim.senderId, message: claim.text, for_source_only: true } },
      { deadline: claim.expiresAt, signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, remaining))) });
      const parsed = ChatReply.safeParse(response.body);
      if (response.status !== 200 || !parsed.success) return { status: 'unknown' };
      const item = parsed.data.data[0]!;
      if (item.is_sent) {
        const id = TokenSchema.safeParse(item.message_id);
        return id.success ? { status: 'sent', messageId: id.data } : { status: 'unknown' };
      }
      // Provider prose never reaches a receipt or health. A malformed drop code stays private too.
      const code = item.drop_reason?.code;
      return { status: 'refused', code: code && /^[a-z0-9_-]{1,64}$/u.test(code) ? code : 'message_dropped' };
    } catch (error) {
      if (isTwitchFailure(error) && error.status !== null && error.status >= 400 && error.status < 500) {
        return { status: 'refused', code: `http_${error.status}` };
      }
      return { status: 'unknown' };
    }
  }
}

/** SIMULATED sends are records, with no token, endpoint or network dependency. */
export class RecordingRaidCrierTransport implements RaidCrierTransport {
  readonly origin = 'simulated' as const;
  readonly #records: RaidCrierClaim[] = [];
  constructor(readonly capacity = MAX_CRIER_RECEIPTS) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) throw new Error('Recording crier capacity is invalid');
  }
  get records(): readonly RaidCrierClaim[] { return this.#records.map(claim => ({ ...claim })); }
  async send(raw: RaidCrierClaim): Promise<RaidCrierOutcome> {
    const claim = RaidCrierClaimSchema.parse(raw);
    if (claim.origin !== 'simulated') return { status: 'refused', code: 'origin_mismatch' };
    if (this.#records.length >= this.capacity) return { status: 'refused', code: 'recording_capacity' };
    this.#records.push(claim);
    return { status: 'sent', messageId: `simulated-crier-${this.#records.length}` };
  }
}

type Permission = { readonly ready: true; readonly senderId: PersonId } | { readonly ready: false; readonly reason: string };
/** Uses recorded grants, never guesses moderator status or treats a token alone as permission. */
export function raidCrierPermission(input: { readonly origin: 'live' | 'simulated'; readonly kingdomId: KingdomId;
  readonly login: string; readonly enabled: boolean; readonly report: AuthReport | null; readonly now: number }): Permission {
  if (!input.enabled) return { ready: false, reason: 'operator_disabled' };
  if (input.origin === 'live' && (input.kingdomId !== RAID_CRIER_ALLOWED_LIVE_KINGDOM || input.login !== 'tobi4s_')) {
    return { ready: false, reason: 'channel_not_allowed' };
  }
  const report = input.report;
  if (!report || report.observedAt > input.now + 5_000 || input.now - report.observedAt >= RAID_CRIER_AUTH_MAX_AGE_MS) {
    return { ready: false, reason: 'authorization_stale' };
  }
  if (report.appToken.state !== 'valid' || report.appToken.expiresAt <= input.now) return { ready: false, reason: 'app_token_unavailable' };
  const { reader, broadcaster } = report.accounts;
  if (broadcaster.id !== input.kingdomId || broadcaster.login !== input.login || broadcaster.state !== 'resolved'
    || broadcaster.authorized !== true || !broadcaster.granted.includes('channel:bot')) return { ready: false, reason: 'broadcaster_grant_missing' };
  const senderId = PersonIdSchema.safeParse(reader.id);
  if (!senderId.success || !TwitchLoginSchema.safeParse(reader.login).success || reader.state !== 'resolved' || reader.authorized !== true
    || !reader.granted.includes('user:bot') || !reader.granted.includes('user:write:chat')) return { ready: false, reason: 'reader_grant_missing' };
  if (String(senderId.data) === input.kingdomId) return { ready: false, reason: 'sender_is_broadcaster' };
  return { ready: true, senderId: senderId.data };
}

export interface RaidCrierWorkerOptions {
  readonly origin: 'live' | 'simulated'; readonly kingdomId: KingdomId; readonly login: string;
  /** Live wiring enables this only for HERALD_RAID_CRIER_ENABLED=1. Unset or unknown values stay disabled. */
  readonly enabled: boolean; readonly report: () => AuthReport | null; readonly refreshReport?: () => Promise<AuthReport>;
  readonly realm: { readonly url: string; readonly secret: string }; readonly transport: RaidCrierTransport;
  readonly fetch?: typeof fetch; readonly now?: () => number; readonly intervalMs?: number; readonly retryMs?: number;
}
interface PendingReceipt { readonly receipt: RaidCrierReceipt; failures: number; retryAt: number }

/** Claims are consumed by realm authority before replying. Only outcome receipts retry; chat never does. */
export class RaidCrierWorker {
  readonly #base: URL;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #receipts: PendingReceipt[] = [];
  readonly #seen = new TtlMap<string, true>(RAID_CRIER_LIFETIME_MS + 5_000, 4096);
  #timer: ReturnType<typeof setInterval> | null = null;
  #polling: Promise<void> | null = null;
  #closed = false;
  #fault: 'claim' | 'receipt' | null = null;
  readonly #counters = { polls: 0, claims: 0, duplicateClaims: 0, invalidClaims: 0, claimFailures: 0,
    sent: 0, refused: 0, unknown: 0, receipts: 0, receiptRetries: 0, receiptRefused: 0 };

  constructor(readonly options: RaidCrierWorkerOptions) {
    this.#base = new URL(options.realm.url);
    if (this.#base.username || this.#base.password || this.#base.pathname !== '/' || this.#base.search || this.#base.hash
      || this.#base.protocol !== 'https:' && !(this.#base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(this.#base.hostname))) {
      throw new Error('Crier realm URL must be a service origin');
    }
    if (!/^[\x21-\x7e]{32,512}$/u.test(options.realm.secret)) throw new Error('Crier service secret is invalid');
    if (options.transport.origin !== options.origin) throw new Error('Crier transport origin differs');
    KingdomIdSchema.parse(options.kingdomId); TwitchLoginSchema.parse(options.login);
    for (const interval of [options.intervalMs ?? 1000, options.retryMs ?? 1000]) {
      if (!Number.isInteger(interval) || interval < 1 || interval > 60_000) throw new Error('Crier interval is invalid');
    }
    this.#fetch = options.fetch ?? fetch; this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#timer || this.#closed) return;
    this.#timer = setInterval(() => { void this.poll(); }, this.options.intervalMs ?? 1000);
    this.#timer.unref?.();
    void this.poll();
  }
  health() {
    const permission = this.#permission();
    return { origin: this.options.origin, enabled: this.options.enabled, ready: !this.#closed && permission.ready && this.#receipts.length === 0,
      reason: this.#closed ? 'closed' : !permission.ready ? permission.reason : this.#receipts.length ? 'receipt_pending' : null,
      pendingReceipts: this.#receipts.length, fault: this.#fault, counters: { ...this.#counters } };
  }
  poll(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#polling) return this.#polling;
    const pending = this.#run().catch(() => { this.#fault = 'claim'; this.#counters.claimFailures++; }).finally(() => {
      if (this.#polling === pending) this.#polling = null;
    });
    this.#polling = pending; return pending;
  }
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#polling;
  }
  #permission(): Permission {
    return raidCrierPermission({ origin: this.options.origin, kingdomId: this.options.kingdomId, login: this.options.login,
      enabled: this.options.enabled, report: this.options.report(), now: this.#now() });
  }
  async #run(): Promise<void> {
    this.#counters.polls++;
    await this.#flushReceipts();
    // A missing receipt keeps the last send unknown at the realm; do not claim more work behind it.
    if (this.#closed || this.#receipts.length) return;
    let permission = this.#permission();
    if (!permission.ready && permission.reason === 'authorization_stale' && this.options.refreshReport) {
      await this.options.refreshReport(); permission = this.#permission();
    }
    if (!permission.ready || this.#closed || this.#receipts.length >= MAX_CRIER_RECEIPTS) return;
    const request = RaidCrierClaimRequestSchema.parse({ version: 1, origin: this.options.origin, kingdomId: this.options.kingdomId, senderId: permission.senderId });
    const response = await this.#post(RAID_CRIER_CLAIM_ROUTE, request);
    if (response.status !== 200) { await response.body?.cancel(); this.#fault = 'claim'; this.#counters.claimFailures++; return; }
    const parsed = RaidCrierClaimReplySchema.safeParse(await response.json());
    if (!parsed.success) { this.#counters.invalidClaims++; this.#fault = 'claim'; return; }
    this.#fault = null;
    const claim = parsed.data.claim;
    if (!claim) return;
    if (claim.origin !== request.origin || claim.kingdomId !== request.kingdomId || claim.senderId !== request.senderId) {
      this.#counters.invalidClaims++; this.#fault = 'claim'; return;
    }
    if (this.#seen.has(claim.claimId, this.#now())) { this.#counters.duplicateClaims++; return; }
    this.#seen.set(claim.claimId, true, this.#now()); this.#counters.claims++;
    permission = this.#permission();
    let outcome: RaidCrierOutcome;
    if (this.#closed || !permission.ready || permission.senderId !== claim.senderId) outcome = { status: 'refused', code: 'authorization_changed' };
    else if (claim.expiresAt <= this.#now()) outcome = { status: 'refused', code: 'claim_expired' };
    else {
      try { outcome = RaidCrierOutcomeSchema.parse(await this.options.transport.send(claim)); }
      catch { outcome = { status: 'unknown' }; }
    }
    this.#counters[outcome.status]++;
    this.#receipts.push({ receipt: RaidCrierReceiptSchema.parse({ ...request, claimId: claim.claimId, outcome }), failures: 0, retryAt: 0 });
    await this.#flushReceipts();
  }
  async #flushReceipts(): Promise<void> {
    for (const entry of [...this.#receipts]) {
      if (entry.retryAt > this.#now()) continue;
      try {
        const response = await this.#post(RAID_CRIER_RECEIPT_ROUTE, entry.receipt);
        // Authority says this receipt is invalid or conflicts with a final record. Keep that uncertainty;
        // retiring the local receipt permits later welcomes without ever repeating this chat mutation.
        if (response.status === 409) {
          await response.body?.cancel(); this.#receipts.splice(this.#receipts.indexOf(entry), 1);
          this.#counters.receiptRefused++; this.#fault = null; continue;
        }
        const body: unknown = await response.json();
        if (response.status !== 202 || !body || typeof body !== 'object' || !('status' in body)
          || body.status !== 'accepted' && body.status !== 'duplicate') throw new Error('Crier receipt was not acknowledged');
        this.#receipts.splice(this.#receipts.indexOf(entry), 1); this.#counters.receipts++; this.#fault = null;
      } catch {
        this.#fault = 'receipt'; this.#counters.receiptRetries++; entry.failures++;
        entry.retryAt = this.#now() + Math.min(30_000, (this.options.retryMs ?? 1000) * 2 ** Math.min(5, entry.failures - 1));
      }
    }
  }
  #post(route: typeof RAID_CRIER_CLAIM_ROUTE | typeof RAID_CRIER_RECEIPT_ROUTE, body: unknown): Promise<Response> {
    return this.#fetch(new URL(route, this.#base), { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${this.options.realm.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
  }
}
