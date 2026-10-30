// CONDUIT setup — app-token EventSub for many channels / chat bots, delivered over WebSocket or webhook shards.
//
// Flow (references/conduits.md):
//   1. app access token (client credentials) — conduits never use user tokens
//   2. reuse an existing conduit or create one (max 5 enabled conduits per client id; shards are 0-based)
//   3. assign a transport to every shard (PATCH /eventsub/conduits/shards, ≤100 shards per call)
//        websocket shard: connect, and within 10 s of the welcome PATCH the shard with that session_id
//        webhook shard:   https callback on 443 + secret; Twitch sends a challenge to verify the shard
//   4. create subscriptions with transport { method: 'conduit', conduit_id } (app token)
//   5. watch for disabled shards (subscribe to conduit.shard.disabled, or poll GET shards) and re-assign them
//
// Run (WebSocket shard, one process):
//   TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… TWITCH_BROADCASTER_ID=… TWITCH_BOT_ID=… node conduit-setup.ts
// Webhook shards instead: also set CONDUIT_WEBHOOK_CALLBACK=https://your.host/eventsub and TWITCH_EVENTSUB_SECRET=…
// Chat via conduit (app token): bot granted user:read:chat + user:bot, broadcaster granted channel:bot (or bot is a mod).

import { pathToFileURL } from 'node:url';
import type { EventSubTransport } from './types.ts';
import { EventSubWsClient } from './eventsub-ws-client.ts';
import { ensureSubscription, getAppAccessToken, type HelixAuth, HelixError } from './subscribe.ts';

export type Conduit = { id: string; shard_count: number };
export type Shard = { id: string; status: string; transport: Record<string, string> };
type ShardUpdate = { id: string; transport: Exclude<EventSubTransport, { method: 'conduit' }> };

