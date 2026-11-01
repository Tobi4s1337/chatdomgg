import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { parseTwitchTime, type DeliveryFrame } from '@chatdom/twitch';
import { ChatIngest } from '../ingest/ingest';
import { planSubscriptions, subscriptionIdentity, type SubscriptionPlan } from '../ingest/subscriptions';
import { MemoryBindingStore } from '../source/bindings';
import { presentKingdom } from '../source/kingdom';
import { toPresenceInput, type Observation } from '../source/observations';
import { PresenceSource } from '../source/source';
import type { RealmDelivery } from '../realm-delivery/delivery';

/**
 * SIMULATED EventSub door. Twitch CLI (`twitch event trigger … -F <door> -s <secret>`) and the scripts in
 * `scripts/live/` sign webhook deliveries exactly as Twitch does; the door verifies them, turns them into the
 * same delivery frames the production conduit shard yields, and hands them to the same `ChatIngest`, presence
 * source and durable realm outbox as `herald dev`. Everything it sends to the realm is `origin: 'simulated'`,
 * so a realm configured for live refuses it and no SIMULATED act can ever carry a LIVE label.
 *
 * The CLI still speaks the retired `channel.cheer` v1 and `channel.hype_train.*` v1; production reads
 * `channel.bits.use` v1 and the v2 trains. The door maps the old shapes onto the new ones field by field and
 * marks nothing it cannot know (an all-time high, a shared train) as true. The CLI cannot write a chat notice, so
 * its `channel.subscribe` and `channel.subscription.message` become the `sub` and `resub` notices production reads.
 */
export const MOCK_CONDUIT_ID = 'simulated-mock-door';
/** The reader account the door's chat plans are written for; it reads nothing on Twitch. */
export const MOCK_READER_ID = '900000999';
const MOCK_CLIENT_ID = 'simulatedmockdoor';
/** Twitch refuses deliveries older than ten minutes; so does the door. */
const MAX_AGE_MS = 600_000;
const BODY_LIMIT = 64 * 1024;
/**
 * In production the reconciler re-reads Get Streams so a broadcast stays known while it runs (its lease is three
 * minutes). The door has no Helix to read; it confirms its own SIMULATED broadcast on the same cadence instead.
 */
const STREAM_CONFIRM_MS = 60_000;

export interface MockDoorOptions {
  readonly kingdomId: KingdomId;
  /** The webhook secret both sides sign with, 10–100 characters as Twitch requires. */
  readonly secret: string;
  readonly realm: RealmDelivery;
  readonly port: number;
  readonly host?: string;
  readonly print?: (line: string) => void;
  readonly now?: () => number;
}

export interface MockDoor {
  readonly port: number;
  readonly ingest: ChatIngest;
  readonly source: PresenceSource;
  stop(): Promise<void>;
}

export async function startMockDoor(options: MockDoorOptions): Promise<MockDoor> {
  if (options.secret.length < 10 || options.secret.length > 100) throw new Error('The door secret must be 10–100 characters.');
  const kingdomId = KingdomIdSchema.parse(options.kingdomId), now = options.now ?? Date.now;
  const kingdom = presentKingdom({ seed: `simulated-door-${kingdomId}`, tier: 'hamlet', firstYear: 2026, year: 2026 });
  const source = new PresenceSource({ kingdomId, origin: 'simulated', slots: kingdom.slots, store: new MemoryBindingStore(), realm: options.realm, now });
  await source.open();
  source.setAvailable(true, null);
  const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: MOCK_READER_ID, clientId: MOCK_CLIENT_ID });
  let broadcast: string | null = null;
  const observeStream = (observation: Extract<Observation, { readonly kind: 'stream' }>) => {
    broadcast = observation.live ? observation.streamId : null;
    const input = toPresenceInput(observation, kingdomId, 'simulated');
    if (input) void source.submit(input).catch(() => undefined);
  };
  const confirm = setInterval(() => { if (broadcast !== null) observeStream({ kind: 'stream', at: now(), live: true, streamId: broadcast }); }, STREAM_CONFIRM_MS);
  confirm.unref?.();
  const ingest = new ChatIngest({
    source, realm: options.realm, conduitId: MOCK_CONDUIT_ID, clientId: MOCK_CLIENT_ID, plans, covered: () => true, now, stream: observeStream,
    onAuthorizationRevoked: () => undefined, onSubscriptionRevoked: () => undefined,
  });
  const counts = { delivered: 0, verified: 0, refused: 0, challenges: 0 };
  const server: Server = createServer((request, response) => {
    void handle(request, response).catch(() => reply(response, 500, { error: 'door failure' }));
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === 'GET' && request.url === '/health') {
      return reply(response, 200, { origin: 'simulated', kingdomId, door: counts, ingest: ingest.health().counters, source: source.health(), realm: options.realm.health() });
    }
    if (request.method !== 'POST' || request.url !== '/eventsub') return reply(response, 404, { error: 'not found' });
    const body = await readBody(request);
    if (body === null) { counts.refused++; return reply(response, 413, { error: 'too large' }); }
    const header = (name: string) => { const value = request.headers[name]; return typeof value === 'string' ? value : null; };
    const id = header('twitch-eventsub-message-id'), stamp = header('twitch-eventsub-message-timestamp');
    const signature = header('twitch-eventsub-message-signature'), type = header('twitch-eventsub-message-type');
    if (!id || !stamp || !signature || !type || !verifySignature(options.secret, id, stamp, body, signature)) {
      counts.refused++;
      return reply(response, 403, { error: 'signature' });
    }
    const at = parseTwitchTime(stamp);
    if (at === null || Math.abs(now() - at) > MAX_AGE_MS) { counts.refused++; return reply(response, 403, { error: 'stale' }); }
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { counts.refused++; return reply(response, 400, { error: 'json' }); }
    counts.verified++;
    if (type === 'webhook_callback_verification') {
      counts.challenges++;
      const challenge = (payload as { challenge?: unknown }).challenge;
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end(typeof challenge === 'string' ? challenge : '');
      return;
    }
    if (type !== 'notification') return reply(response, 204, null);
    const frame = toFrame(payload, id, at, plans);
    if (!frame) { counts.refused++; return reply(response, 422, { error: 'not a planned subscription' }); }
    try { await ingest.handle(frame); }
    catch { counts.refused++; return reply(response, 503, { error: 'evidence could not be durably queued' }); }
    counts.delivered++;
    // Raid evidence is on disk before the webhook is acknowledged; refusals remain retryable.
    reply(response, 204, null);
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host ?? '127.0.0.1', () => resolve());
  });
  const address = server.address(), port = typeof address === 'object' && address ? address.port : options.port;
  options.print?.(`Herald mock door · SIMULATED · kingdom ${kingdomId} · POST http://127.0.0.1:${port}/eventsub · GET /health`);
  return {
    port, ingest, source,
    async stop() {
      clearInterval(confirm);
      await new Promise<void>(resolve => server.close(() => resolve()));
      ingest.dispose();
      await source.close();
    },
  };
}

