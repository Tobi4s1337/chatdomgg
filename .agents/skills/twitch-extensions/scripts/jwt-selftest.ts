#!/usr/bin/env node
/**
 * Self-test for the EBS JWT helpers (assets/templates/ebs/jwt.ts or your copy of it).
 *
 * It signs tokens the way Twitch does with an INDEPENDENT node:crypto HS256 implementation, then checks
 * that the helper: accepts valid viewer/broadcaster tokens, rejects tampered / expired / wrong-secret /
 * alg=none / non-HS256 tokens, handles secret rotation, verifies Bits receipts, and builds+signs correct
 * EBS (role external) tokens. Also demonstrates the classic bug: using the base64 string as the key.
 *
 * Usage (needs `jose` resolvable from the jwt.ts location — i.e. run against your project's copy):
 *   node <skill>/scripts/jwt-selftest.ts ./ebs/jwt.ts
 * Default path: ../assets/templates/ebs/jwt.ts (works only where jose is installed above it).
 * Exit code 0 = all passed.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? resolve(here, '../assets/templates/ebs/jwt.ts'));

type JwtModule = typeof import('../assets/templates/ebs/jwt.ts');
let mod: JwtModule;
try {
  mod = (await import(pathToFileURL(target).href)) as JwtModule;
} catch (err) {
  console.error(`Could not load ${target}: ${(err as Error).message}`);
  console.error('Copy assets/templates/ebs into your project, `npm i jose`, then run:');
  console.error('  node <skill>/scripts/jwt-selftest.ts ./ebs/jwt.ts');
  process.exit(2);
}

// ───────────── independent "Twitch-side" signer ─────────────
const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url');
function twitchSign(payload: object, key: Buffer, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(payload));
  const s = createHmac('sha256', key).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function decodePart(jwt: string, i: 0 | 1): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[i]!, 'base64url').toString()) as Record<string, unknown>;
}

// ───────────── tiny test runner ─────────────
let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}: ${(err as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
async function rejects(p: Promise<unknown>, status?: number): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (status !== undefined) assert((err as { status?: number }).status === status, `expected status ${status}, got ${String((err as { status?: number }).status)}`);
    return;
  }
  throw new Error('expected rejection, but it resolved');
}

// ───────────── fixtures ─────────────
const secretB64 = randomBytes(32).toString('base64'); // what the console shows
const secretBytes = Buffer.from(secretB64, 'base64');
const otherB64 = randomBytes(32).toString('base64');
const now = Math.floor(Date.now() / 1000);
const channel = '123456789';

const viewerPayload = {
  exp: now + 3600,
  opaque_user_id: 'UG12X345T6J78',
  channel_id: channel,
  role: 'viewer',
  is_unlinked: false,
  pubsub_perms: { listen: ['broadcast', 'whisper-UG12X345T6J78', 'global'], send: [] as string[] },
};
const broadcasterPayload = {
  exp: now + 3600,
  opaque_user_id: `U${channel}`,
  user_id: channel,
  channel_id: channel,
  role: 'broadcaster',
  is_unlinked: 'false', // docs example uses a string
  pubsub_perms: { listen: ['broadcast', 'global'], send: ['broadcast', 'whisper-*'] },
};

console.log(`jwt-selftest against ${target}`);
const secrets = mod.loadExtensionSecrets(secretB64);

await test('decodes base64 secret to 32 raw bytes', () => {
  assert(secrets.length === 1 && secrets[0]!.length === 32, 'expected one 32-byte key');
});

await test('accepts a Twitch-style viewer token', async () => {
  const auth = await mod.verifyExtensionJwt(twitchSign(viewerPayload, secretBytes), secrets);
  assert(auth.role === 'viewer' && auth.channelId === channel, 'role/channel mismatch');
  assert(auth.isLoggedIn && auth.userId === null && !auth.isUnlinked, 'derived flags wrong');
});

await test('accepts broadcaster token, user_id present, string is_unlinked normalised', async () => {
  const auth = await mod.verifyExtensionJwt(twitchSign(broadcasterPayload, secretBytes), secrets);
  assert(auth.role === 'broadcaster' && auth.userId === channel && auth.isUnlinked === false, 'broadcaster fields wrong');
  mod.requireRole(auth, 'broadcaster', 'moderator');
});

await test('anonymous "A…" opaque id → isLoggedIn false', async () => {
  const auth = await mod.verifyExtensionJwt(twitchSign({ ...viewerPayload, opaque_user_id: 'ArandomAnon' }, secretBytes), secrets);
  assert(!auth.isLoggedIn, 'anonymous user treated as logged in');
});

await test('requireRole rejects viewer for broadcaster-only action (403)', async () => {
  const auth = await mod.verifyExtensionJwt(twitchSign(viewerPayload, secretBytes), secrets);
  try {
    mod.requireRole(auth, 'broadcaster');
    throw new Error('requireRole did not throw');
  } catch (err) {
    assert((err as { status?: number }).status === 403, 'expected 403');
  }
});

await test('rejects tampered payload (role escalated to broadcaster)', async () => {
  const [h, , s] = twitchSign(viewerPayload, secretBytes).split('.');
  const forged = `${h}.${b64u(JSON.stringify({ ...viewerPayload, role: 'broadcaster' }))}.${s}`;
  await rejects(mod.verifyExtensionJwt(forged, secrets), 401);
});

await test('rejects expired token', async () => {
  await rejects(mod.verifyExtensionJwt(twitchSign({ ...viewerPayload, exp: now - 120 }, secretBytes), secrets), 401);
});

await test('rejects token without exp', async () => {
  const { exp: _omit, ...noExp } = viewerPayload;
  await rejects(mod.verifyExtensionJwt(twitchSign(noExp, secretBytes), secrets), 401);
});

await test('rejects token signed with another secret', async () => {
  await rejects(mod.verifyExtensionJwt(twitchSign(viewerPayload, Buffer.from(otherB64, 'base64')), secrets), 401);
});

await test('classic bug: key = base64 STRING bytes (not decoded) fails verification', async () => {
  await rejects(mod.verifyExtensionJwt(twitchSign(viewerPayload, Buffer.from(secretB64, 'utf8')), secrets), 401);
});

await test('rejects alg=none', async () => {
  const h = b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  await rejects(mod.verifyExtensionJwt(`${h}.${b64u(JSON.stringify(viewerPayload))}.`, secrets), 401);
});

await test('rejects HS512 (algorithm pinned to HS256)', async () => {
  const h = b64u(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
  const p = b64u(JSON.stringify(viewerPayload));
  const sig = createHmac('sha512', secretBytes).update(`${h}.${p}`).digest('base64url');
  await rejects(mod.verifyExtensionJwt(`${h}.${p}.${sig}`, secrets), 401);
});

await test('rejects token for a different channel when expectedChannelId is set (403)', async () => {
  await rejects(mod.verifyExtensionJwt(twitchSign(viewerPayload, secretBytes), secrets, { expectedChannelId: '999' }), 403);
});

await test('rejects token with invalid role', async () => {
  await rejects(mod.verifyExtensionJwt(twitchSign({ ...viewerPayload, role: 'admin' }, secretBytes), secrets), 401);
});

await test('rotation: token signed with OLD secret verifies with "new,old" secret list', async () => {
  const rotated = mod.loadExtensionSecrets(`${otherB64},${secretB64}`);
  const auth = await mod.verifyExtensionJwt(twitchSign(viewerPayload, secretBytes), rotated);
  assert(auth.role === 'viewer', 'rotation verify failed');
});

await test('extractBearer handles "Bearer x", bare token, and missing header', () => {
  assert(mod.extractBearer('Bearer abc.def.ghi') === 'abc.def.ghi', 'bearer');
  assert(mod.extractBearer('abc.def.ghi') === 'abc.def.ghi', 'bare');
  assert(mod.extractBearer(undefined) === null, 'missing');
});

const receiptPayload = {
  topic: 'bits_transaction_receipt',
  exp: now + 600,
  data: {
    transactionId: 'tx-1',
    time: new Date().toISOString(),
    userId: '424596340',
    product: { domainId: 'twitch.ext.abc', sku: 'boost_vote', displayName: 'Boost', cost: { amount: 100, type: 'bits' } },
  },
};

await test('verifies a Bits transaction receipt', async () => {
  const r = await mod.verifyBitsReceipt(twitchSign(receiptPayload, secretBytes), secrets);
  assert(r.data.product.sku === 'boost_vote' && r.data.transactionId === 'tx-1', 'receipt fields');
});

await test('rejects a viewer token passed off as a receipt', async () => {
  await rejects(mod.verifyBitsReceipt(twitchSign(viewerPayload, secretBytes), secrets), 401);
});

await test('rejects a forged receipt (wrong secret)', async () => {
  await rejects(mod.verifyBitsReceipt(twitchSign(receiptPayload, Buffer.from(otherB64, 'base64')), secrets), 401);
});

await test('buildEbsJwtPayload: PubSub broadcast claims', () => {
  const p = mod.buildEbsJwtPayload({ ownerId: '27419011', channelId: channel, pubsubSend: ['broadcast'], ttlSec: 60 }, now);
  assert(p.role === 'external' && p.user_id === '27419011' && p.channel_id === channel, 'claims');
  assert(p.exp === now + 60 && JSON.stringify(p.pubsub_perms) === '{"send":["broadcast"]}', 'exp/perms');
});

await test('buildEbsJwtPayload: global PubSub uses channel_id "all" + send ["global"]', () => {
  const p = mod.buildEbsJwtPayload({ ownerId: '1', channelId: 'all', pubsubSend: ['global'] }, now);
  assert(p.channel_id === 'all' && p.pubsub_perms?.send[0] === 'global', 'global claims');
});

await test('signEbsJwt → HS256 header, verifiable with independent HMAC over the decoded secret', async () => {
  const jwt = await mod.signEbsJwt(secrets[0]!, { ownerId: '27419011', channelId: channel, pubsubSend: ['broadcast'] });
  const [h, p, s] = jwt.split('.');
  assert(decodePart(jwt, 0).alg === 'HS256', 'alg');
  const expected = createHmac('sha256', secretBytes).update(`${h}.${p}`).digest('base64url');
  assert(s === expected, 'signature does not match HMAC-SHA256(decoded secret)');
  const payload = decodePart(jwt, 1);
  assert(payload.role === 'external' && typeof payload.exp === 'number' && payload.exp > now, 'payload');
  console.log(`       EBS JWT payload: ${JSON.stringify(payload)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
