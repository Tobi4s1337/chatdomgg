#!/usr/bin/env node
/**
 * Zero-dependency HS256 JWT minting for Twitch Extension development (node:crypto only).
 *
 *   # EBS token for curl against Helix /extensions/* (role external):
 *   node scripts/make-jwt.ts external --secret "$TWITCH_EXTENSION_SECRET" --owner 12345 \
 *        [--channel 67890] [--send broadcast] [--ttl 60]
 *   curl -X POST https://api.twitch.tv/helix/extensions/pubsub \
 *        -H "Authorization: Bearer $(node scripts/make-jwt.ts external ... --channel 67890 --send broadcast)" \
 *        -H "Client-Id: $TWITCH_EXTENSION_CLIENT_ID" -H 'Content-Type: application/json' \
 *        -d '{"target":["broadcast"],"broadcaster_id":"67890","message":"hello"}'
 *
 *   # Fake Twitch-issued frontend token, to hit YOUR EBS without loading Twitch:
 *   node scripts/make-jwt.ts viewer --secret "$TWITCH_EXTENSION_SECRET" --channel 67890 \
 *        [--role viewer|broadcaster|moderator] [--opaque U123abc] [--user 1111] [--ttl 3600]
 *
 *   node scripts/make-jwt.ts decode <jwt>      # print header + payload (no verification)
 *
 * The secret is the BASE64 string from the Extensions console; it is base64-decoded before HMAC.
 */
import { createHmac } from 'node:crypto';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signHs256(payload: object, base64Secret: string): string {
  const key = Buffer.from(base64Secret, 'base64');
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const mode = process.argv[2];
  if (mode === 'decode') {
    const [h, p] = (process.argv[3] ?? '').split('.');
    if (!h || !p) throw new Error('usage: decode <jwt>');
    console.log(JSON.stringify({
      header: JSON.parse(Buffer.from(h, 'base64url').toString()),
      payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    }, null, 2));
    return;
  }
  const secret = arg('secret') ?? process.env.TWITCH_EXTENSION_SECRET;
  if (!secret || (mode !== 'external' && mode !== 'viewer')) {
    console.error('usage: make-jwt.ts external|viewer --secret <base64> [...] | decode <jwt>  (see file header)');
    process.exit(2);
  }
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(arg('ttl') ?? (mode === 'external' ? 60 : 3600));
  let payload: Record<string, unknown>;
  if (mode === 'external') {
    const owner = arg('owner') ?? process.env.TWITCH_EXTENSION_OWNER_ID;
    if (!owner) throw new Error('--owner <extension owner user id> required');
    payload = { exp: now + ttl, user_id: owner, role: 'external' };
    const channel = arg('channel');
    if (channel) payload.channel_id = channel;
    const send = arg('send');
    if (send) payload.pubsub_perms = { send: send.split(',') };
  } else {
    const channel = arg('channel');
    if (!channel) throw new Error('--channel <broadcaster id> required');
    const role = arg('role') ?? 'viewer';
    const user = arg('user');
    const opaque = arg('opaque') ?? (role === 'broadcaster' && user ? `U${user}` : 'UfakeOpaque123');
    payload = {
      exp: now + ttl,
      opaque_user_id: opaque,
      channel_id: channel,
      role,
      is_unlinked: false,
      pubsub_perms: { listen: ['broadcast', `whisper-${opaque}`, 'global'], send: role === 'broadcaster' ? ['broadcast', 'whisper-*'] : [] },
    };
    if (user) payload.user_id = user;
  }
  process.stdout.write(signHs256(payload, secret) + '\n');
}

main();
