// EventSub WEBHOOK receiver — zero dependencies (node:http + node:crypto), Node >= 22.
//
// What it does (in the order Twitch requires):
//   1. reads the RAW body (signature is over raw bytes — never JSON.parse before verifying)
//   2. verifies HMAC-SHA256(secret, message_id + timestamp + raw_body) with timingSafeEqual → 403 if bad
//   3. rejects messages older than 10 minutes (replay protection) and de-duplicates by message id
//   4. webhook_callback_verification → 200 text/plain with the raw `challenge`
//      notification → 204 immediately, THEN processes the event asynchronously
//      revocation   → 204, log/alert (subscription is gone; re-create it if appropriate)
//
// Run:   TWITCH_EVENTSUB_SECRET=<10-100 ascii chars> PORT=8080 node eventsub-webhook-server.ts
// Test:  twitch event trigger channel.follow -F http://localhost:8080/eventsub -s "$TWITCH_EVENTSUB_SECRET"
//        twitch event verify-subscription channel.follow -F http://localhost:8080/eventsub -s "$TWITCH_EVENTSUB_SECRET"
// Prod:  Twitch only calls https://… on port 443 → put this behind a TLS reverse proxy / tunnel.
//
// Embed in another framework: use `verifyEventSubSignature()` + `handleEventSubMessage()` (see references/webhooks.md).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { AnyEventSubNotification, EventSubEnvelope, EventSubSubscription } from './types.ts';

const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000; // Twitch's guidance: ignore messages older than 10 minutes
const MAX_BODY_BYTES = 1024 * 1024;

// Header names (Node lower-cases incoming header names).
const H_ID = 'twitch-eventsub-message-id';
const H_TS = 'twitch-eventsub-message-timestamp';
const H_SIG = 'twitch-eventsub-message-signature';
const H_TYPE = 'twitch-eventsub-message-type';

type Headers = Record<string, string | string[] | undefined>;
const header = (h: Headers, name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/** HMAC check exactly as documented: 'sha256=' + hex(HMAC_SHA256(secret, id + timestamp + rawBody)). */
export function verifyEventSubSignature(secret: string, headers: Headers, rawBody: Buffer): boolean {
  const id = header(headers, H_ID);
  const ts = header(headers, H_TS);
  const sig = header(headers, H_SIG);
  if (!id || !ts || !sig) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(id + ts).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b); // length check first: timingSafeEqual throws on mismatch
}

/** Remembers message ids for 10 minutes so retries/duplicates are processed once. Use Redis etc. if you run >1 instance. */
export class RecentMessageIds {
  private seen = new Map<string, number>();
  private readonly ttlMs: number;
  constructor(ttlMs = MAX_MESSAGE_AGE_MS) {
    this.ttlMs = ttlMs; // (no TS parameter properties: keeps the file runnable with Node's type stripping)
  }
  /** true if the id was already seen (and records it otherwise). */
  check(id: string, now = Date.now()): boolean {
    if (this.seen.size > 10_000) for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    const exp = this.seen.get(id);
    if (exp !== undefined && exp > now) return true;
    this.seen.set(id, now + this.ttlMs);
    return false;
  }
}

export type EventSubHandlers = {
  onNotification: (n: AnyEventSubNotification, messageId: string) => void | Promise<void>;
  onRevocation?: (sub: EventSubSubscription) => void | Promise<void>;
};

export type HandleResult = { status: number; body?: string; contentType?: string };

/**
 * Framework-agnostic core: give it headers + raw body, get back what to respond.
 * Event processing is scheduled AFTER the response is produced (setImmediate) so Twitch gets its 2xx fast.
 */
