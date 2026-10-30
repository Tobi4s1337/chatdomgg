#!/usr/bin/env node
/**
 * End-to-end smoke test for the EBS template (assets/templates/ebs/server.ts) WITHOUT Twitch:
 *  - starts a mock Helix server that verifies the EBS-signed JWT on POST /helix/extensions/pubsub
 *  - starts server.ts pointed at the mock (TWITCH_API_BASE) with a random extension secret
 *  - calls the EBS with Twitch-style frontend JWTs (viewer / anonymous / broadcaster) and checks
 *    auth, role checks, CORS preflight, Bits receipt verification and PubSub coalescing (<=1 msg/s).
 *
 * Usage (from a project where the ebs/ template + jose are installed):
 *   node <skill>/scripts/ebs-smoke-test.ts ./ebs/server.ts [ebsPort=8140] [mockPort=8141]
 */
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const serverPath = resolve(process.argv[2] ?? 'ebs/server.ts');
const EBS_PORT = Number(process.argv[3] ?? 8140);
const MOCK_PORT = Number(process.argv[4] ?? 8141);
const CLIENT_ID = 'abcdefghijklmnopqrstuvwxyz0123';
const OWNER_ID = '27419011';
const CHANNEL = '123456789';
const secretB64 = randomBytes(32).toString('base64');
const key = Buffer.from(secretB64, 'base64');

