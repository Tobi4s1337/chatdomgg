// Water life evidence from the SIMULATED fixture bench, through the production renderer pieces.
// Run from the repository root:
//   node apps/web/src/places/water/life-bench/capture.mjs [--only bridge-pond,mill-wheel,lake] [--hours dusk]
//     [--sizes 1440x900] [--time 30] [--people 2] [--look ex,ey,ez,tx,ty,tz] [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on a free
// capture port unless --base-url is given (the bench is dev-served, never shipped), waits for the bench's
// readiness, fails on any page, console or shader error, captures serially and stops only what it started.
// Each view also proves seeking: the frame at --time, then 70 s later, then --time again must hash identically.
// Outputs: shots/places-water/life/<view>-<hour>-p<people>@<w>x<h>.png and stats.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HOURS = { noon: 12.5, dusk: 20.5, night: 22.5 };
const VIEWS = ['bridge-pond', 'mill-wheel', 'lake'];
const list = (name, fallback, allowed) => {
  const values = (option(name) ?? fallback).split(',');
  if (values.some(value => !allowed.includes(value))) throw new Error(`Expected ${name} from ${allowed.join(',')}`);
  return values;
};
const views = list('--only', VIEWS.join(','), VIEWS);
const hours = list('--hours', 'dusk', Object.keys(HOURS));
const sizes = (option('--sizes') ?? '1440x900').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const time = Number(option('--time') ?? 30), people = Number(option('--people') ?? 2);
if (!Number.isFinite(time) || time < 0) throw new Error('Expected --time as non-negative seconds');
if (!Number.isInteger(people) || people < 0 || people > 6) throw new Error('Expected --people from 0 to 6');
const look = option('--look');
const out = 'shots/places-water/life';
const page = 'src/places/water/life-bench/index.html';

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
    await tab.goto(`${base}/${page}?view=${view}&hour=${HOURS[hours[0]]}&time=${time}&people=${people}${look ? `&look=${look}` : ''}`);
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await tab.evaluate(() => document.body.dataset.error);
    if (failure) throw new Error(`Bench failed: ${failure}\n${errors.join('\n')}`);
    for (const label of hours) {
      await tab.evaluate(hour => window.__chatdomLife.hour(hour), HOURS[label]);
      // Seek: the frame at `time`, a frame 70 s on, then `time` again must be the same pixels.
      const seek = await tab.evaluate(async t => {
        const api = window.__chatdomLife;
        api.time(t); const first = await api.frameHash();
        api.time(t + 70); const later = await api.frameHash();
        api.time(t); const back = await api.frameHash();
        return { first, later, back };
      }, time);
      if (seek.first !== seek.back) throw new Error(`${view} ${label}: seeking back did not reproduce the frame (${seek.first} vs ${seek.back})`);
      if (seek.first === seek.later) throw new Error(`${view} ${label}: the frame 70 s later is identical; nothing moved`);
      await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      if (errors.length) throw new Error(errors.join('\n'));
      const name = `${view}-${label}-p${people}${look ? '-look' : ''}@${width}x${height}`, path = `${out}/${name}.png`;
      await tab.screenshot({ path, timeout: 180_000 });
      report[name] = { seek, stats: await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomLife.stats))) };
      console.log(`Captured ${path} (seek-back identical)`);
    }
    await tab.close();
  }
  await writeFile(`${out}/stats.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
