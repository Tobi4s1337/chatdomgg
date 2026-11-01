// Captures the SIMULATED PinkKittyRose roses bench through the production renderer pieces.
// Run from the repository root:
//   node packages/content/src/genesis-kingdoms/pinkkitty/roses/bench/capture.mjs [--sizes 1920x1080] [--hour 19.9] [--time 42] [--view wide|left|right] [--port <p>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on the given
// capture port, or the first free one of 5170–5186, 5188 and 5189 (the bench is dev-served from the web app's config,
// never shipped), waits for the bench's readiness,
// fails on any page, console or shader error and stops only what it started.
// Output: shots/genesis/pinkkitty/roses-bench[-<view>][-<hour>]@<w>x<h>.png and roses-bench-stats.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { assertCapturePort } from '../../../../../../testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sizes = (option('--sizes') ?? '1920x1080').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const hour = Number(option('--hour') ?? 19.9), time = Number(option('--time') ?? 42);
// Lane benches keep to the low capture ports; 5187 and 5190–5199 belong to other capture owners on this host.
const LANE_PORTS = [...Array.from({ length: 17 }, (_, i) => 5170 + i), 5188, 5189];
const ports = option('--port') ? [assertCapturePort(Number(option('--port')))] : LANE_PORTS;
if (ports.some(port => !LANE_PORTS.includes(port))) throw new Error(`The roses bench serves only on ${LANE_PORTS.join(', ')}.`);
if (!(hour >= 0 && hour < 24) || !(time >= 0)) throw new Error('Expected --hour in [0,24) and --time >= 0');
const view = option('--view') ?? 'wide';
if (!['wide', 'left', 'right'].includes(view)) throw new Error('Expected --view wide|left|right');
const tag = `${view === 'wide' ? '' : `-${view}`}${option('--hour') ? `-${hour}` : ''}`;
const out = 'shots/genesis/pinkkitty';
const page = `/@fs${fileURLToPath(new URL('./index.html', import.meta.url))}`;

let server, browser, release;
const report = {};
try {
  release = await acquireCaptureLock();
  let base;
  for (const port of ports) {
    const candidate = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      resolve: { dedupe: ['three', '@chatdom/render', '@chatdom/voxel', '@chatdom/shared', '@chatdom/content', '@chatdom/world'] },
      optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await candidate.listen(); server = candidate; base = `http://127.0.0.1:${port}`; break; }
    catch (error) { await candidate.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  if (!base) throw new Error(`No free lane capture port among ${ports.join(', ')}.`);
  console.log(`Bench: ${base}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const [width, height] of sizes) {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await tab.goto(`${base}${page}?hour=${hour}&time=${time}${view === 'wide' ? '' : `&view=${view}`}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
    await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const name = `roses-bench${tag}@${width}x${height}`, path = `${out}/${name}.png`;
    await tab.screenshot({ path, timeout: 180_000 });
    report[name] = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomRoses.stats)));
    console.log(`Captured ${path}`);
    await tab.close();
  }
  await writeFile(`${out}/roses-bench${tag}-stats.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