/** Twitch's webhook signature: `sha256=` HMAC-SHA256 over message ID, timestamp and the raw body. */
export function verifySignature(secret: string, id: string, timestamp: string, body: string, signature: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(id + timestamp + body).digest('hex')}`);
  const presented = Buffer.from(signature);
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/**
 * One webhook notification as the shard's delivery frame on the door's own conduit, or null when its
 * subscription is none of Herald's plans for this kingdom (after mapping the CLI's retired versions).
 */
export function toFrame(payload: unknown, messageId: string, at: number, plans: readonly SubscriptionPlan[]): DeliveryFrame | null {
  if (!payload || typeof payload !== 'object') return null;
  const { subscription, event } = payload as { subscription?: { type?: unknown; version?: unknown }; event?: unknown };
  if (!subscription || typeof subscription.type !== 'string' || typeof subscription.version !== 'string' || !event || typeof event !== 'object') return null;
  const adapted = adaptCliEvent(subscription.type, subscription.version, event as Record<string, unknown>);
  const plan = plans.find(candidate => candidate.type === adapted.type && candidate.version === adapted.version
    && (candidate.type !== 'channel.raid' || Object.entries(candidate.condition).every(([key, value]) =>
      (adapted.event as Record<string, unknown>)[key] === value)));
  if (!plan) return null;
  return {
    kind: 'notification', meta: { messageId, at },
    subscription: { id: `simulated-door-${subscriptionIdentity(plan).key}`, status: 'enabled', type: plan.type, version: plan.version, condition: { ...plan.condition }, conduitId: MOCK_CONDUIT_ID },
    event: adapted.event,
  };
}

/** The CLI's v1 cheer and train shapes, mapped onto what production subscribes to. Anything else passes through. */
export function adaptCliEvent(type: string, version: string, event: Record<string, unknown>): { type: string; version: string; event: unknown } {
  if (type === 'channel.cheer' && version === '1') {
    const anonymous = event.is_anonymous === true;
    return { type: 'channel.bits.use', version: '1', event: {
      broadcaster_user_id: event.broadcaster_user_id, broadcaster_user_login: event.broadcaster_user_login, broadcaster_user_name: event.broadcaster_user_name,
      user_id: anonymous ? null : event.user_id ?? null, user_login: anonymous ? null : event.user_login ?? null, user_name: anonymous ? null : event.user_name ?? null,
      bits: event.bits, type: 'cheer', power_up: null,
      message: { text: typeof event.message === 'string' ? event.message : '', fragments: [] },
    } };
  }
  if (type.startsWith('channel.hype_train.') && version === '1') {
    const train: Record<string, unknown> = { ...event, type: event.is_golden_kappa_train === true ? 'golden_kappa' : 'regular', is_shared_train: false, shared_train_participants: null };
    if (type === 'channel.hype_train.begin') Object.assign(train, { all_time_high_level: typeof event.all_time_high_level === 'number' ? event.all_time_high_level : 0, all_time_high_total: 0 });
    delete train.is_golden_kappa_train;
    delete train.last_contribution;
    return { type, version: '2', event: train };
  }
  // Production reads subs from the chat notices a subscriber shares (tier 1); the CLI writes the EventSub sub types.
  if ((type === 'channel.subscribe' || type === 'channel.subscription.message') && version === '1') {
    const tier = event.tier === '2000' || event.tier === '3000' ? event.tier : '1000';
    const resub = type === 'channel.subscription.message';
    const months = typeof event.cumulative_months === 'number' ? event.cumulative_months : 1;
    return { type: 'channel.chat.notification', version: '1', event: {
      broadcaster_user_id: event.broadcaster_user_id, broadcaster_user_login: event.broadcaster_user_login, broadcaster_user_name: event.broadcaster_user_name,
      chatter_user_id: event.user_id, chatter_user_login: event.user_login, chatter_user_name: event.user_name, chatter_is_anonymous: false,
      message_id: `cli-${type}-${String(event.user_id)}-${months}`, notice_type: resub ? 'resub' : 'sub', source_broadcaster_user_id: null,
      ...(resub ? { resub: { cumulative_months: months, sub_tier: tier, is_prime: false, is_gift: false } } : { sub: { sub_tier: tier, is_prime: false } }),
    } };
  }
  return { type, version, event };
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, over = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) over = true;
      else chunks.push(chunk);
    });
    request.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function reply(response: ServerResponse, status: number, body: unknown) {
  if (body === null) { response.writeHead(status).end(); return; }
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}
