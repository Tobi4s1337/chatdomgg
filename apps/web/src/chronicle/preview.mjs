import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS, assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const web = resolve(root, 'apps/web');

/** Probe only capture-owned ports; never contact or stop whichever process already owns one. */
async function portFree(port) {
  return new Promise((resolveResult, reject) => {
    const probe = createServer();
    probe.once('error', error => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolveResult(false);
      else reject(error);
    });
    probe.listen(assertCapturePort(port), '127.0.0.1', () => probe.close(() => resolveResult(true)));
  });
}
async function freePorts() {
  const free = await Promise.all(CAPTURE_PORTS.map(portFree));
  return CAPTURE_PORTS.filter((_, index) => free[index]);
}

async function startOn(port) {
  const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  try {
    const base = await new Promise((accept, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error('Vite did not start')), 30_000);
      const data = chunk => {
        output += chunk;
        const match = output.match(/Local:\s*(https?:\/\/127\.0\.0\.1:\d+\/)/);
        if (match) { globalThis.clearTimeout(timeout); accept(match[1]); }
      };
      server.stdout.on('data', data); server.stderr.on('data', data);
      server.once('error', error => { globalThis.clearTimeout(timeout); reject(error); });
      server.once('exit', code => { globalThis.clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${output}`)); });
    });
    return { server, base };
  } catch (error) {
    if (server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await new Promise(done => server.once('exit', done)); }
    if (/port .* is already in use/i.test(output)) return null;
    throw error;
  }
}

/** Wait without holding the shared lock while every allowed port is occupied. */
export async function startChroniclePreview() {
  for (;;) {
    if (!(await freePorts()).length) { console.log('[capture] all permitted ports are occupied; waiting'); await delay(5000); continue; }
    const release = await acquireCaptureLock();
    try {
      for (const port of await freePorts()) {
        const preview = await startOn(port);
        if (preview) return { ...preview, release };
      }
    } catch (error) { await release(); throw error; }
    await release();
    console.log('[capture] permitted ports became occupied; waiting');
    await delay(5000);
  }
}
