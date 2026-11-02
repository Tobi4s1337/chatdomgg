import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { TwitchRequestError, type HelixSession } from '@chatdom/twitch';
import { describe, expect, it, vi } from 'vitest';
import { RAID_CRIER_CLAIM_ROUTE, RAID_CRIER_RECEIPT_ROUTE, RaidCrierClaimRequestSchema, RaidCrierReceiptSchema,
  type RaidCrierClaim, type RaidCrierReceipt } from '../../../api/src/raid-gate/crier-contracts';
import type { AuthReport } from '../auth/authority';
import type { Account } from '../auth/grants';
import { HelixRaidCrierTransport, RAID_CRIER_AUTH_MAX_AGE_MS, RaidCrierWorker, RecordingRaidCrierTransport, raidCrierPermission } from './crier';

const start = 1_800_000_000_000, kingdomId = KingdomIdSchema.parse('129634568'), senderId = PersonIdSchema.parse('789');
const secret = 'simulated-crier-service-secret-0000000000';
function authorization(options: { observedAt?: number; reader?: Partial<Account>; broadcaster?: Partial<Account> } = {}): AuthReport {
  return { observedAt: options.observedAt ?? start, ok: true, problems: [], appToken: { state: 'valid', expiresAt: start + 3600_000 },
    accounts: { reader: { role: 'reader', login: 'simulated_bot', id: senderId, displayName: 'SIMULATED Bot', state: 'resolved', authorized: true,
      granted: ['user:bot', 'user:write:chat'], ...options.reader },
    broadcaster: { role: 'broadcaster', login: 'tobi4s_', id: kingdomId, displayName: 'tobi4s_', state: 'resolved', authorized: true,
      granted: ['channel:bot'], ...options.broadcaster } }, capabilities: [], otherScopes: { reader: [], broadcaster: [] }, failures: [] };
}
const claim = (origin: 'live' | 'simulated' = 'simulated', overrides: Partial<RaidCrierClaim> = {}): RaidCrierClaim => ({
  version: 1, origin, claimId: '00000000-0000-4000-8000-000000000001', raidId: 'raid-exact-id', kingdomId, senderId,
  expiresAt: start + 5000, text: 'SIMULATED MashaD4 arrived! https://simulated.invalid/kingdom/129634568?raid=raid-exact-id', ...overrides });
