/**
 * Extension Backend Service (EBS) starter — node:http, zero framework.
 *
 * Demo feature: a live poll. Viewers vote from the panel/overlay, the EBS keeps tallies per channel and
 * pushes them to every open extension via Extension PubSub (Helix POST /extensions/pubsub), coalesced to
 * <= 1 message/second/channel. Broadcasters/moderators can reset. Bits receipts are verified server-side.
 *
 * Run (Node >= 22.18 strips TS types natively):
 *   npm i jose
 *   TWITCH_EXTENSION_CLIENT_ID=... TWITCH_EXTENSION_SECRET=<base64 from console> \
 *   TWITCH_EXTENSION_OWNER_ID=<your numeric user id> node server.ts
 *
 * Deploy behind HTTPS (the extension frontend may only call https:// / wss:// URLs, and the EBS
 * origin must be listed under "Allowlist for URL Fetching Domains" in the Extensions console).
 */
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type RequestListener, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import {
  ExtensionAuthError,
  extractBearer,
  loadExtensionSecrets,
  requireRole,
  verifyBitsReceipt,
  verifyExtensionJwt,
  type ExtensionAuth,
} from './jwt.ts';
import { sendPubSubToChannel, type ExtApiConfig } from './twitch-ext-api.ts';

// ───────────────────────── Config ─────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const CLIENT_ID = requireEnv('TWITCH_EXTENSION_CLIENT_ID');
const SECRETS = loadExtensionSecrets(process.env.TWITCH_EXTENSION_SECRET); // comma-separated during rotation
const OWNER_ID = requireEnv('TWITCH_EXTENSION_OWNER_ID');
const PORT = Number(process.env.PORT ?? 8081);
/** Extension frontends run on https://<client_id>.ext-twitch.tv. Add your Local Test origin(s) too. */
const ALLOWED_ORIGINS = new Set([
  `https://${CLIENT_ID}.ext-twitch.tv`,
  ...(process.env.EBS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
]);

const api: ExtApiConfig = {
  clientId: CLIENT_ID,
  ownerId: OWNER_ID,
  secret: SECRETS[0]!,
  apiBase: process.env.TWITCH_API_BASE, // undefined → https://api.twitch.tv/helix
};

// ───────────────────────── State (replace with a DB/Redis in production) ─────────────────────────

interface Poll {
  tallies: number[];
  voters: Set<string>; // opaque user ids ("U…") — stable per user
  version: number;
}
const polls = new Map<string, Poll>();
const seenTransactions = new Set<string>(); // idempotency for Bits receipts
const OPTION_COUNT = 4;

function pollFor(channelId: string): Poll {
  let p = polls.get(channelId);
  if (!p) {
    p = { tallies: new Array<number>(OPTION_COUNT).fill(0), voters: new Set(), version: 0 };
    polls.set(channelId, p);
  }
  return p;
}

function publicState(p: Poll) {
  return { type: 'poll_state', version: p.version, tallies: p.tallies };
}

// ───────────────────────── PubSub coalescing (<= 1 msg/s/channel) ─────────────────────────

const lastSent = new Map<string, number>();
const pending = new Map<string, NodeJS.Timeout>();

function scheduleBroadcast(channelId: string): void {
  if (pending.has(channelId)) return; // a send is already queued; it will carry the latest state
  const wait = Math.max(0, 1000 - (Date.now() - (lastSent.get(channelId) ?? 0)));
  pending.set(
    channelId,
    setTimeout(() => {
      pending.delete(channelId);
      lastSent.set(channelId, Date.now());
      const payload = JSON.stringify(publicState(pollFor(channelId)));
      sendPubSubToChannel(api, channelId, payload).catch((err: unknown) =>
        console.error('[pubsub]', channelId, err instanceof Error ? err.message : err),
      );
    }, wait),
  );
}

// ───────────────────────── HTTP plumbing ─────────────────────────

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  // Auth is a bearer JWT (no cookies), so reflecting only known origins is defence in depth.
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

async function authenticate(req: IncomingMessage): Promise<ExtensionAuth> {
  const token = extractBearer(req.headers.authorization);
  if (!token) throw new ExtensionAuthError('Missing Authorization: Bearer <extension JWT>');
  return verifyExtensionJwt(token, SECRETS);
}

// ───────────────────────── Routes ─────────────────────────

type Handler = (req: IncomingMessage, auth: ExtensionAuth) => Promise<unknown>;

const routes: Record<string, Handler> = {
  // Any role. Initial state on load (PubSub only delivers changes).
  'GET /api/state': async (_req, auth) => publicState(pollFor(auth.channelId)),

  // Viewers vote once per poll. Anonymous ("A…") users are rejected: their IDs are not stable.
  'POST /api/vote': async (req, auth) => {
    if (!auth.isLoggedIn) throw new HttpError(403, 'Log in to Twitch to vote');
    const body = (await readJson(req)) as { option?: unknown };
    const option = body.option;
    if (typeof option !== 'number' || !Number.isInteger(option) || option < 0 || option >= OPTION_COUNT) {
      throw new HttpError(400, 'option must be an integer 0..3');
    }
    const poll = pollFor(auth.channelId);
    if (poll.voters.has(auth.opaqueUserId)) throw new HttpError(409, 'Already voted');
    poll.voters.add(auth.opaqueUserId);
    poll.tallies[option]! += 1;
    poll.version += 1;
    scheduleBroadcast(auth.channelId);
    return { ok: true };
  },

  // Broadcaster (or identity-linked moderator) resets the poll.
  'POST /api/reset': async (_req, auth) => {
    requireRole(auth, 'broadcaster', 'moderator');
    const poll = pollFor(auth.channelId);
    poll.tallies.fill(0);
    poll.voters.clear();
    poll.version += 1;
    scheduleBroadcast(auth.channelId);
    return { ok: true };
  },

  // Frontend forwards transaction.transactionReceipt from bits.onTransactionComplete.
  // Never trust the SKU/amount the client claims — only what the verified receipt says.
  'POST /api/bits/receipt': async (req, auth) => {
    const body = (await readJson(req)) as { receipt?: unknown; option?: unknown };
    if (typeof body.receipt !== 'string') throw new HttpError(400, 'receipt required');
    const receipt = await verifyBitsReceipt(body.receipt, SECRETS);
    if (seenTransactions.has(receipt.data.transactionId)) return { ok: true, duplicate: true };
    seenTransactions.add(receipt.data.transactionId);
    if (receipt.data.product.sku === 'boost_vote' && typeof body.option === 'number') {
      const poll = pollFor(auth.channelId);
      const idx = Math.trunc(body.option);
      if (idx >= 0 && idx < OPTION_COUNT) {
        poll.tallies[idx]! += 5;
        poll.version += 1;
        scheduleBroadcast(auth.channelId);
      }
    }
    return { ok: true, sku: receipt.data.product.sku };
  },
};

const app: RequestListener = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/health') return sendJson(res, 200, { ok: true });
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return sendJson(res, 404, { error: 'Not found' });
  try {
    const auth = await authenticate(req);
    sendJson(res, 200, await handler(req, auth));
  } catch (err) {
    if (err instanceof ExtensionAuthError || err instanceof HttpError) {
      return sendJson(res, err.status, { error: err.message });
    }
    console.error(err);
    sendJson(res, 500, { error: 'Internal error' });
  }
};

// HTTPS for Local Test without a proxy: EBS_TLS_CERT/EBS_TLS_KEY = mkcert files. In production
// terminate TLS at your host/proxy and run plain HTTP behind it.
const tlsCert = process.env.EBS_TLS_CERT;
const tlsKey = process.env.EBS_TLS_KEY;
const server = tlsCert && tlsKey
  ? createHttpsServer({ cert: readFileSync(tlsCert), key: readFileSync(tlsKey) }, app)
  : createHttpServer(app);

server.listen(PORT, () => console.log(`EBS listening on ${tlsCert ? 'https' : 'http'}://localhost:${PORT} (allowed origins: ${[...ALLOWED_ORIGINS].join(', ')})`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => process.exit(0)));
