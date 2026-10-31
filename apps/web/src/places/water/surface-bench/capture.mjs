// Water surface evidence from the SIMULATED fixture bench, through the production renderer pieces.
// Run from the repository root:
//   node apps/web/src/places/water/surface-bench/capture.mjs [--only lake-postcard,bridge-pond] [--hours night]
//     [--qualities full,reduced] [--sizes 1440x900] [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on a free
// capture port unless --base-url is given (the bench is dev-served, never shipped), waits for the bench's
// readiness, fails on any page, console or shader error, captures serially and stops only what it started.
// Outputs: shots/places-water/surface/<view>-<hour>-<quality>@<w>x<h>.png, a full-vs-reduced pair per view and
// size when both qualities are taken, and stats.json with the water's pass, draw, pillar and byte diagnostics.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HOURS = { noon: 12, dusk: 19.5, night: 23 };
const VIEWS = ['lake-postcard', 'bridge-pond'];
const QUALITIES = ['full', 'reduced'];
const list = (name, fallback, allowed) => {
  const values = (option(name) ?? fallback).split(',');
  if (values.some(value => !allowed.includes(value))) throw new Error(`Expected ${name} from ${allowed.join(',')}`);
  return values;
};
const views = list('--only', VIEWS.join(','), VIEWS);
const hours = list('--hours', 'night', Object.keys(HOURS));
const qualities = list('--qualities', QUALITIES.join(','), QUALITIES);
const sizes = (option('--sizes') ?? '1440x900').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const out = 'shots/places-water/surface';
const page = 'src/places/water/surface-bench/index.html';

async function startBenchServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      optimizeDeps: { entries: [page] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
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
  for (const [width, height] of sizes) for (const view of views) {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await tab.goto(`${base}/${page}?view=${view}&hour=${HOURS[hours[0]]}&quality=${qualities[0]}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure) throw new Error(`Bench failed: ${failure}\n${errors.join('\n')}`);
    for (const label of hours) {
      for (const quality of qualities) {
        await tab.evaluate(([hour, q]) => { window.__chatdomWater.hour(hour); window.__chatdomWater.quality(q); }, [HOURS[label], quality]);
        await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        if (errors.length) throw new Error(errors.join('\n'));
        const path = `${out}/${view}-${label}-${quality}@${width}x${height}.png`;
        await tab.screenshot({ path, timeout: 180_000 });
        report[`${view}-${label}-${quality}@${width}x${height}`] = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomWater.stats)));
        console.log(`Captured ${path}`);
      }
      if (qualities.length === 2) {
        const pair = `${out}/${view}-${label}-full-vs-reduced@${width}x${height}.png`;
        const [a, b] = qualities.map(q => `${out}/${view}-${label}-${q}@${width}x${height}.png`);
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', width >= height ? 'vstack' : 'hstack', pair]);
        console.log(`Composed ${pair}`);
      }
    }
    await tab.close();
  }
  await writeFile(`${out}/stats.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
