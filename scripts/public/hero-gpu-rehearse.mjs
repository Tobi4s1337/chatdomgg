// A rehearsal of scripts/public/hero-gpu.mjs off the GPU lease, so the lease itself is never spent finding a broken
// step. It takes the shared capture lock, starts a local headless Chrome (SwiftShader) with its DevTools on a capture
// port, and runs hero-gpu.mjs against it with the build served on another capture port. The numbers it writes are
// SwiftShader numbers: they prove the script runs end to end, never how fast the hero is.
//
//   node scripts/public/hero-gpu-rehearse.mjs --out /tmp/hero-gpu-rehearsal [--posters] [--timing]
//
// Build first (`node scripts/public/build.mjs --no-panel`). The hold is capped at five minutes.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { acquireCaptureLock } from '../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../packages/testing/capture-ports.mjs';

// Other lanes' benches hold capture ports too, so take the first two that are free right now.
const free = port => new Promise(done => {
  const probe = createServer().once('error', () => done(false)).once('listening', () => probe.close(() => done(true)));
  probe.listen(port, '127.0.0.1');
});
const HOLD_MS = 5 * 60_000;
const passed = process.argv.slice(2);
if (!passed.includes('--out')) passed.push('--out', '/tmp/hero-gpu-rehearsal');

let release, browser, child;
const finish = code => { child?.kill(); browser?.close().catch(() => undefined); release?.(); process.exit(code); };
try {
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(20 * 60_000) });
  setTimeout(() => { console.error('hero-gpu rehearsal: over its five-minute hold, stopped'); finish(124); }, HOLD_MS).unref();
  // Chosen once the lock is held: the queue can be long, and a port free before it may not be free after.
  const open = [];
  for (const port of CAPTURE_PORTS) if (open.length < 2 && await free(port)) open.push(port);
  if (open.length < 2) { console.error('hero-gpu rehearsal: no two capture ports are free'); finish(75); }
  const [CDP_PORT, APP_PORT] = open;
  console.log(`rehearsal: DevTools on ${CDP_PORT}, the build on ${APP_PORT}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox',
      `--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1'] });
  child = spawn(process.execPath, [resolve(import.meta.dirname, 'hero-gpu.mjs'), ...passed], {
    stdio: 'inherit', env: { ...process.env, PC_CDP: `http://127.0.0.1:${CDP_PORT}`, HERO_GPU_PORT: String(APP_PORT), HERO_GPU_TIER: 'software' },
  });
  const code = await new Promise(done => { child.on('exit', done); });
  child = undefined;
  finish(code ?? 1);
} catch (error) {
  console.error(error);
  finish(1);
}