const base = (a: HelixAuth) => a.helixBase ?? 'https://api.twitch.tv/helix';
async function helix<T>(a: HelixAuth, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base(a)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${a.token}`, 'Client-Id': a.clientId, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new HelixError(res.status, text, `${method} ${path}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export const getConduits = (a: HelixAuth) => helix<{ data: Conduit[] }>(a, 'GET', '/eventsub/conduits').then((r) => r.data);
export const createConduit = (a: HelixAuth, shard_count: number) =>
  helix<{ data: Conduit[] }>(a, 'POST', '/eventsub/conduits', { shard_count }).then((r) => r.data[0]!);
/** Scale up/down. Lowering the count disables the shards above it (e.g. 100 → 50 disables 50–99). */
export const updateConduit = (a: HelixAuth, id: string, shard_count: number) =>
  helix<{ data: Conduit[] }>(a, 'PATCH', '/eventsub/conduits', { id, shard_count }).then((r) => r.data[0]!);
export const deleteConduit = (a: HelixAuth, id: string) => helix<unknown>(a, 'DELETE', `/eventsub/conduits?id=${encodeURIComponent(id)}`);

/** Assign transports to shards. Chunked to the documented 100-shards-per-request limit; per-shard errors are returned, not thrown. */
export async function updateShards(a: HelixAuth, conduitId: string, shards: ShardUpdate[]): Promise<{ data: Shard[]; errors: Array<{ id: string; message: string; code: string }> }> {
  const out = { data: [] as Shard[], errors: [] as Array<{ id: string; message: string; code: string }> };
  for (let i = 0; i < shards.length; i += 100) {
    const r = await helix<{ data: Shard[]; errors?: Array<{ id: string; message: string; code: string }> }>(
      a, 'PATCH', '/eventsub/conduits/shards', { conduit_id: conduitId, shards: shards.slice(i, i + 100) });
    out.data.push(...r.data);
    out.errors.push(...(r.errors ?? []));
  }
  return out;
}

/** All shards (paginated). Optional status filter, e.g. 'websocket_disconnected'. */
export async function getShards(a: HelixAuth, conduitId: string, status?: string): Promise<Shard[]> {
  const all: Shard[] = [];
  let after = '';
  do {
    const q = new URLSearchParams({ conduit_id: conduitId });
    if (status) q.set('status', status);
    if (after) q.set('after', after);
    const r = await helix<{ data: Shard[]; pagination?: { cursor?: string } }>(a, 'GET', `/eventsub/conduits/shards?${q}`);
    all.push(...r.data);
    after = r.pagination?.cursor ?? '';
  } while (after);
  return all;
}

/** Reuse the first conduit (they survive restarts; deleted only after 72 h with no enabled shard) or create one. */
export async function ensureConduit(a: HelixAuth, shardCount: number): Promise<Conduit> {
  const existing = await getConduits(a);
  if (existing[0]) {
    if (existing[0].shard_count !== shardCount) return updateConduit(a, existing[0].id, shardCount);
    return existing[0];
  }
  return createConduit(a, shardCount);
}

// ------------------------------------------------------------------ demo
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (k: string): string => {
    const v = process.env[k];
    if (!v) { console.error(`missing env ${k}`); process.exit(1); }
    return v;
  };
  const clientId = env('TWITCH_CLIENT_ID');
  const { access_token } = await getAppAccessToken(clientId, env('TWITCH_CLIENT_SECRET'));
  const auth: HelixAuth = { clientId, token: access_token, helixBase: process.env.TWITCH_HELIX_URL };
  const broadcaster = env('TWITCH_BROADCASTER_ID');
  const bot = process.env.TWITCH_BOT_ID ?? broadcaster;

  const conduit = await ensureConduit(auth, 1);
  console.log(`conduit ${conduit.id} (${conduit.shard_count} shard(s))`);

  const callback = process.env.CONDUIT_WEBHOOK_CALLBACK;
  if (callback) {
    // Webhook shard: Twitch verifies it with a challenge whose body has `conduit_shard` instead of `subscription`.
    const r = await updateShards(auth, conduit.id, [{ id: '0', transport: { method: 'webhook', callback, secret: env('TWITCH_EVENTSUB_SECRET') } }]);
    console.log('shard 0 →', r.data[0]?.status ?? r.errors);
  } else {
    // WebSocket shard: no subscriptions are created over the socket itself (that needs a user token);
    // instead bind the session to shard 0 on every welcome (fresh connects AND reconnects).
    const ws = new EventSubWsClient({ clientId, getUserToken: () => '', subscriptions: [], url: process.env.EVENTSUB_WS_URL });
    ws.onSessionReady = (sessionId) => {
      updateShards(auth, conduit.id, [{ id: '0', transport: { method: 'websocket', session_id: sessionId } }])
        .then((r) => console.log('shard 0 →', r.data[0]?.status ?? JSON.stringify(r.errors)))
        .catch((e) => console.error('shard update failed', e));
    };
    ws.onAny((e) => {
      if (e.type === 'channel.chat.message') console.log(`[chat] ${e.event.chatter_user_name}: ${e.event.message.text}`);
      else console.log(`[${e.type}]`, JSON.stringify(e.event));
    });
    ws.start();
    await new Promise((r) => setTimeout(r, 3000)); // let the shard bind before subscribing
  }

  const transport = { method: 'conduit', conduit_id: conduit.id } as const;
  for (const sub of [
    ensureSubscription(auth, { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: broadcaster, user_id: bot }, transport }),
    ensureSubscription(auth, { type: 'stream.online', version: '1', condition: { broadcaster_user_id: broadcaster }, transport }),
    ensureSubscription(auth, { type: 'conduit.shard.disabled', version: '1', condition: { client_id: clientId, conduit_id: conduit.id }, transport }),
  ]) {
    try {
      const r = await sub;
      console.log(r ? `subscribed ${r.subscription.type} (cost ${r.subscription.cost})` : 'already subscribed (409)');
    } catch (e) {
      console.error(String(e)); // 403 = the user in the condition never authorized your client id with the scope
    }
  }
}
