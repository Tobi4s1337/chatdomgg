// Offline backend check for the walk proof: the same durable SIMULATED realm, with each wish played back as a sent
// chat message would be (chat witness, then the Herald-shaped wish), but with no browser, no TCP port and no capture
// lock. It answers "does a wish land in this realm right now?" in a minute, before spending lock time on the walk.
//
// REALM_DATABASE_SCHEMA=realm_forge_wish nice -n 10 node --env-file=/srv/chatdom/chatdomgg/.env \
//   work/lanes/forge-wish/walk-proof/check.mjs [--controlled | --real] [--stagger=<minutes>] [fw10-01 ...]
// --stagger plays wish n back n x <minutes> after the realm is ready, as the walk proof's later holds do.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startWalkRealm, SCHEMA } from './realm.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg.startsWith('--') && !['--controlled', '--real'].includes(arg) && !/^--stagger=\d+(\.\d+)?$/.test(arg))) throw new Error('Use --controlled (default) or --real, optional --stagger=<minutes>, then optional wish ids.');
const stagger = Number(args.find(arg => arg.startsWith('--stagger='))?.slice('--stagger='.length) ?? 0) * 60_000;
const mode = args.includes('--real') ? 'real' : 'controlled', ids = args.filter(arg => !arg.startsWith('--'));
if (!process.env.DATABASE_URL || process.env.REALM_DATABASE_SCHEMA !== SCHEMA) throw new Error(`Load DATABASE_URL with node --env-file and set REALM_DATABASE_SCHEMA=${SCHEMA}.`);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const href = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  try { if (/(^|\.)twitch\.tv$/i.test(new URL(href).hostname)) return Promise.reject(new Error('Walk proof: Twitch is simulated here.')); } catch { /* relative */ }
  return nativeFetch(input, init);
};

const directory = join('/tmp/chatdom-forge-wish', `walk-proof-check-${randomUUID()}`);
await mkdir('/tmp/chatdom-forge-wish', { recursive: true }); await mkdir(directory, { mode: 0o700 });
let loader, realm;
const report = { directory, mode, wishes: [] };
const stop = async () => { await realm?.stop().catch(() => {}); await loader?.close().catch(() => {}); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().finally(() => process.exit(130)); });
try {
  loader = await createServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', cacheDir: join(directory, 'vite-cache'),
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false } });
  const { FW10_WISHES } = await loader.ssrLoadModule('/apps/codex/src/fixtures/fw10-wishes.ts');
  const wishes = (ids.length ? ids : ['fw10-01', 'fw10-08', 'fw10-15']).map(id => FW10_WISHES.find(item => item.id === id) ?? (() => { throw new Error(`unknown wish ${id}`); })());
  realm = await startWalkRealm({ loader, repo, directory, mode, wishes, log: line => console.log(`[check] ${line}`) });
  await Promise.all(wishes.map(async (wish, index) => {
    await new Promise(resolve => setTimeout(resolve, index * stagger));
    const person = realm.people[index], started = Date.now();
    await realm.replayChatWish(person.personId, wish.words);
    while (!realm.outcome(person.personId) && Date.now() - started < 12 * 60_000) await new Promise(resolve => setTimeout(resolve, 1000));
    const outcome = realm.outcome(person.personId);
    report.wishes.push({ id: wish.id, status: outcome?.status ?? null, seconds: outcome ? Math.round((outcome.at - started) / 100) / 10 : null,
      message: outcome?.message ?? null, landed: await realm.landed(person.personId) });
  }));
  report.ok = report.wishes.every(row => row.status === 'delivered' && row.landed.attachments === 1 && row.landed.spent === 1) && !realm.facts.publicLeak;
} catch (error) {
  report.error = realm?.redact(error?.message ?? error) ?? String(error?.message ?? error);
} finally {
  if (realm) report.realmLog = realm.facts.realmLog;
  await stop();
  await writeFile(join(directory, 'check.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, realmLog: `${report.realmLog?.length ?? 0} lines in check.json` }, null, 2));
  process.exit(report.ok ? 0 : 1);
}
