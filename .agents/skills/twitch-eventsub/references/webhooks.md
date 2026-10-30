# EventSub over Webhooks — verification, challenge, raw body, retries

Source: `references/official/eventsub_handling-webhook-events.md`, `eventsub.md`, API reference (Create EventSub
Subscription). Template: `assets/templates/eventsub-webhook-server.ts` — runtime-verified with the Twitch CLI
(valid signature → 204, wrong secret → 403, challenge → 200 text/plain, duplicate id → processed once,
stale timestamp → 403, revocation → 204). Exact commands in `references/testing.md`.

## Contents
- Requirements
- Request headers
- Signature verification (HMAC-SHA256)
- The three message types: challenge, notification, revocation
- Replay protection and de-duplication
- Responding fast; retries and `notification_failures_exceeded`
- Raw body in Express / Nitro-H3-Nuxt / Hono / Fastify / Next
- Creating webhook subscriptions (app token!)
- Local development (tunnels) and the CLI
- Twurple equivalent
- Pitfalls

## Requirements

- Callback URL must be **HTTPS on port 443**; redirects are not followed. (The Twitch CLI can hit plain
  `http://localhost:<port>` for testing.)
- Subscribe with an **app access token** (client credentials). A user token → 401. For types that need scopes,
  the user in the condition must have authorized **your client id** with those scopes earlier (any OAuth flow
  with your client id) — the app token "inherits" that grant. No grant → 403.
- `secret`: ASCII, **10–100 chars**, chosen by you per subscription (e.g. `openssl rand -hex 32`). It is NOT your
  client secret. Store it; you need it to verify every request.
- Respond within a few seconds with 2xx.

## Request headers

Node lower-cases header names: read `req.headers['twitch-eventsub-message-id']`.

| Header | Meaning |
|---|---|
| `Twitch-Eventsub-Message-Id` | unique message id; same id on a resend → use for de-duplication |
| `Twitch-Eventsub-Message-Retry` | retry counter |
| `Twitch-Eventsub-Message-Type` | `notification` \| `webhook_callback_verification` \| `revocation` |
| `Twitch-Eventsub-Message-Signature` | `sha256=<hex hmac>` |
| `Twitch-Eventsub-Message-Timestamp` | RFC3339 (nanoseconds) send time — part of the HMAC input |
| `Twitch-Eventsub-Subscription-Type` | e.g. `channel.follow` |
| `Twitch-Eventsub-Subscription-Version` | e.g. `2` |

## Signature verification

