// Captures one SIMULATED bench set of The_AGGman's pieces. Run from the repository root:
//   node packages/content/src/genesis-kingdoms/aggman/bench/capture.mjs --set harbour [--view front|side|back|top] [--size 1600x1000] [--hour 19.4]
// Takes the machine-wide capture lock, serves the bench from the web app's Vite config on a free capture port,
// fails on any page or console error and writes shots/genesis/aggman/bench-<set>-<view>@<w>x<h>.png.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const set = option('--set'), view = option('--view', 'front'), hour = option('--hour', '19.4');
const [width, height] = option('--size', '1600x1000').split('x').map(Number);
if (!set) throw new Error('Expected --set <folder>');
const page = `/@fs${fileURLToPath(new URL('./index.html', import.meta.url))}`;
let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base;
  for (const port of CAPTURE_PORTS) {
    const candidate = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      resolve: { dedupe: ['three', '@chatdom/render', '@chatdom/voxel', '@chatdom/shared'] }, optimizeDeps: { entries: [] },
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await candidate.listen(); server = candidate; base = `http://127.0.0.1:${port}`; break; }
    catch (error) { await candidate.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  if (!base) throw new Error('No safe capture port available.');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const tab = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await tab.goto(`${base}${page}?set=${encodeURIComponent(set)}&view=${view}&hour=${hour}`);
  await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
  const failure = await tab.evaluate(() => document.body.dataset.error);
  if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
  await mkdir('shots/genesis/aggman', { recursive: true });
  const path = `shots/genesis/aggman/bench-${set}-${view}@${width}x${height}.png`;
  await tab.screenshot({ path, timeout: 180_000 });
  console.log(`Captured ${path}`, JSON.stringify(await tab.evaluate(() => window.__aggmanBench)));
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