export function handleEventSubMessage(
  secret: string,
  headers: Headers,
  rawBody: Buffer,
  handlers: EventSubHandlers,
  dedupe: RecentMessageIds,
): HandleResult {
  if (!verifyEventSubSignature(secret, headers, rawBody)) return { status: 403 };

  const ts = Date.parse(header(headers, H_TS) ?? '');
  if (!Number.isFinite(ts) || Date.now() - ts > MAX_MESSAGE_AGE_MS) return { status: 403 }; // stale → possible replay

  let body: { challenge?: string; subscription?: EventSubSubscription; event?: unknown };
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400 };
  }

  const type = header(headers, H_TYPE);
  if (type === 'webhook_callback_verification') {
    // Must be 200, raw challenge string only, correct Content-Length (node:http sets it for us below).
    return { status: 200, body: String(body.challenge ?? ''), contentType: 'text/plain' };
  }

  const messageId = header(headers, H_ID)!;
  if (dedupe.check(messageId)) return { status: 204 }; // duplicate delivery: ack, don't process again

  if (type === 'notification') {
    const n = body as AnyEventSubNotification;
    setImmediate(() => {
      Promise.resolve(handlers.onNotification(n, messageId)).catch((err) => console.error('[eventsub] handler failed', err));
    });
    return { status: 204 };
  }
  if (type === 'revocation' && body.subscription) {
    const sub = body.subscription;
    setImmediate(() => {
      Promise.resolve(handlers.onRevocation?.(sub)).catch((err) => console.error('[eventsub] revocation handler failed', err));
    });
    return { status: 204 };
  }
  return { status: 204 }; // unknown message type: ack so Twitch doesn't retry
}

function readRawBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** node:http request listener. Mount at the exact callback path you subscribe with. */
export function createEventSubRequestListener(opts: { secret: string; path?: string } & EventSubHandlers) {
  const dedupe = new RecentMessageIds();
  const path = opts.path ?? '/eventsub';
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'POST' || url.pathname.replace(/\/+$/, '') !== path.replace(/\/+$/, '')) {
      res.writeHead(404).end();
      return;
    }
    let raw: Buffer;
    try {
      raw = await readRawBody(req);
    } catch {
      res.writeHead(413).end();
      return;
    }
    const r = handleEventSubMessage(opts.secret, req.headers, raw, opts, dedupe);
    if (r.body !== undefined) {
      res.writeHead(r.status, { 'Content-Type': r.contentType ?? 'text/plain', 'Content-Length': Buffer.byteLength(r.body) });
      res.end(r.body);
    } else {
      res.writeHead(r.status).end();
    }
  };
}

// ------------------------------------------------------------------ example app (runs when executed directly)
async function onNotification(n: AnyEventSubNotification, messageId: string): Promise<void> {
  // Flatten so `switch (e.type)` narrows `e.event` to the right payload type (TS can't narrow on n.subscription.type).
  const e = { type: n.subscription.type, version: n.subscription.version, event: n.event, subscription: n.subscription } as EventSubEnvelope;
  switch (e.type) {
    case 'channel.follow':
      console.log(`[follow] ${e.event.user_name} followed ${e.event.broadcaster_user_name}`);
      break;
    case 'channel.subscribe':
      console.log(`[sub] ${e.event.user_name} tier ${e.event.tier}${e.event.is_gift ? ' (gift)' : ''}`);
      break;
    case 'channel.cheer':
      console.log(`[cheer] ${e.event.is_anonymous ? 'anonymous' : e.event.user_name}: ${e.event.bits} bits`);
      break;
    case 'channel.raid':
      console.log(`[raid] ${e.event.from_broadcaster_user_name} → ${e.event.to_broadcaster_user_name} (${e.event.viewers})`);
      break;
    case 'channel.channel_points_custom_reward_redemption.add':
      console.log(`[redeem] ${e.event.user_name} redeemed "${e.event.reward.title}" input=${JSON.stringify(e.event.user_input)}`);
      break;
    case 'stream.online':
      console.log(`[online] ${e.event.broadcaster_user_name} (${e.event.type})`);
      break;
    default:
      console.log(`[${e.type} v${e.version}] message ${messageId}`, JSON.stringify(e.event));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.TWITCH_EVENTSUB_SECRET;
  if (!secret || secret.length < 10 || secret.length > 100) {
    console.error('Set TWITCH_EVENTSUB_SECRET (10-100 ASCII chars), e.g. `openssl rand -hex 32`');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8080);
  const path = process.env.EVENTSUB_PATH ?? '/eventsub';
  const listener = createEventSubRequestListener({
    secret,
    path,
    onNotification,
    onRevocation: (sub) => console.warn(`[revoked] ${sub.type} v${sub.version} status=${sub.status}`, sub.condition),
  });
  createServer((req, res) => void listener(req, res)).listen(port, () =>
    console.log(`EventSub webhook listening on http://localhost:${port}${path}`),
  );
}
