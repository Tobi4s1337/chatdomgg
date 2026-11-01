// Proves the realm itself takes one piece of evidence once: the same spectacle posted twice to the realm's ingress
// (as Herald's outbox does after a lost reply) answers `accepted`, then `duplicate`.
//   node scripts/live/retry.mjs
import { randomUUID } from 'node:crypto';
import { BENCH, readState, report } from './lib.mjs';

const secret = readState()?.secrets?.ingress;
if (!secret) { console.error('retry: run scripts/live/bench.mjs up first'); process.exit(1); }
const now = Date.now(), id = `retry-${randomUUID()}`;
const moment = { version: 1, id, kingdomId: BENCH.kingdomId, origin: 'simulated', occurredAt: now - 50, receivedAt: now,
  notice: { kind: 'bits', payer: null, act: { kind: 'cheer', bits: 1 } } };
const post = () => fetch(`http://127.0.0.1:${BENCH.realmPort}/internal/realm/ingress`, { method: 'POST',
  headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, moment }) })
  .then(async response => `${response.status} ${(await response.json()).status}`);
const first = await post(), second = await post();
report([`retry · SIMULATED · one cheer of 1 Bit, posted twice to the realm`, `  first: ${first}`, `  again: ${second}`]);
if (!first.endsWith('accepted') || !second.endsWith('duplicate')) process.exit(1);
