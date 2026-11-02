// The gift shelf's stills on the real GPU. Run inside chatdom-pc-lease:
//
//   chatdom-pc-lease --wait 30 --max 10 -- node apps/panel/scripts/pw12-capture.mjs
//
// It serves the panel's development bench on 127.0.0.1:5192 (the lease's harness port), shoots every shelf state at
// the panel and phone sizes with chatdom-pc, and stops its own server. The bench drives the real Panel and GiftShelf
// with a fixture adapter: these stills document the shelf's look in each state, not a payment or a world effect
// (apps/api/src/panel/gifts/browser.integration.test.ts proves the paid path end to end).
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = join(root, 'work/evidence/panel-window/PW12/gpu');
const STATES = ['closed', 'open', 'detail', 'choosing', 'confirming', 'pending', 'delivered', 'cancelled', 'unavailable', 'choosing-paid'];
const SIZES = ['318x496', '390x844'];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : STATES;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function free(port) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
function shot(url, file, size) {
  return new Promise((resolve, reject) => execFile('chatdom-pc', ['shot', url, file, '--size', size, '--timeout', '60', '--settle', '1.5'],
    { timeout: 75_000 }, error => error ? reject(new Error(`GPU shot failed: ${size}.`)) : resolve()));
}

await free(5192);
await mkdir(evidence, { recursive: true });
const log = await open(join(tmpdir(), 'pw12-capture-vite.log'), 'w', 0o600);
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5192', '--strictPort'],
  { cwd: join(root, 'apps/panel'), stdio: ['ignore', log.fd, log.fd] });
const stop = () => { if (vite.exitCode === null && vite.signalCode === null) vite.kill('SIGTERM'); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  const until = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch('http://127.0.0.1:5192/src/gifts/bench.html', { signal: globalThis.AbortSignal.timeout(1000) })).ok) break; } catch { /* still starting */ }
    if (Date.now() > until || vite.exitCode !== null) throw new Error('The bench did not start on 5192.');
    await delay(250);
  }
  // Warm the module graph once so the first still is not taken mid-transform.
  await fetch('http://127.0.0.1:5192/src/gifts/bench.tsx').catch(() => {});
  for (const state of only) for (const size of SIZES) {
    await shot(`http://localhost:5192/src/gifts/bench.html?state=${state}`, join(evidence, `${state}@${size}.png`), size);
    console.info(`Captured ${state} at ${size}.`);
  }
} finally {
  stop();
  await new Promise(resolve => vite.exitCode !== null || vite.signalCode !== null ? resolve() : vite.once('close', resolve));
  await log.close();
}
