// Captures the SIMULATED Genesis landmark bench through the production renderer pieces.
// Run from the repository root:
//   node packages/content/src/genesis-landmarks/bench/capture.mjs [--scene harbour|river|mountain] [--sizes 1920x1080] [--hour 20.4] [--time 42]
//     [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on a free
// capture port unless --base-url is given (the bench is dev-served from the web app's config, never shipped),
// waits for the bench's readiness, fails on any page, console or shader error and stops only what it started.
// Output: shots/genesis-landmarks/<scene>-<hour>@<w>x<h>.png and stats-<scene>.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sizes = (option('--sizes') ?? '1920x1080').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const hour = Number(option('--hour') ?? 20.4), time = Number(option('--time') ?? 42);
const sceneName = option('--scene') ?? 'harbour';
if (!['harbour', 'river', 'mountain'].includes(sceneName)) throw new Error('Expected --scene harbour|river|mountain');
if (!(hour >= 0 && hour < 24) || !(time >= 0)) throw new Error('Expected --hour in [0,24) and --time >= 0');
const extra = option('--query') ?? '', tag = extra ? `-${extra.replace(/[^a-z0-9]+/gi, '-')}` : '';
const out = 'shots/genesis-landmarks';
const page = `/@fs${fileURLToPath(new URL('./index.html', import.meta.url))}`;

async function startBenchServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      resolve: { dedupe: ['three', '@chatdom/render', '@chatdom/voxel', '@chatdom/shared', '@chatdom/content', '@chatdom/world'] },
      optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

let server, browser, release;
const report = {};
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startBenchServer());
  console.log(`Bench: ${base}${server ? ' (started here)' : ''}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const [width, height] of sizes) {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await tab.goto(`${base}${page}?scene=${sceneName}&hour=${hour}&time=${time}${extra ? `&${extra}` : ''}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
    await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const name = `${sceneName}-${hour}${tag}@${width}x${height}`, path = `${out}/${name}.png`;
    await tab.screenshot({ path, timeout: 180_000 });
    report[name] = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomLandmark.stats)));
    console.log(`Captured ${path}`);
    await tab.close();
  }
  await writeFile(`${out}/stats-${sceneName}.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
