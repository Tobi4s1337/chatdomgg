// Run inside chatdom-pc-lease. Fixture bench shots document layout only, not payment or delivery.
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = join(root, 'work/evidence/panel-window/PW12');
const env = process.env;
const database = new URL(env.DATABASE_URL || 'http://missing');
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '5410' || env.REALM_DATABASE_SCHEMA !== 'panel_window') {
  throw new Error('Capture requires the isolated panel_window development database.');
}
const children = [];
const completions = new WeakMap();
const abort = new globalThis.AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function free(port) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
async function start(args, cwd, variables, path) {
  const log = await open(path, 'w', 0o600);
  try {
    const child = spawn(process.execPath, args, { cwd, env: variables, stdio: ['ignore', log.fd, log.fd] });
    // Observe completion at spawn: a fast failure must not disappear before wait() attaches.
    const completion = new Promise(resolve => {
      child.once('error', () => resolve({ error: true }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    completions.set(child, completion);
    children.push(child);
    return child;
  } finally { await log.close(); }
}
async function ready(url, child) {
  const until = Date.now() + 60_000;
  while (Date.now() < until && !abort.signal.aborted && child.exitCode === null) {
    try { const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* Still starting. */ }
    await delay(250);
  }
  throw new Error(`Service on ${new URL(url).port} did not become ready.`);
}
async function wait(child) {
  const result = await completions.get(child);
  if (result?.code !== 0) throw new Error(`Capture process failed (${result?.error ? 'could not start' : result?.code ?? result?.signal}).`);
}
function shot(url, file, size) {
  return new Promise((resolve, reject) => execFile('chatdom-pc', ['shot', url, file, '--size', size, '--timeout', '60', '--settle', '1'],
    { timeout: 75_000 }, error => error ? reject(new Error(`GPU shot failed: ${size}.`)) : resolve()));
}
let logDir, success = false;
const failures = [];
try {
  await free(5172); await free(5192);
  logDir = await mkdtemp(join(tmpdir(), 'pw12-capture-'));
  await mkdir(evidence, { recursive: true });
  const vars = { ...env, REALM_PORT: '5172', REALM_HOST: '127.0.0.1' };
  try {
    const realm = await start([join(root, 'apps/realm/dist/realm.mjs')], root, vars, join(logDir, 'realm.log'));
    await ready('http://127.0.0.1:5172/readyz', realm);
    const pw11 = await start([join(root, 'apps/panel/scripts/pw11-capture.mjs')], root, vars, join(logDir, 'pw11.log'));
    await wait(pw11);
    console.info('PW11 lane capture completed.');
  } catch (error) {
    failures.push('PW11 street and privacy capture');
    console.error(error instanceof Error ? error.message : 'PW11 capture failed.');
  }
  if (abort.signal.aborted) throw new Error('Capture interrupted.');
  try {
    await free(5192);
    const panel = await start([join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5192', '--strictPort'], join(root, 'apps/panel'), vars, join(logDir, 'panel.log'));
    await ready('http://127.0.0.1:5192/src/gifts/bench.html', panel);
    const release = await acquireCaptureLock();
    try {
      for (const state of ['closed', 'open', 'choosing', 'choosing-paid', 'confirming', 'pending', 'delivered', 'cancelled', 'unavailable']) {
        for (const size of ['318x496', '390x844']) {
          if (abort.signal.aborted) throw new Error('Capture interrupted.');
          await shot(`http://localhost:5192/src/gifts/bench.html?state=${state}`, join(evidence, `${state}@${size}.png`), size);
          console.info(`Captured ${state} at ${size}.`);
        }
      }
    } finally { await release(); }
    const configuration = await start([join(root, 'apps/panel/scripts/pw13-capture.mjs')], root, vars, join(logDir, 'pw13.log'));
    await wait(configuration);
    console.info('PW13 configuration capture completed.');
  } catch (error) {
    failures.push('PW12 gift shelf captures');
    console.error(error instanceof Error ? error.message : 'PW12 capture failed.');
  }
  if (failures.length) throw new Error(`Incomplete: ${failures.join(', ')}.`);
  success = true;
} finally {
  for (const child of [...children].reverse()) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(child => completions.get(child)));
  if (logDir) {
    if (success) await rm(logDir, { recursive: true, force: true });
    else console.error(`Private diagnostic logs retained in ${logDir}.`);
  }
}
