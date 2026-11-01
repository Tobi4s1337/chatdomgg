// Captures the SIMULATED Copper Kettle bench through the production renderer pieces.
// Run from the repository root:
//   node packages/content/src/genesis-kingdoms/masha/inn/bench/capture.mjs [--style tide|hearth|grove] [--sizes 1920x1080]
//     [--hour 19] [--time 42] [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser (waiting while other captures hold it), starts
// its own Vite dev server on a free capture port unless --base-url is given (the bench is dev-served from the web
// app's config, never shipped), waits for the bench's readiness, fails on any page, console or shader error and
// stops only what it started.
// Output: shots/genesis/masha/inn-bench[-<style>][-<hour>]@<w>x<h>.png and inn-bench-stats.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sizes = (option('--sizes') ?? '1920x1080').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const hour = Number(option('--hour') ?? 19), time = Number(option('--time') ?? 42);
const style = option('--style') ?? 'tide';
if (!['hearth', 'tide', 'grove'].includes(style)) throw new Error('Expected --style hearth|tide|grove');
if (!(hour >= 0 && hour < 24) || !(time >= 0)) throw new Error('Expected --hour in [0,24) and --time >= 0');
const out = 'shots/genesis/masha';
const page = `/@fs${fileURLToPath(new URL('./index.html', import.meta.url))}`;
const tag = `${style === 'tide' ? '' : `-${style}`}${hour === 19 ? '' : `-${hour}`}`;

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
  console.log('Waiting for the capture lock…');
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
    await tab.goto(`${base}${page}?style=${style}&hour=${hour}&time=${time}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
    await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const name = `inn-bench${tag}@${width}x${height}`, path = `${out}/${name}.png`;
    await tab.screenshot({ path, timeout: 180_000 });
    report[name] = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomInn.stats)));
    console.log(`Captured ${path}`);
    await tab.close();
  }
  await writeFile(`${out}/inn-bench-stats.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
