#!/usr/bin/env node
// Signs an Atlas founding request with the founder's Ed25519 key. Run it on the founder's own machine: the private
// key never leaves it, and this script needs nothing but Node (no install, no network).
//
//   node sign-founding.mjs <founding-request.json> <founder-private.pem> [--out <authorization.json>]
//
// It shows what is being founded, asks for the edition's name to be typed back, dates the signature now, and writes
// the authorization the operator passes to `atlas:found --authorization`. The payload is the exact canonical form the
// Atlas service verifies (edition/authorization.ts canonicalPayload), so key order here must not change.
import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, createHash, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const [requestPath, keyPath, ...rest] = process.argv.slice(2);
const outIndex = rest.indexOf('--out');
const out = outIndex >= 0 ? rest[outIndex + 1] : null;
if (!requestPath || !keyPath) {
  console.error('usage: node sign-founding.mjs <founding-request.json> <founder-private.pem> [--out <authorization.json>]');
  process.exit(2);
}

const request = JSON.parse(readFileSync(requestPath, 'utf8'));
if (request?.kind !== 'chatdom-atlas-founding-request' || request.version !== 1) throw new Error('Not an Atlas founding request.');
const p = request.payload;
const valid = p?.kind === 'chatdom-atlas-founding-authorization' && (p.edition === '0' || p.edition === 'I')
  && /^obs-\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(p.revision) && /^[a-f0-9]{64}$/.test(p.taxonomySha256) && /^[a-z0-9_]{1,25}$/.test(p.issuedBy);
if (!valid) throw new Error('The founding request payload is malformed.');

const key = createPrivateKey(readFileSync(keyPath));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('The founder key must be an Ed25519 private key.');
const publicKey = createPublicKey(key);
const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');

const label = p.edition === 'I' ? 'Edition I' : 'Edition 0';
console.error(`\nYou are founding Atlas ${label}. From then on nobody's place on the map changes.\n`);
for (const [name, value] of Object.entries(request.summary ?? {})) console.error(`  ${name.padEnd(10)} ${value}`);
console.error(`  revision   ${p.revision}`);
console.error(`  families   sha256 ${p.taxonomySha256}`);
console.error(`  signed by  ${p.issuedBy}`);
console.error(`  your key   sha256 ${fingerprint}\n`);

const rl = createInterface({ input: process.stdin, output: process.stderr });
const typed = (await rl.question(`Type "${label}" to sign, anything else to stop: `)).trim();
rl.close();
if (typed !== label) {
  console.error('Not signed.');
  process.exit(1);
}

const payload = { kind: p.kind, edition: p.edition, revision: p.revision, taxonomySha256: p.taxonomySha256, issuedAt: Date.now(), issuedBy: p.issuedBy };
const canonical = Buffer.from(JSON.stringify(payload));
const signature = sign(null, canonical, key).toString('base64');
if (!verify(null, canonical, publicKey, Buffer.from(signature, 'base64'))) throw new Error('The signature did not verify; nothing written.');
const authorization = `${JSON.stringify({ version: 1, payload, signature }, null, 2)}\n`;
if (out) {
  writeFileSync(out, authorization, { flag: 'wx' });
  console.error(`Signed. Authorization written to ${out}; send it to the operator.`);
} else {
  process.stdout.write(authorization);
}
