// GW13 bench stills: a channel's own world under the sea mist, staged by citizen count on /-/grand-bench.
// usage: node work/lanes/grand-world/capture-gw13.mjs <name> '<query>' [width height]
// Serves apps/web with Vite on capture port 5176 and holds the shared capture lock only while the browser draws.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const [name, query, width = '1440', height = '900'] = process.argv.slice(2);
if (!name || !query) throw new Error('usage: capture-gw13.mjs <name> <query> [width height]');
const port = assertCapturePort(Number(process.env.GW13_PORT ?? 5176));
const out = 'shots/grand-world/gw13';
await mkdir(out, { recursive: true });
const server = spawn('nice', ['-n', '10', 'npx', 'vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: 'apps/web', stdio: ['ignore', 'pipe', 'inherit'], detached: true });
// nice and npx do not pass a signal on to Vite: stop the whole group, also when this script is interrupted.
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.once('exit', stopServer);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopServer(); process.exit(130); });
await new Promise((resolve, reject) => {
  server.stdout.on('data', data => { if (String(data).includes('Local')) resolve(); });
  server.once('exit', code => reject(new Error(`vite exited ${code}`)));
});
let release, browser;
try {
  release = await acquireCaptureLock({ priority: 'lane' });
  const started = Date.now();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  page.on('pageerror', error => console.error('[page]', error.message));
  await page.goto(`http://127.0.0.1:${port}/-/grand-bench?${query}`);
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000, polling: 1000 });
  const file = `${out}/${name}@${width}x${height}.png`;
  await page.screenshot({ path: file });
  console.log(file, `${Math.round((Date.now() - started) / 1000)} s under the lock`);
} finally {
  await browser?.close();
  await release?.();
  stopServer();
}
