/**
 * FW12: read "the forge remembers" through the real route handler of a private durable realm (the same handler
 * `mountForgeLedgerRoutes` serves; every lane port was taken by other services), over a kingdom an earlier proof
 * forged real wishes in. Writes the public answer (word-free by construction) for the bench and stills.
 * Run through work/lanes/forge-wish/ledger-snapshot.mjs with the private DATABASE_URL loaded; never echo it.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ForgeLedgerViewSchema, KingdomIdSchema } from '../../../../packages/shared/src';
import { createDurableRealmBoot } from '../../../../apps/realm/src/bootstrap/durable';
import { TenureEvidenceVerifier } from '../../../../apps/realm/src/allocation';
import { createRealmPool } from '../../../../apps/realm/src/persistence';
import { createRealmCitizens } from '../../../../apps/realm/src/evening/citizens';
import { ForgeWriteGate } from '../../../../apps/realm/src/wiring';
import { createForgeLedgerHandler, forgeLedgerSource } from '../../../../apps/realm/src/forge-ledger/http';

const [directory, out] = process.argv.slice(2);
if (!directory || !out) throw new Error('usage: <proof directory> <out.json>');
if (!process.env.DATABASE_URL || process.env.REALM_DATABASE_SCHEMA !== 'realm_forge_wish') throw new Error('Load the private DATABASE_URL and REALM_DATABASE_SCHEMA=realm_forge_wish.');
const { kingdomId: raw } = JSON.parse(await (await import('node:fs/promises')).readFile(join(directory, 'realm.json'), 'utf8')) as { kingdomId: string };
const kingdomId = KingdomIdSchema.parse(raw);
const pool = createRealmPool({ connectionString: process.env.DATABASE_URL, schema: 'realm_forge_wish' });
const evidenceKey = Buffer.alloc(32, 7);
const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: new Map([[kingdomId, 'Birchlight']]), evidenceKey });
const boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: join(directory, 'founded'), log: () => {},
  verifier: new TenureEvidenceVerifier('simulated', evidenceKey), ingressCredentials: {},
  foundedAccess: target => target.origin === 'simulated', furnish: citizens.furnish,
  repositoryOptions: { ...new ForgeWriteGate().install({ origin: 'simulated' }), leaseMs: 20_000 } });
const handle = createForgeLedgerHandler(forgeLedgerSource(boot.services));
try {
  let reply: Awaited<ReturnType<typeof handle>>;
  // A writer lease left by the earlier proof lapses on its own; the route answers 503 until then.
  for (const end = Date.now() + 90_000; ;) {
    reply = await handle(`kingdomId=${kingdomId}`);
    if (reply.http !== 503 || Date.now() > end) break;
    await new Promise(done => setTimeout(done, 11_000));
  }
  if (reply.http !== 200) throw new Error(`ledger answered ${reply.http}: ${JSON.stringify(reply.body)}`);
  const view = ForgeLedgerViewSchema.parse(JSON.parse(JSON.stringify(reply.body)));
  await writeFile(out, JSON.stringify(view, null, 1) + '\n');
  console.info(`ledger: ${view.total} pieces, ${view.entries.length} listed, newest "${view.entries[0]?.title ?? '-'}"`);
} finally {
  await boot.stop().catch(() => {}); await pool.end().catch(() => {});
}
