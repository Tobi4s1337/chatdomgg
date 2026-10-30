#!/usr/bin/env node
// Send a correctly SIGNED EventSub webhook request built from a fixture — for types the Twitch CLI cannot
// trigger (channel.chat.message, channel.chat.notification, channel.bits.use, hype_train v2, automod, …).
//
// Usage:
//   node scripts/send-fixture.ts <type[@version] | path/to/fixture.json> -F <url> -s <secret> [options]
//     --message-type notification|revocation|webhook_callback_verification   (default notification)
//     --id <message id>          reuse to test de-duplication (default: random UUID)
//     --timestamp <RFC3339>      e.g. 2020-01-01T00:00:00Z to test the 10-minute replay window
//     --set event.message.text="!hello"   override a field (dot path; value parsed as JSON if possible). Repeatable.
// Examples:
//   node scripts/send-fixture.ts channel.chat.message -F http://localhost:8080/eventsub -s "$TWITCH_EVENTSUB_SECRET" --set 'event.message.text="!dice"'
//   node scripts/send-fixture.ts channel.hype_train.begin@2 -F http://localhost:8080/eventsub -s "$TWITCH_EVENTSUB_SECRET"
// Fixtures live in assets/fixtures/<type>.v<version>.json (generated from the official doc examples).
// Output: HTTP status + response body. Exit code 1 if the status is not 2xx.

import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fixtures');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1] ?? ''] : []));
}

const target = process.argv[2];
const url = arg('-F');
const secret = arg('-s');
if (!target || !url || !secret) {
  console.error('usage: send-fixture.ts <type[@version]|file.json> -F <url> -s <secret> [--message-type t] [--id id] [--timestamp ts] [--set path=json]');
  process.exit(2);
}

function resolveFixture(t: string): string {
  if (existsSync(t)) return t;
  const [type, version] = t.split('@');
  const files = readdirSync(FIXTURES).filter((f) => f.startsWith(`${type}.v`));
  if (!files.length) throw new Error(`no fixture for ${type}; available: ${readdirSync(FIXTURES).join(', ')}`);
  const pick = version ? files.find((f) => f === `${type}.v${version}.json`) : files.sort().at(-1);
  if (!pick) throw new Error(`no fixture ${type} v${version}; have ${files.join(', ')}`);
  return join(FIXTURES, pick);
}

const payload = JSON.parse(readFileSync(resolveFixture(target), 'utf8')) as Record<string, unknown> & {
  subscription: { type: string; version: string; status?: string };
};
for (const s of args('--set')) {
  const eq = s.indexOf('=');
  const path = s.slice(0, eq).split('.');
  let v: unknown = s.slice(eq + 1);
  try { v = JSON.parse(String(v)); } catch { /* keep string */ }
  let o = payload as Record<string, unknown>;
  for (const k of path.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[path.at(-1)!] = v;
}

const messageType = arg('--message-type') ?? 'notification';
let bodyObj: Record<string, unknown> = payload;
if (messageType === 'revocation') {
  bodyObj = { subscription: { ...payload.subscription, status: payload.subscription.status === 'enabled' ? 'authorization_revoked' : payload.subscription.status } };
} else if (messageType === 'webhook_callback_verification') {
  bodyObj = { challenge: randomUUID(), subscription: { ...payload.subscription, status: 'webhook_callback_verification_pending' } };
}
const body = JSON.stringify(bodyObj);
const id = arg('--id') ?? randomUUID();
const ts = arg('--timestamp') ?? new Date().toISOString();
const sig = 'sha256=' + createHmac('sha256', secret).update(id + ts + body).digest('hex');

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Twitch-Eventsub-Message-Id': id,
    'Twitch-Eventsub-Message-Retry': '0',
    'Twitch-Eventsub-Message-Type': messageType,
    'Twitch-Eventsub-Message-Signature': sig,
    'Twitch-Eventsub-Message-Timestamp': ts,
    'Twitch-Eventsub-Subscription-Type': payload.subscription.type,
    'Twitch-Eventsub-Subscription-Version': payload.subscription.version,
  },
  body,
});
const text = await res.text();
console.log(`${payload.subscription.type} v${payload.subscription.version} [${messageType}] id=${id} → HTTP ${res.status}${text ? ` body=${text}` : ''}`);
if (messageType === 'webhook_callback_verification') {
  const ok = res.status === 200 && text === (bodyObj.challenge as string);
  console.log(ok ? '✔ challenge echoed correctly' : '✗ challenge NOT echoed as raw text');
}
process.exit(res.status >= 200 && res.status < 300 ? 0 : 1);