const b64u = (v: string) => Buffer.from(v).toString('base64url');
function sign(payload: object): string {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createHmac('sha256', key).update(`${h}.${p}`).digest('base64url')}`;
}
function verify(jwt: string): Record<string, unknown> | null {
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) return null;
  if (createHmac('sha256', key).update(`${h}.${p}`).digest('base64url') !== s) return null;
  return JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
}
const exp = Math.floor(Date.now() / 1000) + 3600;
const viewer = (opaque: string) =>
  sign({ exp, opaque_user_id: opaque, channel_id: CHANNEL, role: 'viewer', is_unlinked: false, pubsub_perms: { listen: ['broadcast'] } });
const broadcaster = sign({ exp, opaque_user_id: `U${CHANNEL}`, user_id: CHANNEL, channel_id: CHANNEL, role: 'broadcaster', pubsub_perms: { send: ['broadcast'] } });

// ───── mock Helix ─────
const pubsubCalls: Array<{ at: number; claims: Record<string, unknown>; body: { target: string[]; broadcaster_id: string; message: string }; clientId: string }> = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c: Buffer) => (body += c.toString()));
  req.on('end', () => {
    const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (req.url !== '/helix/extensions/pubsub' || req.method !== 'POST') return void res.writeHead(404).end();
    if (!claims) return void res.writeHead(401).end('bad jwt');
    pubsubCalls.push({ at: Date.now(), claims, body: JSON.parse(body), clientId: String(req.headers['client-id']) });
    res.writeHead(204).end();
  });
});
await new Promise<void>((r) => mock.listen(MOCK_PORT, r));

// ───── EBS under test ─────
const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    TWITCH_EXTENSION_CLIENT_ID: CLIENT_ID,
    TWITCH_EXTENSION_SECRET: secretB64,
    TWITCH_EXTENSION_OWNER_ID: OWNER_ID,
    PORT: String(EBS_PORT),
    TWITCH_API_BASE: `http://localhost:${MOCK_PORT}/helix`,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const base = `http://localhost:${EBS_PORT}`;
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 100));
}

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed++;
}
async function call(path: string, token: string | null, body?: unknown, method = body ? 'POST' : 'GET') {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

try {
  check('GET /api/state without token → 401', (await call('/api/state', null)).status === 401);
  check('GET /api/state with garbage token → 401', (await call('/api/state', 'x.y.z')).status === 401);
  const st = await call('/api/state', viewer('Uviewer1'));
  check('GET /api/state viewer → 200', st.status === 200, JSON.stringify(st));
  check('POST /api/vote anonymous (A…) → 403', (await call('/api/vote', viewer('Aanon'), { option: 0 })).status === 403);
  check('POST /api/vote bad option → 400', (await call('/api/vote', viewer('Uviewer1'), { option: 9 })).status === 400);
  check('POST /api/vote viewer1 → 200', (await call('/api/vote', viewer('Uviewer1'), { option: 1 })).status === 200);
  check('POST /api/vote viewer1 again → 409', (await call('/api/vote', viewer('Uviewer1'), { option: 1 })).status === 409);
  check('POST /api/vote viewer2 → 200', (await call('/api/vote', viewer('Uviewer2'), { option: 2 })).status === 200);
  check('POST /api/vote viewer3 → 200', (await call('/api/vote', viewer('Uviewer3'), { option: 2 })).status === 200);
  check('POST /api/reset viewer → 403', (await call('/api/reset', viewer('Uviewer1'), {})).status === 403);

  const pre = await fetch(`${base}/api/vote`, {
    method: 'OPTIONS',
    headers: { Origin: `https://${CLIENT_ID}.ext-twitch.tv`, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  check('CORS preflight from https://<client_id>.ext-twitch.tv allowed',
    pre.status === 204 && pre.headers.get('access-control-allow-origin') === `https://${CLIENT_ID}.ext-twitch.tv` &&
      /authorization/i.test(pre.headers.get('access-control-allow-headers') ?? ''));
  const evil = await fetch(`${base}/api/vote`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  check('CORS preflight from foreign origin not allowed', evil.headers.get('access-control-allow-origin') === null);

  const receipt = sign({ topic: 'bits_transaction_receipt', exp, data: { transactionId: 'tx-9', time: new Date().toISOString(), userId: '42', product: { sku: 'boost_vote', cost: { amount: 100, type: 'bits' } } } });
  const r1 = await call('/api/bits/receipt', viewer('Uviewer2'), { receipt, option: 2 });
  check('Bits receipt verified → 200', r1.status === 200 && r1.json?.sku === 'boost_vote', JSON.stringify(r1));
  const r2 = await call('/api/bits/receipt', viewer('Uviewer2'), { receipt, option: 2 });
  check('Bits receipt replay is idempotent', r2.json?.duplicate === true, JSON.stringify(r2));
  const forgedReceipt = receipt.slice(0, -4) + 'AAAA';
  check('Forged Bits receipt → 401', (await call('/api/bits/receipt', viewer('Uviewer2'), { receipt: forgedReceipt })).status === 401);

  await new Promise((r) => setTimeout(r, 1500)); // let the coalesced PubSub flush
  // Throttle = leading send for the first change, then ONE trailing send carrying the latest state.
  check('PubSub throttled: 2 messages (leading + trailing) for 5 state changes', pubsubCalls.length === 2, `got ${pubsubCalls.length}`);
  const gap = pubsubCalls.length >= 2 ? pubsubCalls[1]!.at - pubsubCalls[0]!.at : 0;
  check('PubSub messages spaced >= ~1s per channel', gap >= 950, `gap ${gap}ms`);
  const c = pubsubCalls.at(-1);
  check('PubSub JWT claims: role external, owner user_id, channel_id, send [broadcast]',
    !!c && c.claims.role === 'external' && c.claims.user_id === OWNER_ID && c.claims.channel_id === CHANNEL &&
      JSON.stringify(c.claims.pubsub_perms) === '{"send":["broadcast"]}', JSON.stringify(c?.claims));
  check('PubSub request: Client-Id + body target/broadcaster_id', !!c && c.clientId === CLIENT_ID && c.body.broadcaster_id === CHANNEL && c.body.target[0] === 'broadcast');
  const msg = c ? (JSON.parse(c.body.message) as { tallies: number[] }) : null;
  check('PubSub message carries latest tallies [0,1,7,0]', JSON.stringify(msg?.tallies) === '[0,1,7,0]', JSON.stringify(msg));

  check('POST /api/reset broadcaster → 200', (await call('/api/reset', broadcaster, {})).status === 200);
  await new Promise((r) => setTimeout(r, 1300));
  check('reset broadcast delivered', pubsubCalls.length === 3, `got ${pubsubCalls.length}`);
  check('reset state has zero tallies', JSON.stringify((JSON.parse(pubsubCalls.at(-1)?.body.message ?? '{}') as { tallies?: number[] }).tallies) === '[0,0,0,0]');
} finally {
  child.kill('SIGTERM');
  mock.close();
}
console.log(failed === 0 ? '\nall smoke checks passed' : `\n${failed} smoke check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