```
expected = "sha256=" + hex( HMAC_SHA256( key = secret, message = message_id + message_timestamp + raw_body ) )
```
Order matters (id, then timestamp, then body). Compare with a constant-time function; on mismatch return 4xx
(403) and do nothing else.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verify(secret: string, h: Record<string, string | string[] | undefined>, raw: Buffer): boolean {
  const id = h['twitch-eventsub-message-id'], ts = h['twitch-eventsub-message-timestamp'], sig = h['twitch-eventsub-message-signature'];
  if (typeof id !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(id + ts).update(raw).digest('hex'));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got); // timingSafeEqual throws on length mismatch
}
```

**The body must be the exact bytes Twitch sent.** If any middleware parses JSON first and you re-`JSON.stringify`
it, whitespace/escaping/key order change and every signature fails. (The official doc's sample concatenates the
raw Buffer body to a string — same thing.)

## Message types

**`webhook_callback_verification`** — sent right after you create the subscription (status
`webhook_callback_verification_pending`). Body: `{ challenge, subscription }`. Verify the signature, then respond
**200, `Content-Type: text/plain`, body = the raw challenge string** (correct Content-Length). No JSON, no quotes.
Then the subscription becomes `enabled`; otherwise `webhook_callback_verification_failed` (fix and re-create).
Conduit webhook shards get the same challenge but with `conduit_shard: { conduit_id, shard }` instead of
`subscription`.

**`notification`** — body `{ subscription, event }`. Respond 2xx (204) immediately; process afterwards.

**`revocation`** — body `{ subscription }`, `subscription.status` is the reason:
`user_removed`, `authorization_revoked` (revoked or password change), `notification_failures_exceeded`
(you were too slow/failing too often), `version_removed`. Respond 2xx. Re-create only after fixing the cause
(e.g. user re-authorizes). Other non-enabled statuses you may see in `GET …/subscriptions`:
`moderator_removed`, `chat_user_banned`, `beta_maintenance`, `webhook_callback_verification_failed`.

## Replay protection and de-duplication

- Reject if `Twitch-Eventsub-Message-Timestamp` is older than **10 minutes** (Twitch's guidance).
- Remember message ids for 10 minutes and skip repeats (still return 2xx). Delivery is at-least-once.
- With several server instances, store seen ids in shared storage (Redis `SET id 1 NX EX 600`).

## Responding fast; retries

Twitch times out slow responses and retries. "If you fail to respond quickly enough too many times, the
subscription's status changes to `notification_failures_exceeded` and Twitch revokes the subscription." Don't
await DB writes, chat sends, or overlay pushes before responding: return 204, then process (the template uses
`setImmediate`; for durability put the event on a queue first). Return 2xx for duplicates and unknown message
types too, otherwise they count as failures.

## Raw body by framework

Express:
```ts
import express from 'express';
const app = express();
// raw ONLY on the EventSub route, before any express.json()
app.post('/eventsub', express.raw({ type: 'application/json' }), (req, res) => {
  const r = handleEventSubMessage(SECRET, req.headers, req.body as Buffer, handlers, dedupe); // from the template
  if (r.body !== undefined) res.status(r.status).type('text/plain').send(r.body);
  else res.sendStatus(r.status);
});
app.use(express.json()); // other routes
```

Nuxt 3/4 server route (Nitro + h3) — `server/api/eventsub.post.ts`:
```ts
import { defineEventHandler, readRawBody, getRequestHeaders, setResponseStatus, setResponseHeader } from 'h3';
export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event, false);            // false → Buffer (no utf8 decoding)
  const r = handleEventSubMessage(process.env.TWITCH_EVENTSUB_SECRET!, getRequestHeaders(event), raw ?? Buffer.alloc(0), handlers, dedupe);
  setResponseStatus(event, r.status);
  if (r.body !== undefined) { setResponseHeader(event, 'content-type', 'text/plain'); return r.body; }
  return null;
});
```
(Nuxt auto-imports the h3 helpers; the explicit import is harmless. Keep `dedupe` as a module-level singleton.)

Hono:
```ts
app.post('/eventsub', async (c) => {
  const raw = Buffer.from(await c.req.arrayBuffer());
  const r = handleEventSubMessage(SECRET, Object.fromEntries(c.req.raw.headers), raw, handlers, dedupe);
  return r.body !== undefined ? c.text(r.body, r.status as 200) : c.body(null, r.status as 204);
});
```
(`Headers` entries are already lower-case.)

Fastify: `app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))`
on an encapsulated plugin for the EventSub route. Next.js route handler: `Buffer.from(await req.arrayBuffer())`.

## Creating webhook subscriptions

```ts
await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${APP_TOKEN}`, 'Client-Id': CLIENT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'channel.follow', version: '2',
    condition: { broadcaster_user_id: B, moderator_user_id: B },
    transport: { method: 'webhook', callback: 'https://example.com/eventsub', secret: SECRET },
  }),
}); // 202 + status webhook_callback_verification_pending → Twitch immediately POSTs the challenge
```
Your server must already be up and reachable or the challenge fails. `assets/templates/subscribe.ts` has
`createSubscription` / `ensureSubscription` (409-tolerant) / `listSubscriptions` / `deleteSubscription` /
`cleanupSubscriptions` and `getAppAccessToken`. Delete subscriptions before deleting an app — otherwise Twitch
keeps calling the old callback.

Cost: subscriptions needing user authorization cost 0; "no authorization" types (`stream.online`, `channel.update`,
`channel.raid`, `user.update`) cost 1 unless the user authorized your app. `max_total_cost` grows as users
authorize (examples show 10000). Max 3 subscriptions with the same type+condition.

## Local development

Twitch must reach `https://<public-host>/eventsub` on 443. Options:
- Twitch CLI only (no tunnel): `twitch event trigger … -F http://localhost:8080/eventsub -s <secret>` — tests
  signature/challenge/handling locally without any real subscription.
- Real events locally: a tunnel gives you a public HTTPS URL forwarding to localhost —
  `cloudflared tunnel --url http://localhost:8080` (prints `https://<random>.trycloudflare.com`),
  `ngrok http 8080`, or VS Code port forwarding (set visibility Public). Use that URL as `callback`.
  Quick tunnels change URL on restart → old subscriptions point to a dead URL (delete them, re-create).
- Or skip webhooks in development and use the WebSocket transport (same event payloads).

## Twurple equivalent

`@twurple/eventsub-http`: `EventSubMiddleware` (Express; config `{ apiClient, hostName, pathPrefix, secret }`,
then `middleware.apply(app)` before body parsers, `await middleware.markAsReady()` after `listen`) or
`EventSubHttpListener` with an adapter (`ReverseProxyAdapter`, `DirectConnectionAdapter`, `EnvPortAdapter`;
ngrok via `@twurple/eventsub-ngrok`). Same `onChannelFollow(...)` methods as the WS listener; Twurple does
signature checks, challenges and dedupe. Its `secret` is your EventSub secret, never the client secret.

## Pitfalls

- `express.json()` (or Nuxt's `readBody`) before verification → all signatures fail. Use the raw bytes.
- Responding to the challenge with JSON (`res.json(challenge)`) or quoting it → verification fails.
- Comparing with `===` instead of `timingSafeEqual` (timing attack), or calling `timingSafeEqual` with
  different-length buffers (it throws → 500 → counts as delivery failure).
- Doing work before responding → timeouts → `notification_failures_exceeded` revocation.
- Using one secret everywhere is fine, but rotate by creating new subscriptions with the new secret and verifying
  against both until old ones are deleted.
- Port 443 only, HTTPS only, no redirects (e.g. `http→https` or trailing-slash redirects break it).