function rig(origin: 'live' | 'simulated' = 'simulated') {
  const clock = { now: start };
  const state = { report: authorization(), claim: claim(origin) as unknown, claimStatus: 200, receiptStatus: 202,
    receiptResult: 'accepted', holdClaim: null as Promise<void> | null };
  const requests: Array<{ path: string; body: unknown }> = [];
  const receipts: RaidCrierReceipt[] = [];
  const request: typeof fetch = async (url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${secret}`);
    expect(init?.redirect).toBe('error');
    const path = new URL(String(url)).pathname, body: unknown = JSON.parse(String(init?.body)); requests.push({ path, body });
    if (path === RAID_CRIER_CLAIM_ROUTE) {
      RaidCrierClaimRequestSchema.parse(body);
      const picked = state.claim; state.claim = null; // authority consumes BEFORE the response can be lost.
      await state.holdClaim;
      return Response.json({ version: 1, claim: picked }, { status: state.claimStatus });
    }
    expect(path).toBe(RAID_CRIER_RECEIPT_ROUTE); receipts.push(RaidCrierReceiptSchema.parse(body));
    return Response.json({ status: state.receiptResult }, { status: state.receiptStatus });
  };
  const recording = new RecordingRaidCrierTransport();
  const sessionCall = vi.fn<HelixSession['call']>().mockResolvedValue({ status: 200, body: { data: [{ message_id: 'chat-sent-id', is_sent: true }] } });
  const transport = origin === 'simulated' ? recording : new HelixRaidCrierTransport({ call: sessionCall }, () => clock.now);
  const options = { origin, kingdomId, login: 'tobi4s_', enabled: true, report: () => state.report, realm: { url: 'http://127.0.0.1:5191', secret },
    transport, fetch: request, now: () => clock.now, retryMs: 1000 };
  return { clock, state, requests, receipts, recording, sessionCall, options, worker: new RaidCrierWorker(options) };
}

describe('raid crier permission', () => {
  it('requires explicit enablement, fresh exact channel and separate bot grants before any claim', async () => {
    const base = { origin: 'live' as const, kingdomId, login: 'tobi4s_', enabled: true, report: authorization(), now: start };
    expect(raidCrierPermission(base)).toEqual({ ready: true, senderId });
    for (const patch of [{ enabled: false }, { kingdomId: KingdomIdSchema.parse('555') }, { login: 'another_channel' },
      { report: authorization({ reader: { granted: ['user:bot'] } }) }, { report: authorization({ reader: { authorized: false } }) },
      { report: authorization({ broadcaster: { granted: [] } }) }, { report: authorization({ reader: { id: kingdomId } }) },
      { report: authorization({ observedAt: start - RAID_CRIER_AUTH_MAX_AGE_MS }) },
      { report: { ...authorization(), appToken: { state: 'unavailable' as const, reason: 'SIMULATED unavailable' } } }]) {
      expect(raidCrierPermission({ ...base, ...patch }).ready).toBe(false);
    }
    const r = rig('live'); r.state.report = authorization({ reader: { granted: [] } });
    try { await r.worker.poll(); expect(r.requests).toEqual([]); expect(r.sessionCall).not.toHaveBeenCalled(); }
    finally { await r.worker.close(); }
  });
});

describe('live crier transport', () => {
  it('posts exact text as the bot to the source channel only and fences the shared session by claim expiry', async () => {
    const r = rig('live');
    try {
      await r.worker.poll();
      expect(r.sessionCall).toHaveBeenCalledOnce();
      expect(r.sessionCall.mock.calls[0]![0]).toEqual({ operation: 'send raid welcome', method: 'POST', path: 'chat/messages', retryRateLimit: false,
        json: { broadcaster_id: kingdomId, sender_id: senderId, message: claim('live').text, for_source_only: true } });
      expect(r.sessionCall.mock.calls[0]![1]).toMatchObject({ deadline: start + 5000, signal: expect.any(AbortSignal) });
      expect(r.receipts[0]?.outcome).toEqual({ status: 'sent', messageId: 'chat-sent-id' });
    } finally { await r.worker.close(); }
  });

  it.each([
    [{ data: [{ is_sent: false, message_id: '', drop_reason: { code: 'automod_held', message: 'SIMULATED private provider text' } }] }, { status: 'refused', code: 'automod_held' }],
    [{ data: [{ is_sent: false, drop_reason: { code: 'Private Provider Body!' } }] }, { status: 'refused', code: 'message_dropped' }],
    [{ data: [{ is_sent: true, message_id: '' }] }, { status: 'unknown' }],
    [{ data: [{ is_sent: true }] }, { status: 'unknown' }],
    [{ data: [] }, { status: 'unknown' }],
  ])('does not turn a dropped or malformed response into success', async (body, outcome) => {
    const r = rig('live'); r.sessionCall.mockResolvedValue({ status: 200, body });
    try { await r.worker.poll(); expect(r.receipts[0]?.outcome).toEqual(outcome); expect(JSON.stringify(r.worker.health())).not.toContain('private'); }
    finally { await r.worker.close(); }
  });

  it.each([new TwitchRequestError('timeout', 'SIMULATED send'), new Error('SIMULATED private provider body')])('records unknown after an ambiguous mutation failure without retrying chat', async error => {
    const r = rig('live'); r.sessionCall.mockRejectedValue(error);
    try { await r.worker.poll(); await r.worker.poll(); expect(r.sessionCall).toHaveBeenCalledOnce(); expect(r.receipts[0]?.outcome).toEqual({ status: 'unknown' }); }
    finally { await r.worker.close(); }
  });
});

describe('raid crier worker', () => {
  it('records simulated welcomes without any Helix call, and refuses a mismatched transport origin', async () => {
    const r = rig();
    try {
      await r.worker.poll(); expect(r.recording.records).toEqual([claim()]); expect(r.sessionCall).not.toHaveBeenCalled();
      expect(() => new RaidCrierWorker({ ...r.options, transport: new HelixRaidCrierTransport({ call: r.sessionCall }) })).toThrow('origin');
      expect(r.worker.health()).toMatchObject({ origin: 'simulated', pendingReceipts: 0, counters: { claims: 1, sent: 1, receipts: 1 } });
    } finally { await r.worker.close(); }
  });

  it('retries only receipts after a lost realm answer, blocks new claims until resolved, and never reposts a consumed claim after restart', async () => {
    const r = rig(); r.state.receiptStatus = 503;
    try {
      await r.worker.poll(); await r.worker.poll();
      expect(r.requests.filter(request => request.path === RAID_CRIER_CLAIM_ROUTE)).toHaveLength(1);
      expect(r.recording.records).toHaveLength(1);
      r.clock.now += 1000; r.state.receiptStatus = 202; r.state.receiptResult = 'duplicate';
      await r.worker.poll();
      expect(r.receipts).toHaveLength(2); expect(r.receipts[1]).toEqual(r.receipts[0]);
      expect(r.worker.health()).toMatchObject({ pendingReceipts: 0, counters: { sent: 1, receiptRetries: 1, receipts: 1 } });
      await r.worker.close();
      const restarted = new RaidCrierWorker(r.options);
      try { await restarted.poll(); expect(r.recording.records).toHaveLength(1); }
      finally { await restarted.close(); }
    } finally { await r.worker.close(); }
  });

  it('retires a conflicting receipt without claiming success or blocking the next welcome', async () => {
    const r = rig(); r.state.receiptStatus = 409;
    try {
      await r.worker.poll();
      expect(r.worker.health()).toMatchObject({ pendingReceipts: 0, counters: { receipts: 0, receiptRefused: 1 } });
      r.state.receiptStatus = 202;
      r.state.claim = claim('simulated', { claimId: '00000000-0000-4000-8000-000000000002', raidId: 'second-raid' });
      await r.worker.poll();
      expect(r.recording.records.map(value => value.raidId)).toEqual(['raid-exact-id', 'second-raid']);
      expect(r.worker.health().counters).toMatchObject({ sent: 2, receipts: 1, receiptRefused: 1 });
    } finally { await r.worker.close(); }
  });

  it.each([
    claim('live'), claim('simulated', { senderId: PersonIdSchema.parse('456') }),
    claim('simulated', { kingdomId: KingdomIdSchema.parse('555') }), { ...claim(), text: 'SIMULATED\nmalformed' },
  ])('refuses malformed or mismatched claimed evidence', async value => {
    const r = rig(); r.state.claim = value;
    try { await r.worker.poll(); expect(r.recording.records).toEqual([]); expect(r.worker.health().counters.invalidClaims).toBe(1); }
    finally { await r.worker.close(); }
  });

  it('rechecks grants and expiry after the claim response, coalesces polling, and awaits active work on close', async () => {
    for (const change of ['expired', 'revoked', 'closed'] as const) {
      const r = rig(); let release!: () => void;
      r.state.holdClaim = new Promise(resolve => { release = resolve; });
      const first = r.worker.poll(); expect(r.worker.poll()).toBe(first);
      await vi.waitFor(() => expect(r.requests).toHaveLength(1));
      let closing: Promise<void> | null = null;
      if (change === 'expired') r.clock.now += 5000;
      if (change === 'revoked') r.state.report = authorization({ reader: { authorized: false } });
      if (change === 'closed') closing = r.worker.close();
      release(); await first; await closing;
      expect(r.recording.records).toEqual([]);
      expect(r.receipts[0]?.outcome).toEqual({ status: 'refused', code: change === 'expired' ? 'claim_expired' : 'authorization_changed' });
      await r.worker.close();
    }
  });

  it('refreshes stale authorization once before claiming and never repeats an already consumed claim in process', async () => {
    const r = rig(); r.state.report = authorization({ observedAt: start - RAID_CRIER_AUTH_MAX_AGE_MS });
    const refreshReport = vi.fn(async () => { r.state.report = authorization(); return r.state.report; });
    const worker = new RaidCrierWorker({ ...r.options, refreshReport });
    try {
      await worker.poll(); r.state.claim = claim(); await worker.poll();
      expect(refreshReport).toHaveBeenCalledOnce(); expect(r.recording.records).toHaveLength(1);
      expect(worker.health().counters.duplicateClaims).toBe(1);
    } finally { await worker.close(); await r.worker.close(); }
  });
});
