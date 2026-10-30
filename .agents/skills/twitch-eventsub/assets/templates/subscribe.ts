// Helix helpers for EventSub subscriptions — create / list / delete / cleanup. Zero dependencies (fetch).
//
// Token rules (the #1 source of 401s):
//   transport webhook | conduit → APP access token (client-credentials). The user in the condition must have
//                                 authorized YOUR client id with the needed scopes beforehand.
//   transport websocket         → USER access token of that user (app token → 401/400).
//   list/delete use the same token type that created the subscription.
//
// CLI usage (env: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET for app token, or TWITCH_TOKEN to use a given token):
//   node subscribe.ts list [status=enabled|type=channel.follow|user_id=123|conduit_id=…|subscription_id=…]
//   node subscribe.ts create-webhook <type> <version> '<condition json>' <https callback> <secret>
//   node subscribe.ts delete <subscription id>
//   node subscribe.ts cleanup            # delete every subscription that is not enabled/pending
//   TWITCH_HELIX_URL=http://127.0.0.1:8121 … works against `twitch event websocket start-server -p 8121`.

import { pathToFileURL } from 'node:url';
import type { CreateSubscriptionBody, EventSubSubscription, EventSubType } from './types.ts';

export type HelixAuth = { clientId: string; token: string; helixBase?: string };

export class HelixError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, what: string) {
    super(`${what} → HTTP ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

const base = (a: HelixAuth) => a.helixBase ?? 'https://api.twitch.tv/helix';
const headers = (a: HelixAuth) => ({ Authorization: `Bearer ${a.token}`, 'Client-Id': a.clientId, 'Content-Type': 'application/json' });

/** Client-credentials grant → app access token (cache it; it lasts ~60 days, refresh on 401). */
export async function getAppAccessToken(clientId: string, clientSecret: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new HelixError(res.status, await res.text(), 'POST /oauth2/token');
  return (await res.json()) as { access_token: string; expires_in: number };
}

export type CreateResult = {
  subscription: EventSubSubscription;
  total: number;
  total_cost: number;
  max_total_cost: number;
};

/**
 * POST /eventsub/subscriptions. Throws HelixError; notable statuses:
 * 400 bad condition/version/transport · 401 wrong token type/invalid · 403 missing scope (user never granted it to your client id)
 * 409 already exists (same type+condition+transport) — body includes the existing id · 429 limit (3 per type+condition, or cost).
 */
export async function createSubscription<T extends EventSubType>(auth: HelixAuth, body: CreateSubscriptionBody<T>): Promise<CreateResult> {
  const res = await fetch(`${base(auth)}/eventsub/subscriptions`, { method: 'POST', headers: headers(auth), body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== 202) throw new HelixError(res.status, text, `create ${body.type} v${body.version}`);
  const j = JSON.parse(text) as { data: EventSubSubscription[]; total: number; total_cost: number; max_total_cost: number };
  return { subscription: j.data[0]!, total: j.total, total_cost: j.total_cost, max_total_cost: j.max_total_cost };
}

/** Like createSubscription but treats 409 Conflict as success (idempotent startup). Returns null on 409. */
export async function ensureSubscription<T extends EventSubType>(auth: HelixAuth, body: CreateSubscriptionBody<T>): Promise<CreateResult | null> {
  try {
    return await createSubscription(auth, body);
  } catch (e) {
    if (e instanceof HelixError && e.status === 409) return null;
    throw e;
  }
}

export type ListFilter =
  | { status: string } | { type: string } | { user_id: string } | { subscription_id: string } | { conduit_id: string } | Record<string, never>;

/** GET /eventsub/subscriptions — follows the cursor through all pages. Only ONE filter allowed per request. */
export async function listSubscriptions(auth: HelixAuth, filter: ListFilter = {}): Promise<{ data: EventSubSubscription[]; total: number; total_cost: number; max_total_cost: number }> {
  const all: EventSubSubscription[] = [];
  let after: string | undefined;
  let meta = { total: 0, total_cost: 0, max_total_cost: 0 };
  do {
    const q = new URLSearchParams(filter as Record<string, string>);
    if (after) q.set('after', after);
    const res = await fetch(`${base(auth)}/eventsub/subscriptions?${q}`, { headers: headers(auth) });
    const text = await res.text();
    if (!res.ok) throw new HelixError(res.status, text, 'list subscriptions');
    const j = JSON.parse(text) as { data: EventSubSubscription[]; total: number; total_cost: number; max_total_cost: number; pagination?: { cursor?: string } };
    all.push(...j.data);
    meta = { total: j.total, total_cost: j.total_cost, max_total_cost: j.max_total_cost };
    after = j.pagination?.cursor || undefined;
  } while (after);
  return { data: all, ...meta };
}

/** DELETE /eventsub/subscriptions?id= (204). */
export async function deleteSubscription(auth: HelixAuth, id: string): Promise<void> {
  const res = await fetch(`${base(auth)}/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(auth) });
  if (res.status !== 204) throw new HelixError(res.status, await res.text(), `delete ${id}`);
}

/** Delete disabled subscriptions (revoked, failed verification, disconnected websockets …). Returns how many were removed. */
export async function cleanupSubscriptions(auth: HelixAuth): Promise<number> {
  const { data } = await listSubscriptions(auth);
  const dead = data.filter((s) => s.status !== 'enabled' && s.status !== 'webhook_callback_verification_pending');
  for (const s of dead) await deleteSubscription(auth, s.id);
  return dead.length;
}

// ------------------------------------------------------------------ CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) { console.error('set TWITCH_CLIENT_ID'); process.exit(1); }
  const token = process.env.TWITCH_TOKEN ??
    (process.env.TWITCH_CLIENT_SECRET ? (await getAppAccessToken(clientId, process.env.TWITCH_CLIENT_SECRET)).access_token : undefined);
  if (!token) { console.error('set TWITCH_TOKEN or TWITCH_CLIENT_SECRET'); process.exit(1); }
  const auth: HelixAuth = { clientId, token, helixBase: process.env.TWITCH_HELIX_URL };
  try {
    if (cmd === 'list') {
      const filter = Object.fromEntries(args.map((a) => a.split('=') as [string, string])) as ListFilter;
      const r = await listSubscriptions(auth, filter);
      for (const s of r.data) console.log(`${s.id}  ${s.status.padEnd(36)} ${s.type} v${s.version} cost=${s.cost} ${JSON.stringify(s.condition)} ${s.transport.method}`);
      console.log(`total=${r.total} total_cost=${r.total_cost} max_total_cost=${r.max_total_cost}`);
    } else if (cmd === 'create-webhook') {
      const [type, version, cond, callback, secret] = args;
      const r = await createSubscription(auth, {
        type: type as EventSubType, version: version!, condition: JSON.parse(cond!),
        transport: { method: 'webhook', callback: callback!, secret: secret! },
      });
      console.log(r.subscription.id, r.subscription.status, `cost=${r.subscription.cost} total_cost=${r.total_cost}/${r.max_total_cost}`);
    } else if (cmd === 'delete') {
      await deleteSubscription(auth, args[0]!);
      console.log('deleted');
    } else if (cmd === 'cleanup') {
      console.log(`deleted ${await cleanupSubscriptions(auth)} disabled subscriptions`);
    } else {
      console.log('commands: list [filter=value] | create-webhook <type> <version> <conditionJSON> <callback> <secret> | delete <id> | cleanup');
    }
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}
