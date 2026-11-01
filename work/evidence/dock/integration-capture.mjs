// One owned child, one still. The host lock queue has no deadline; work after admission does.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

if (process.env.CHATDOM_DOCK_BENCH_UNTESTED !== '1') throw Error('Untested scaffold: explicit CHATDOM_DOCK_BENCH_UNTESTED=1 is required.');
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required for the isolated simulated schema.');
const release = await acquireCaptureLock({ priority: 'lane' });
const schema = `dock_capture_${randomBytes(8).toString('hex')}`;
let dir, pool, ownsSchema = false, child, exited, timeout, monitor, stopping, stage = 'prepare owned resources', failed = false, browserStarted = false, browserTracked = false, browserClosed = false;
const ownedGroups = new Map();
// Playwright starts Chrome in its own process group. Snapshot only descendants of our
// stopped child, then wait for every identified group to have no live process before release.
const proc = async pid => { try { const raw = await readFile(`/proc/${pid}/stat`, 'utf8'); const f = raw.slice(raw.lastIndexOf(')') + 2).split(' '); return { pid, state: f[0], parent: Number(f[1]), group: Number(f[2]), start: f[19] }; } catch { return null; } };
const snapshot = async () => (await Promise.all((await readdir('/proc')).filter(name => /^\d+$/.test(name)).map(name => proc(Number(name))))).filter(Boolean);
const signalGroup = (group, signal) => { try { process.kill(-group, signal); } catch (error) { if (error.code !== 'ESRCH') failed = true; } };
async function rememberGroups() {
  if (!child?.pid) return;
  const table = await snapshot(), leader = table.find(item => item.pid === child.pid), known = ownedGroups.get(child.pid);
  if (!leader || (known && leader.start !== known)) return;
  const descendants = new Set([child.pid]);
  let previous; do { previous = descendants.size; for (const item of table) if (descendants.has(item.parent)) descendants.add(item.pid); } while (previous !== descendants.size);
  for (const item of table) if (descendants.has(item.pid) && item.pid === item.group) ownedGroups.set(item.group, item.start);
}
async function liveOwnedGroups() {
  const table = await snapshot(), result = [];
  for (const [group, start] of ownedGroups) {
    const leader = table.find(item => item.pid === group);
    // A reused numeric PID belongs to a different process; never signal it.
    if (leader && leader.start !== start) continue;
    if (table.some(item => item.group === group && item.state !== 'Z')) result.push(group);
  }
  return result;
}
async function stopOwned() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(child.pid, 'SIGSTOP'); } catch (error) { if (error.code !== 'ESRCH') failed = true; }
  await rememberGroups();
  for (const group of await liveOwnedGroups()) signalGroup(group, 'SIGTERM');
  try { process.kill(child.pid, 'SIGCONT'); } catch (error) { if (error.code !== 'ESRCH') failed = true; }
  const deadline = Date.now() + 5000;
  for (;;) {
    const alive = await liveOwnedGroups();
    if (!alive.length) break;
    if (Date.now() >= deadline) for (const group of alive) signalGroup(group, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await exited;
}
const cancel = () => { if (!stopping) { failed = true; console.error(`SIMULATED bench stopping during ${stage}; closing its owned processes.`); stopping = stopOwned(); } };
process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
timeout = setTimeout(() => { console.error(`SIMULATED bench deadline exceeded during ${stage}.`); cancel(); }, 8 * 60_000);
try {
  dir = await mkdtemp('/tmp/chatdom-dock-capture-');
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 3000,
    statement_timeout: 5000, query_timeout: 6000, application_name: 'chatdom-dock-capture-supervisor' });
  await pool.query(`CREATE SCHEMA "${schema}"`); ownsSchema = true;
  if (stopping) throw Error('Capture cancelled');
  stage = 'start and capture';
  child = spawn(process.execPath, [fileURLToPath(new URL('./integration.mjs', import.meta.url)), ...process.argv.slice(2)], {
    detached: true, stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
    env: { ...process.env, CHATDOM_DOCK_CAPTURE_SCHEMA: schema, CHATDOM_DOCK_CAPTURE_DIR: dir },
  });
  child.stderr.resume(); // Driver errors can contain database URLs; never echo them.
  exited = new Promise(resolve => { child.once('error', () => { clearInterval(monitor); resolve({ code: null, signal: 'spawn-error' }); }); child.once('close', (code, signal) => { clearInterval(monitor); resolve({ code, signal }); }); });
  child.on('message', message => {
    if (message === 'browser-closed') browserClosed = true;
    if (message === 'browser-started') { browserStarted = true; void rememberGroups().then(() => {
      browserTracked = [...ownedGroups.keys()].some(group => group !== child.pid);
      if (child.connected) child.send(browserTracked ? 'browser-tracked' : 'browser-untracked');
    }).catch(() => { if (child.connected) child.send('browser-untracked'); }); }
  });
  await rememberGroups();
  monitor = setInterval(() => { void rememberGroups().catch(() => { failed = true; }); }, 250);
  const result = await exited;
  clearInterval(monitor);
  clearTimeout(timeout); if (stopping) await stopping;
  if (browserStarted && !browserTracked && !browserClosed) {
    console.error('SIMULATED bench cannot confirm its untracked browser closed; retaining the capture lock for intervention.');
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  const lingering = await liveOwnedGroups();
  if (lingering.length) {
    failed = true; console.error('SIMULATED bench left owned browser or service processes; closing them before release.');
    for (const group of lingering) signalGroup(group, 'SIGKILL');
    while ((await liveOwnedGroups()).length) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (result.code !== 0) { failed = true; console.error(`SIMULATED bench failed during ${stage} (${result.signal ?? `exit ${result.code}`}).`); }
} catch {
  failed = true; console.error(`SIMULATED bench failed during ${stage}; no database URL or credentials are printed.`);
  if (child && child.exitCode === null && child.signalCode === null) { cancel(); await stopping; }
} finally {
  clearTimeout(timeout); clearInterval(monitor); if (stopping) await stopping;
  stage = 'remove owned resources';
  if (ownsSchema) try { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); } catch { failed = true; console.error(`SIMULATED bench could not remove owned schema ${schema}.`); }
  try { await pool?.end(); } catch { failed = true; }
  if (dir) try { await rm(dir, { recursive: true, force: true }); } catch { failed = true; console.error(`SIMULATED bench could not remove owned directory ${dir}.`); }
  await release();
  if (failed) process.exitCode = 1;
}
