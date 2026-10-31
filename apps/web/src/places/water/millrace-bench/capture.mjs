// Millrace evidence from the SIMULATED fixture bench, through the production renderer pieces.
// Run from the repository root:
//   node apps/web/src/places/water/millrace-bench/capture.mjs [--only mill-wheel,bridge-pond] [--hours dusk]
//     [--sizes 1440x900,390x844] [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on a free port
// in 5170–5199 unless --base-url is given (the bench is dev-served, never shipped), waits for the bench's readiness,
// fails on any page, console or shader error, captures serially and stops only what it started.
// Outputs: shots/places-water/millrace/<view>-<hour>@<w>x<h>.png and stats.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HOURS = { noon: 12, afternoon: 16, dusk: 19.5, night: 23 };
const VIEWS = ['mill-wheel', 'bridge-pond'];
const views = (option('--only') ?? VIEWS.join(',')).split(',');
if (views.some(view => !VIEWS.includes(view))) throw new Error(`Expected --only from ${VIEWS.join(',')}`);
const hours = (option('--hours') ?? 'dusk').split(',');
if (hours.some(hour => !(hour in HOURS))) throw new Error('Expected --hours from noon,afternoon,dusk,night');
const sizes = (option('--sizes') ?? '1440x900,390x844').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const out = 'shots/places-water/millrace';
const page = 'src/places/water/millrace-bench/index.html';

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
  for (const [width, height] of sizes) {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await tab.goto(`${base}/${page}?view=${views[0]}&hour=${HOURS[hours[0]]}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure) throw new Error(`Bench failed: ${failure}\n${errors.join('\n')}`);
    for (const label of hours) for (const view of views) {
      await tab.evaluate(([name, hour]) => { window.__chatdomMillrace.view(name); window.__chatdomMillrace.hour(hour); }, [view, HOURS[label]]);
      await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      if (errors.length) throw new Error(errors.join('\n'));
      const path = `${out}/${view}-${label}@${width}x${height}.png`;
      await tab.screenshot({ path, timeout: 180_000 });
      report[`${view}-${label}@${width}x${height}`] = await tab.evaluate(() => ({ ...window.__chatdomMillrace.stats }));
      console.log(`Captured ${path}`);
    }
    await tab.close();
  }
  await writeFile(`${out}/stats.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
