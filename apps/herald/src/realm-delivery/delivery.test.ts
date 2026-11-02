import { CHAT_COMMAND_ROUTE, ChatCommandEnvelopeSchema, KingdomIdSchema, PersonIdSchema, PresenceInputSchema, type PresenceInput } from '@chatdom/shared';
import { RealmHeraldEnvelopeSchema, type RealmMomentObservation, type RealmStrike } from '@chatdom/shared/realm';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ChatIngest } from '../ingest/ingest';
import { planSubscriptions, type HeraldEventType } from '../ingest/subscriptions';
import { MemoryBindingStore } from '../source/bindings';
import { PresenceSource } from '../source/source';
import { MAX_SPECTACLES, MAX_STRIKES_IN_FLIGHT, RealmDelivery, SPECTACLE_LIFETIME_MS } from './delivery';
import { RAID_OBSERVATION_ROUTE, RaidObservationEnvelopeSchema, type RaidObservation } from '../../../api/src/raid-gate/observations';

it('signs person-bound transient delivery, sends cleanup immediately, and retries only normalized durable evidence after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-herald-delivery-'));
  const kingdomId = KingdomIdSchema.parse('123'), now = 1_800_000_000_000;
  const secret = 'simulated-service-secret-000000000000';
  const attempts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let available = false;
  const request: typeof fetch = async (url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${secret}`);
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (path.endsWith('/herald')) expect(RealmHeraldEnvelopeSchema.safeParse(body).success).toBe(true);
    attempts.push({ path, body });
    return Response.json({ version: 1, status: available ? 'accepted' : 'busy' }, { status: available ? 202 : 503 });
  };
  const options = { url: 'http://127.0.0.1:5191', secret, directory, origin: 'live' as const, fetch: request, now: () => now, retryMs: 60_000 };
  let sender = await RealmDelivery.open(options);
  const source = new PresenceSource({ kingdomId, origin: 'live', slots: [], store: new MemoryBindingStore(), realm: sender, now: () => now, tickMs: 0 });
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: '456', clientId: 'simulated-client' });
  const ingest = new ChatIngest({ source, conduitId: 'simulated-conduit', clientId: 'simulated-client', plans,
    covered: () => true, onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, realm: sender, now: () => now });
  let sequence = 0;
  const deliver = (type: HeraldEventType, event: Record<string, unknown>) => {
    const plan = plans.find(plan => plan.type === type)!;
    ingest.handle({ kind: 'notification', meta: { messageId: `delivery-${++sequence}`, at: now },
      subscription: { id: 'simulated-subscription', status: 'enabled', type, version: plan.version,
        condition: plan.condition, conduitId: 'simulated-conduit' }, event: { broadcaster_user_id: kingdomId, ...event } });
  };
  try {
    await source.open(); source.setAvailable(true);
    await source.submit({ version: 1, id: 'stream:start', kingdomId, kind: 'stream', origin: 'live', observedAt: now, live: true, sessionId: 'session:simulated' });
    deliver('channel.chat.message', { chatter_user_id: '789', chatter_user_name: 'SIMULATED', message_id: 'speech-1',
      message: { text: 'SIMULATED ordinary speech' } });
    deliver('channel.chat.message', { chatter_user_id: '789', chatter_user_name: 'SIMULATED', message_id: 'wish-1',
      message: { text: '!forge SIMULATED private copper dragon' } });
    await vi.waitFor(() => expect(attempts.filter(attempt => 'chat' in attempt.body || 'forge' in attempt.body)).toHaveLength(2));
    const chat = attempts.find(attempt => 'chat' in attempt.body)!.body.chat;
    expect(chat).toMatchObject({ id: 'speech-1', personId: '789' });
    expect(chat).not.toHaveProperty('slot'); expect(chat).not.toHaveProperty('epoch');
    expect(JSON.stringify(chat)).not.toContain('copper dragon');
    expect(attempts.find(attempt => 'forge' in attempt.body)!.body).toMatchObject({ forge: { type: 'wish', origin: 'live', command: { personId: '789', slot: 0, words: 'SIMULATED private copper dragon' } } });
    // With no source presentation slots, the wish still reaches actual Realm home authority.
    expect(source.boundSlot(PersonIdSchema.parse('789'))).toBeNull();
    deliver('channel.chat.message_delete', { target_user_id: '789', message_id: 'wish-1' });
    deliver('channel.chat.clear_user_messages', { target_user_id: '789' });
    deliver('channel.chat.clear', {});
    await vi.waitFor(() => expect(sender.health().counters.accepted).toBe(7));
    source.setAvailable(false, 'chat_delivery_down');
    await source.close();
    await vi.waitFor(() => expect(sender.health().transient).toBe(0));
    await sender.close();
    const transient = attempts.filter(attempt => attempt.path.endsWith('/herald'));
    expect(transient.some(attempt => 'forge' in attempt.body && (attempt.body.forge as { type: string }).type === 'cancel')).toBe(true);
    expect(transient.some(attempt => 'chatCleanup' in attempt.body && (attempt.body.chatCleanup as { personId?: string }).personId === '789')).toBe(true);
    const files = (await readdir(directory)).filter(file => file.endsWith('.json')).sort();
    const retained = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')));
    expect(retained.length).toBeGreaterThan(3);
    expect(retained.join('')).not.toContain('ordinary speech');
    expect(retained.join('')).not.toContain('copper dragon');
    const stored: unknown[] = retained.map(text => JSON.parse(text));
    const normalized = stored.flatMap(input => { const parsed = PresenceInputSchema.safeParse(input); return parsed.success ? [parsed.data] : []; });
    const cleanups = stored.flatMap(input => { const parsed = ChatCommandEnvelopeSchema.safeParse(input); return parsed.success ? [parsed.data] : []; });
    expect(cleanups).toHaveLength(3);
    expect(normalized.some(input => input.kind === 'source-lost')).toBe(true);
    expect(normalized.some(input => input.kind === 'remove')).toBe(true);
    const beforeRestart = attempts.length;
    available = true;
    sender = await RealmDelivery.open(options);
    await sender.flush();
    expect(sender.health().pending).toBe(0);
    expect(attempts.slice(beforeRestart)).toHaveLength(files.length);
    expect(attempts.slice(beforeRestart).every(attempt => attempt.path.endsWith('/ingress') || attempt.path === CHAT_COMMAND_ROUTE)).toBe(true);
    expect(attempts.slice(beforeRestart).filter(attempt => attempt.path === CHAT_COMMAND_ROUTE).map(attempt => attempt.body)).toEqual(cleanups);
    const replayed = attempts.slice(beforeRestart).filter(attempt => attempt.path.endsWith('/ingress')).map(attempt => attempt.body.observation as PresenceInput);
    expect(replayed.map(input => input.id).sort()).toEqual(normalized.map(input => input.id).sort());
    expect(replayed[0]?.kind).toBe('remove');
    expect((await readdir(directory)).filter(file => file.endsWith('.json'))).toEqual([]);
  } finally {
    ingest.dispose(); await source.close(); await sender.close();
    await rm(directory, { recursive: true, force: true });
  }
});


it('persists only verified normalized support and retries it after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-support-delivery-'));
  const kingdomId = KingdomIdSchema.parse('123'), now = 1_800_000_000_000;
  let available = false, covered = true;
  const attempts: Record<string, unknown>[] = [];
  const request: typeof fetch = async (_url, init) => {
    attempts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ status: available ? 'accepted' : 'busy' }, { status: available ? 202 : 503 });
  };
  const options = { url: 'http://127.0.0.1:5191', secret: 'simulated-service-secret-000000000000', directory,
    origin: 'live' as const, fetch: request, now: () => now, retryMs: 60_000 };
  let sender = await RealmDelivery.open(options);
  const source = new PresenceSource({ kingdomId, origin: 'live', slots: [], store: new MemoryBindingStore(), now: () => now, tickMs: 0 });
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: '456', clientId: 'simulated-client' });
  const ingest = new ChatIngest({ source, conduitId: 'conduit', clientId: 'simulated-client', plans, realm: sender,
    covered: () => covered, onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, now: () => now });
  const plan = plans.find(p => p.type === 'channel.chat.notification')!;
  expect(plan.required).toBe(false);
  const event = { broadcaster_user_id: kingdomId, chatter_user_id: '789', chatter_user_name: 'Supporter', chatter_is_anonymous: false,
    message_id: 'notice-1', notice_type: 'sub', sub: { sub_tier: '1000', is_prime: false },
    message: { text: 'private raw text' }, system_message: 'private system text' };
  const frame = (id: string, condition = plan.condition) => ({ kind: 'notification' as const, meta: { messageId: id, at: now },
    subscription: { id: 'subscription', status: 'enabled', type: plan.type, version: plan.version, condition, conduitId: 'conduit' }, event });
  try {
    ingest.handle(frame('wrong', { ...plan.condition, user_id: '999' }));
    covered = false; ingest.handle(frame('uncovered'));
    covered = true; ingest.handle(frame('valid')); ingest.handle(frame('valid'));
    await vi.waitFor(() => expect(sender.health().counters.accepted).toBe(1));
    await vi.waitFor(() => expect(sender.health().fault).toBe('delivery'));
    await sender.close();
    const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
    expect(files).toHaveLength(1);
    const retained = await readFile(join(directory, files[0]!), 'utf8');
    expect(retained).not.toContain('private');
    expect(JSON.parse(retained)).toMatchObject({ version: 1, support: { id: 'valid', notice: { kind: 'entitlement', personId: '789' } } });
    expect(ingest.health().counters).toMatchObject({ unverified: 1, notCovered: 1, duplicateDeliveries: 1 });
    available = true; const before = attempts.length;
    sender = await RealmDelivery.open(options); await sender.flush();
    expect(sender.health().pending).toBe(0);
    expect(attempts.slice(before)).toEqual([JSON.parse(retained)]);
  } finally {
    await sender.close(); await rm(directory, { recursive: true, force: true });
  }
});

describe('spectacles', () => {
  const kingdomId = KingdomIdSchema.parse('123'), start = 1_800_000_000_000, retryMs = 1_000;
  const secret = 'simulated-service-secret-000000000000';
  const raid = (id: string, at: number): RealmMomentObservation => ({ version: 1, id, kingdomId, origin: 'live', occurredAt: at, receivedAt: at,
    notice: { kind: 'raid', from: { kingdomId: KingdomIdSchema.parse('555'), login: 'neighbour', name: 'SIMULATED Neighbour' }, viewers: 12 } });
  const strike = (messageId: string, at: number): RealmStrike => ({ version: 1, kingdomId, personId: PersonIdSchema.parse('789'), messageId,
    origin: 'live', observedAt: at });
  const presence = (id: string, at: number): PresenceInput => ({ version: 1, id, kingdomId, kind: 'stream', origin: 'live', observedAt: at,
    live: true, sessionId: 'session:simulated' });

  /** A realm that answers each kind of evidence on its own terms, and a clock the test moves. */
  async function rig() {
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-spectacle-delivery-'));
    const clock = { now: start };
    const realm = { moments: 503, observations: 202, strikes: 202, hold: null as Promise<void> | null, holdObservations: null as Promise<void> | null };
    const attempts: Array<{ path: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const request: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      attempts.push({ path: new URL(String(url)).pathname, authorization: new Headers(init?.headers).get('authorization'), body });
      if ('strike' in body && realm.hold) await realm.hold;
      if ('observation' in body && realm.holdObservations) await realm.holdObservations;
      const status = 'moment' in body ? realm.moments : 'strike' in body ? realm.strikes : realm.observations;
      return Response.json({ version: 1, status: status === 202 ? 'accepted' : 'busy' }, { status });
    };
    const options = { url: 'http://127.0.0.1:5191', secret, directory, origin: 'live' as const, fetch: request, now: () => clock.now, retryMs };
    const files = async () => (await readdir(directory)).filter(file => file.endsWith('.json'));
    const of = (kind: 'moment' | 'strike' | 'observation') => attempts.filter(attempt => kind in attempt.body);
    return { directory, clock, realm, attempts, options, files, of, cleanup: () => rm(directory, { recursive: true, force: true }) };
  }

  it('posts a moment to the realm ingress with the bearer and forgets it once the realm takes it', async () => {
    const r = await rig(); r.realm.moments = 202;
    const sender = await RealmDelivery.open(r.options);
    try {
      const moment = raid('raid-1', start);
      await sender.moment(moment); await sender.flush();
      expect(r.of('moment')).toEqual([{ path: '/internal/realm/ingress', authorization: `Bearer ${secret}`, body: { version: 1, moment } }]);
      expect(sender.health()).toMatchObject({ pending: 0, spectacles: 0, bytes: 0, fault: null, counters: { accepted: 1, delivered: 1 } });
      expect(await r.files()).toEqual([]);
    } finally { await sender.close(); await r.cleanup(); }
  });

  it('keeps a moment the realm has not taken across a restart and delivers it from the outbox', async () => {
    const r = await rig();
    let sender = await RealmDelivery.open(r.options);
    try {
      const moment = raid('raid-1', start);
      await sender.moment(moment);
      await vi.waitFor(() => expect(sender.health().counters.retries).toBe(1));
      expect(sender.health()).toMatchObject({ pending: 1, spectacles: 1, fault: null });
      await sender.close();
      const files = await r.files();
      expect(files).toHaveLength(1);
      expect(JSON.parse(await readFile(join(r.directory, files[0]!), 'utf8'))).toEqual({ version: 1, moment });

      r.realm.moments = 202; const before = r.attempts.length;
      sender = await RealmDelivery.open(r.options); await sender.flush();
      expect(r.attempts.slice(before)).toEqual([{ path: '/internal/realm/ingress', authorization: `Bearer ${secret}`, body: { version: 1, moment } }]);
      expect(sender.health()).toMatchObject({ pending: 0, spectacles: 0, counters: { delivered: 1 } });
      expect(await r.files()).toEqual([]);
    } finally { await sender.close(); await r.cleanup(); }
  });

  it('never holds presence behind a spectacle the realm refuses, and retries the spectacle on its own backoff', async () => {
    const r = await rig();
    const sender = await RealmDelivery.open(r.options);
    try {
      await sender.moment(raid('raid-1', start));
      await sender.observation(presence('stream:start', start));
      await vi.waitFor(() => expect(sender.health().counters.delivered).toBe(1));
      expect(r.of('observation')).toHaveLength(1);
      expect(r.of('moment')).toHaveLength(1);
      expect(sender.health()).toMatchObject({ pending: 1, spectacles: 1, fault: null, counters: { retries: 1 } });

      // Later presence still flows while the spectacle waits for its clock.
      await sender.observation(presence('stream:again', start + 10)); await sender.flush();
      expect(r.of('observation')).toHaveLength(2);
      expect(r.of('moment')).toHaveLength(1);

      r.clock.now = start + retryMs - 1; await sender.flush();
      expect(r.of('moment')).toHaveLength(1);
      r.clock.now = start + retryMs; await sender.flush();
      expect(r.of('moment')).toHaveLength(2);
      // The second refusal doubles the wait.
      r.clock.now = start + retryMs + 2 * retryMs - 1; await sender.flush();
      expect(r.of('moment')).toHaveLength(2);
      r.realm.moments = 202;
      r.clock.now = start + 3 * retryMs; await sender.flush();
      expect(r.of('moment')).toHaveLength(3);
      expect(sender.health()).toMatchObject({ pending: 0, spectacles: 0, fault: null, counters: { delivered: 3, retries: 2, expired: 0 } });
      expect(await r.files()).toEqual([]);
    } finally { await sender.close(); await r.cleanup(); }
  });

  it('sends a spectacle ahead of the presence a chat burst has queued, so the beat is not late', async () => {
    const r = await rig(); r.realm.moments = 202;
    let release!: () => void;
    r.realm.holdObservations = new Promise<void>(resolve => { release = resolve; });
    const sender = await RealmDelivery.open(r.options);
    try {
      // The realm is still taking the first presence post when the burst and then the spectacle arrive.
      void sender.observation(presence('chat:0', start));
      await vi.waitFor(() => expect(r.of('observation')).toHaveLength(1));
      for (let i = 1; i <= 3; i++) await sender.observation(presence(`chat:${i}`, start + i));
      await sender.moment(raid('raid-1', start + 4));
      r.realm.holdObservations = null; release();
      await vi.waitFor(() => expect(sender.health().pending).toBe(0));
      const order = r.attempts.map(attempt => 'moment' in attempt.body ? 'moment' : String((attempt.body.observation as { id: string }).id));
      expect(order).toEqual(['chat:0', 'moment', 'chat:1', 'chat:2', 'chat:3']);
    } finally { await sender.close(); await r.cleanup(); }
  });

  it('lets a spectacle go as expired once its lifetime has passed rather than retrying it forever', async () => {
    const r = await rig();
    const sender = await RealmDelivery.open(r.options);
    try {
      await sender.moment(raid('raid-1', start));
      await vi.waitFor(() => expect(sender.health().counters.retries).toBe(1));
      r.clock.now = start + SPECTACLE_LIFETIME_MS; await sender.flush();
      expect(r.of('moment')).toHaveLength(2);
      expect(sender.health()).toMatchObject({ spectacles: 1, counters: { expired: 0 } });
      r.clock.now = start + SPECTACLE_LIFETIME_MS + 2 * retryMs; await sender.flush();
      expect(r.of('moment')).toHaveLength(3);
      expect(sender.health()).toMatchObject({ pending: 0, spectacles: 0, counters: { expired: 1, delivered: 0 } });
      expect(await r.files()).toEqual([]);
      r.clock.now += 60 * 60_000; await sender.flush();
      expect(r.of('moment')).toHaveLength(3);
    } finally { await sender.close(); await r.cleanup(); }
  });

  it('holds at most its spectacle cap waiting and still takes presence beyond it', async () => {
    const r = await rig();
    const sender = await RealmDelivery.open(r.options);
    try {
      for (let i = 0; i < MAX_SPECTACLES; i++) await sender.moment(raid(`raid-${i}`, start));
      expect(sender.health()).toMatchObject({ spectacles: MAX_SPECTACLES, counters: { accepted: MAX_SPECTACLES, refused: 0 } });
      await sender.moment(raid('raid-overflow', start));
      expect(sender.health()).toMatchObject({ spectacles: MAX_SPECTACLES, fault: 'capacity', counters: { accepted: MAX_SPECTACLES, refused: 1 } });
      expect(await r.files()).toHaveLength(MAX_SPECTACLES);
      await sender.observation(presence('stream:start', start)); await sender.flush();
      expect(r.of('observation')).toHaveLength(1);
      expect(sender.health()).toMatchObject({ pending: MAX_SPECTACLES, counters: { accepted: MAX_SPECTACLES + 1, delivered: 1 } });
    } finally { await sender.close(); await r.cleanup(); }
  }, 60_000);

  it('relays a strike once and transiently, never into the outbox, and drops it when its chat is gone or the crowd is too many', async () => {
    const r = await rig();
    const sender = await RealmDelivery.open(r.options);
    try {
      sender.strike(strike('strike-1', start), () => true);
      await vi.waitFor(() => expect(sender.health().counters.strikesSent).toBe(1));
      expect(r.of('strike')).toEqual([{ path: '/internal/realm/ingress', authorization: `Bearer ${secret}`, body: { version: 1, strike: strike('strike-1', start) } }]);
      expect(await r.files()).toEqual([]);
      expect(sender.health()).toMatchObject({ pending: 0, counters: { accepted: 0, strikesSent: 1, strikesDropped: 0 } });

      sender.strike(strike('strike-gone', start), () => false);
      sender.strike({ ...strike('strike-simulated', start), origin: 'simulated' }, () => true);
      expect(sender.health().counters).toMatchObject({ strikesSent: 1, strikesDropped: 2 });

      r.realm.strikes = 503;
      sender.strike(strike('strike-refused', start), () => true);
      await vi.waitFor(() => expect(sender.health().counters.strikesDropped).toBe(3));
      expect(r.of('strike')).toHaveLength(2);

      r.realm.strikes = 202;
      let release!: () => void;
      r.realm.hold = new Promise(resolve => { release = resolve; });
      for (let i = 0; i < MAX_STRIKES_IN_FLIGHT; i++) sender.strike(strike(`strike-crowd-${i}`, start), () => true);
      sender.strike(strike('strike-one-too-many', start), () => true);
      expect(sender.health().counters).toMatchObject({ strikesSent: 1, strikesDropped: 4 });
      release();
      await vi.waitFor(() => expect(sender.health().counters.strikesSent).toBe(1 + MAX_STRIKES_IN_FLIGHT));
      expect(r.of('strike')).toHaveLength(2 + MAX_STRIKES_IN_FLIGHT);
      expect(r.of('strike').some(attempt => (attempt.body.strike as RealmStrike).messageId === 'strike-one-too-many')).toBe(false);
      // Room again once the crowd's strikes have landed; none of them was ever written down.
      sender.strike(strike('strike-after', start), () => true);
      await vi.waitFor(() => expect(sender.health().counters.strikesSent).toBe(2 + MAX_STRIKES_IN_FLIGHT));
      expect(sender.health()).toMatchObject({ pending: 0, counters: { accepted: 0, retries: 0 } });
      expect(await r.files()).toEqual([]);
    } finally { await sender.close(); await r.cleanup(); }
  });
});

describe('durable raid observations', () => {
  const start = 1_800_000_000_000, kingdomId = KingdomIdSchema.parse('123');
  const raid = (origin: 'live' | 'simulated' = 'live'): RaidObservation => ({ version: 1, id: 'eventsub-exact-raid-id', origin,
    kingdomId, direction: 'outgoing', occurredAt: start - 100, receivedAt: start,
    from: { kingdomId, login: 'simulated_source', name: 'SIMULATED Source' },
    to: { kingdomId: KingdomIdSchema.parse('555'), login: 'simulated_destination', name: 'SIMULATED Destination' }, viewers: 70_000 });

  it.each(['live', 'simulated'] as const)('retains %s evidence beyond spectacle age, survives a lost answer and restart, and never blocks presence retries', async origin => {
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-raid-delivery-'));
    let now = start, available = false, loseAnswer = false;
    const received = new Set<string>();
    const attempts: Array<{ path: string; body: Record<string, unknown> }> = [];
    const request: typeof fetch = async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer simulated-service-secret-000000000000');
      const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      attempts.push({ path, body });
      if ('raid' in body) {
        expect(path).toBe(RAID_OBSERVATION_ROUTE);
        const observation = RaidObservationEnvelopeSchema.parse(body).raid;
        if (!available) return Response.json({ status: 'busy' }, { status: 503 });
        const duplicate = received.has(observation.id); received.add(observation.id);
        if (loseAnswer) throw new Error('SIMULATED answer lost after realm commit');
        return Response.json({ status: duplicate ? 'duplicate' : 'accepted' }, { status: 202 });
      }
      expect(path).toBe('/internal/realm/ingress');
      return Response.json({ status: 'accepted' }, { status: 202 });
    };
    const options = { url: 'http://127.0.0.1:5191', secret: 'simulated-service-secret-000000000000', directory,
      origin, fetch: request, now: () => now, retryMs: 60_000 };
    let sender = await RealmDelivery.open(options);
    try {
      const input = raid(origin), envelope = { version: 1, raid: input };
      await sender.raid(input); await sender.flush();
      expect(sender.health()).toMatchObject({ raids: 1, pending: 1, fault: 'delivery', counters: { accepted: 1, retries: 1 } });
      await sender.observation({ version: 1, id: 'stream:start', kingdomId, origin, observedAt: now, kind: 'stream', live: true, sessionId: 'SIMULATED' });
      await sender.flush();
      expect(attempts.filter(attempt => 'observation' in attempt.body)).toHaveLength(1);
      expect(sender.health()).toMatchObject({ raids: 1, fault: 'delivery', counters: { delivered: 1 } });
      now += SPECTACLE_LIFETIME_MS + 60_000;
      await sender.flush();
      expect(sender.health()).toMatchObject({ raids: 1, counters: { expired: 0 } });
      available = true; loseAnswer = true; now += 60_000;
      await sender.flush();
      expect(received.size).toBe(1);
      expect(sender.health()).toMatchObject({ raids: 1, counters: { expired: 0 } });
      await sender.close();
      const files = (await readdir(directory)).filter(file => file.endsWith('.json'));
      expect(files).toHaveLength(1);
      expect(JSON.parse(await readFile(join(directory, files[0]!), 'utf8'))).toEqual(envelope);
      loseAnswer = false; now += 24 * 60 * 60_000;
      sender = await RealmDelivery.open(options); await sender.flush();
      expect(sender.health()).toMatchObject({ raids: 0, pending: 0, fault: null, counters: { delivered: 1, expired: 0 } });
      expect(received.size).toBe(1);
      expect(attempts.filter(attempt => 'raid' in attempt.body).every(attempt => JSON.stringify(attempt.body) === JSON.stringify(envelope))).toBe(true);
      expect((await readdir(directory)).filter(file => file.endsWith('.json'))).toEqual([]);
      await sender.close();
      await expect(sender.raid(input)).rejects.toThrow('closed');
      expect(sender.health().counters.refused).toBe(1);
    } finally { await sender.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it('rejects raid overflow without claiming acceptance and leaves capacity for presence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-raid-capacity-'));
    const sender = await RealmDelivery.open({ url: 'http://127.0.0.1:5191', secret: 'simulated-service-secret-000000000000',
      directory, origin: 'live', now: () => start, retryMs: 60_000,
      fetch: async () => Response.json({ status: 'busy' }, { status: 503 }) });
    try {
      for (let index = 0; index < MAX_SPECTACLES; index++) await sender.raid({ ...raid(), id: `raid-${index}` });
      await expect(sender.raid({ ...raid(), id: 'overflow' })).rejects.toThrow('capacity');
      expect(sender.health()).toMatchObject({ raids: MAX_SPECTACLES, counters: { accepted: MAX_SPECTACLES, refused: 1 } });
      await sender.observation({ version: 1, id: 'presence', kingdomId, kind: 'stream', origin: 'live', observedAt: start, live: true, sessionId: 'SIMULATED' });
      expect(sender.health().counters.accepted).toBe(MAX_SPECTACLES + 1);
    } finally { await sender.close(); await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('delivers a raid while presence is waiting for its own retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-raid-presence-retry-'));
    const attempts: string[] = [];
    const sender = await RealmDelivery.open({ url: 'http://127.0.0.1:5191', secret: 'simulated-service-secret-000000000000',
      directory, origin: 'live', now: () => start, retryMs: 60_000, fetch: async (url) => {
        const path = new URL(String(url)).pathname; attempts.push(path);
        return path === RAID_OBSERVATION_ROUTE ? Response.json({ status: 'accepted' }, { status: 202 })
          : Response.json({ status: 'busy' }, { status: 503 });
      } });
    try {
      await sender.observation({ version: 1, id: 'presence', kingdomId, kind: 'stream', origin: 'live', observedAt: start, live: true, sessionId: 'SIMULATED' });
      await sender.flush();
      expect(sender.health()).toMatchObject({ pending: 1, counters: { retries: 1 } });
      await sender.raid(raid()); await sender.flush();
      expect(attempts).toEqual(['/internal/realm/ingress', RAID_OBSERVATION_ROUTE]);
      expect(sender.health()).toMatchObject({ pending: 1, raids: 0, fault: 'delivery', counters: { delivered: 1 } });
    } finally { await sender.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
