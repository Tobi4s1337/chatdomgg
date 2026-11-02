import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Manual real-data guard. Build Surveyor first; run from repository root, niced and affinity-limited.
// Every signalled PID is a direct child of this script. No port/process discovery or collector access.
const seedDir = resolve(process.env.ATLAS_DATA_DIR ?? 'apps/surveyor/shots/atlas-data');
const dataDir = mkdtempSync(join(dirname(seedDir), 'road-recovery-'));
const evidence = resolve('work/evidence/atlas-map/am11-road-recovery.json');
const journal = join(dataDir, 'roads/ledger.ndjson');
const children = new Set();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pointer = JSON.parse(readFileSync(join(seedDir, 'current.json')));
const originalDir = join(seedDir, 'revisions', pointer.revision);
const sourceDir = join(dataDir, 'revisions', pointer.revision);
mkdirSync(sourceDir, { recursive: true });
for (const name of ['import.json', 'raid-observations.ndjson']) copyFileSync(join(originalDir, name), join(sourceDir, name));
copyFileSync(join(seedDir, 'current.json'), join(dataDir, 'current.json'));
const source = join(sourceDir, 'raid-observations.ndjson');
const original = join(originalDir, 'raid-observations.ndjson');
const sourceBefore = { sha256: sha(readFileSync(source)), mtimeMs: statSync(source).mtimeMs, bytes: statSync(source).size };
const originalBefore = { sha256: sha(readFileSync(original)), mtimeMs: statSync(original).mtimeMs, bytes: statSync(original).size };
const expectedIds = readFileSync(source, 'utf8').trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line).raid.id).sort();
function launch() {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/surveyor/dist/atlas.mjs', 'serve'], {
    env: { ...process.env, ATLAS_DATA_DIR: dataDir, ATLAS_HOST: '127.0.0.2', ATLAS_PORT: '5199', ATLAS_RAID_FEED_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  child.stdout.on('data', data => { output = (output + data).slice(-8192); });
  child.stderr.on('data', data => { output = (output + data).slice(-8192); });
  const ended = new Promise(resolve => child.once('exit', (code, signal) => { children.delete(child); resolve({ code, signal }); }));
  return { child, ended, output: () => output };
}
async function until(predicate, label, timeout = 120_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await delay(50);
  }
}
async function stop(run, signal = 'SIGINT') {
  if (children.has(run.child)) run.child.kill(signal);
  return Promise.race([run.ended, delay(10_000).then(() => { throw new Error('Owned service did not stop.'); })]);
}
function snapshot() {
  const bytes = readFileSync(journal);
  const lines = bytes.toString('utf8').trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const observations = lines.filter(line => line.body.kind === 'observation');
  const canonical = observations.filter(line => line.body.raid.id === line.body.canonicalId);
  const checkpoint = [...lines].reverse().find(line => line.body.checkpoint?.source === 'surveyor-recorder')?.body.checkpoint.cursor ?? null;
  return { sha256: sha(bytes), bytes: bytes.length, records: lines.length, raids: canonical.length,
    roads: new Set(canonical.map(line => [line.body.raid.fromKingdomId, line.body.raid.toKingdomId].sort().join('~'))).size,
    checkpoint, idsSha256: sha(JSON.stringify(canonical.map(line => line.body.raid.id).sort())), example: canonical[0]?.body.raid ?? null };
}
const started = Date.now();
try {
  const first = launch();
  await until(() => first.output().includes('atlas:serve http://'), 'own listener');
  // Prove the competing writer cannot take over this data directory.
  const competitor = launch();
  const competing = await competitor.ended;
  if (competing.code === 0 || !competitor.output().includes('locked')) throw new Error('Competing writer was not refused by the file lease.');
  await until(() => existsSync(journal) && statSync(journal).size >= 256 * 1024, 'durable prefix');
  const crash = await stop(first, 'SIGKILL');
  const crashBytes = readFileSync(journal);
  const prefix = crashBytes.subarray(0, crashBytes.lastIndexOf(10) + 1).toString('utf8').trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const afterCrash = { bytes: statSync(journal).size, signal: crash.signal, records: prefix.length,
    recorderCheckpoint: prefix.some(line => line.body.checkpoint?.source === 'surveyor-recorder') };
  if (afterCrash.recorderCheckpoint || prefix.length >= expectedIds.length) throw new Error('Crash did not interrupt the initial recorder backfill.');
  const recovery = launch();
  await until(() => recovery.output().includes('roads unconnected'), 'recorder recovery');
  await stop(recovery);
  const beforeRestart = snapshot();
  if (beforeRestart.checkpoint !== pointer.revision) throw new Error('Recorder cursor did not reach its verified import.');
  if (beforeRestart.raids !== expectedIds.length || beforeRestart.idsSha256 !== sha(JSON.stringify(expectedIds))) throw new Error('Recovered IDs/count do not match the verified recorder import.');
  const third = launch();
  await until(() => third.output().includes('roads unconnected'), 'clean restart');
  await stop(third);
  const afterRestart = snapshot();
  const unchanged = JSON.stringify(beforeRestart) === JSON.stringify(afterRestart);
  const sourceAfter = { sha256: sha(readFileSync(source)), mtimeMs: statSync(source).mtimeMs, bytes: statSync(source).size };
  const originalAfter = { sha256: sha(readFileSync(original)), mtimeMs: statSync(original).mtimeMs, bytes: statSync(original).size };
  if (!unchanged || JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter) || JSON.stringify(originalBefore) !== JSON.stringify(originalAfter)) throw new Error('Restart or recovery changed durable memory/source bytes.');
  const result = { kind: 'real-recorder-recovery', revision: pointer.revision, source: sourceBefore,
    competingWriterRefused: true, afterCrash, beforeRestart, afterRestart, unchanged, sourceUnchanged: true,
    expectedRaidIdsSha256: sha(JSON.stringify(expectedIds)), expectedRaids: expectedIds.length,
    elapsedMs: Date.now() - started, raidShowFeedConnected: false, publicRoadRenderingVerified: false };
  writeFileSync(evidence, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ evidence, raids: result.afterRestart.raids, roads: result.afterRestart.roads, unchanged, elapsedMs: result.elapsedMs })}\n`);
} finally {
  await Promise.all([...children].map(child => { child.kill('SIGINT'); return new Promise(resolve => child.once('exit', resolve)); }));
}
