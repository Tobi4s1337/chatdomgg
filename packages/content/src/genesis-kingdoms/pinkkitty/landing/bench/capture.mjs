// Captures the SIMULATED PinkKittyRose landing bench through the production renderer pieces.
// Run from the repository root:
//   node packages/content/src/genesis-kingdoms/pinkkitty/landing/bench/capture.mjs [--views landing,screen,back] [--sizes 1920x1080] [--hour 19.6]
// It takes the machine-wide capture lock, starts its own Vite dev server on a free port in 5170–5186 or 5188–5189,
// waits for the bench's readiness, fails on any page, console or shader error and stops what it started.
// Output: shots/genesis/pinkkitty/<view>-bench[-<hour>]@<w>x<h>.png.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sizes = (option('--sizes') ?? '1920x1080').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const views = (option('--views') ?? 'landing').split(',');
const hourArg = option('--hour'), hour = Number(hourArg ?? 19.6);
if (!(hour >= 0 && hour < 24)) throw new Error('Expected --hour in [0,24)');
const out = 'shots/genesis/pinkkitty';
const page = `/@fs${fileURLToPath(new URL('./index.html', import.meta.url))}`;
const PORTS = CAPTURE_PORTS.filter(port => (port >= 5170 && port <= 5186) || port === 5188 || port === 5189);

async function startBenchServer() {
  for (const port of PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      resolve: { dedupe: ['three', '@chatdom/render', '@chatdom/voxel', '@chatdom/shared', '@chatdom/content', '@chatdom/world'] },
      optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  const started = await startBenchServer();
  server = started.server;
  console.log(`Bench: ${started.base} (started here)`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const view of views) for (const [width, height] of sizes) {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await tab.goto(`${started.base}${page}?view=${view}&hour=${hour}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
    await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const path = `${out}/${view}-bench${hourArg ? `-${hour}` : ''}@${width}x${height}.png`;
    await tab.screenshot({ path, timeout: 180_000 });
    console.log(`Captured ${path}`, JSON.stringify(await tab.evaluate(() => window.__chatdomPinkkittyLanding.stats)));
    await tab.close();
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
