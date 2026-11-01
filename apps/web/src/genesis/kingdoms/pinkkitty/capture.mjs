/* global requestAnimationFrame */
// Captures PinkKittyRose's river town in the real kingdom route, and its door from the Atlas.
// Run from the repository root:
//   node apps/web/src/genesis/kingdoms/pinkkitty/capture.mjs [--views hero,market,tavern,atlas] [--hour 19.25] [--tag after]
// It takes the machine-wide capture lock for each still and releases it in between, starts its own Vite dev server on a free capture port (never 5187 or
// 5190–5197), and fails on any page or console error. The adopted-land service is not part of this capture: its
// manifest request is answered in the browser with the realm's own "no adopted record" reply (HTTP 404), which is
// exactly what an unfounded channel receives, so the page opens the potential kingdom, labelled unfounded land and
// SIMULATED. The Atlas reads the running Surveyor's map data through the app's own proxy, read only.
// Output: shots/genesis/pinkkitty/<tag>-<view>@1920x1080.png.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const ID = '4363967';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const views = (option('--views') ?? 'hero,atlas').split(',');
const hour = option('--hour');
const tag = option('--tag') ?? 'after';
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
const out = 'shots/genesis/pinkkitty';
const PORTS = CAPTURE_PORTS.filter(port => (port >= 5170 && port <= 5186) || port === 5188 || port === 5189);

/** Close views, as camera poses in world metres: [eye, target, fov]. */
const POSES = {
  // Bell Court from above the glass screen's shoulder: statue, stair, standards and the hall beyond.
  market: [[-18, 19, -22], [-52, 8, 14], 48],
  // The Lantern and Oar on the levee, from the meadow south-east of it: the terrace, the landing and the flight
  // down to Millwater Lane, the jetty and the river behind.
  tavern: [[-66, 17, 34], [-96, 8, 58], 46],
};

async function start() {
  for (const port of PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

const UNADOPTED = { version: 1, status: 'unavailable', message: 'No adopted record exists for this kingdom.' };

async function kingdomReady(page) {
  await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldSettled
    || !!document.querySelector('.genesis-wait h1')?.textContent?.includes('moment'), null, { timeout: 600_000 });
  const wait = await page.locator('.genesis-wait').count();
  if (wait) throw new Error(`Genesis wait: ${await page.locator('.genesis-wait').innerText()}`);
  await page.evaluate(() => document.fonts.ready);
}
const frames = (page, n = 30) => page.evaluate(n => new Promise(resolve => { let i = 0; const step = () => (++i >= n ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); }), n);

let server, browser, release;
try {
  const started = await start();
  server = started.server;
  console.log(`Serving ${started.base} (started here)`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const view of views) {
    // One still per hold of the shared capture lock, released in between so others can capture between our frames.
    release = await acquireCaptureLock();
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console: ${message.text()}`); });
    await page.route(`**/api/realm/founded/${ID}`, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(UNADOPTED) }));
    const query = hour ? `?hour=${hour}` : '';
    if (view === 'atlas') {
      await page.goto(`${started.base}/map`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true && document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-state') === 'ready', null, { timeout: 300_000 });
      const mark = await page.evaluate(id => window.__chatdomAtlas.marks(100000).find(item => item.id === id), ID);
      if (!mark) throw new Error('PinkKittyRose has no drawn mark on the Atlas at its opening view.');
      await page.mouse.click(mark.x, mark.y);
      const door = page.locator('.atlas-card a[href="/kingdom/4363967"]');
      await door.waitFor({ timeout: 30_000 });
      await frames(page, 60);
      await page.screenshot({ path: `${out}/${tag}-atlas-card@${width}x${height}.png`, timeout: 180_000 });
      console.log(`Captured ${out}/${tag}-atlas-card@${width}x${height}.png`);
      await door.click();
      await page.waitForURL(`**/kingdom/${ID}**`);
      await kingdomReady(page);
      await frames(page);
      await page.screenshot({ path: `${out}/${tag}-atlas-door@${width}x${height}.png`, timeout: 180_000 });
      console.log(`Captured ${out}/${tag}-atlas-door@${width}x${height}.png`);
    } else {
      await page.goto(`${started.base}/kingdom/${ID}${query}`, { waitUntil: 'domcontentloaded' });
      await kingdomReady(page);
      const pose = POSES[view] ?? (view.startsWith('pose:') ? JSON.parse(view.slice(5)) : null);
      if (pose) {
        await page.evaluate(([eye, target, fov]) => window.__chatdomKingdom.pose(eye, target, fov), pose);
        await frames(page, 20);
        await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 300_000 });
      }
      await frames(page);
      const name = view.startsWith('pose:') ? `pose-${views.indexOf(view)}` : view;
      await page.screenshot({ path: `${out}/${tag}-${name}@${width}x${height}.png`, timeout: 180_000 });
      console.log(`Captured ${out}/${tag}-${name}@${width}x${height}.png`, JSON.stringify(await page.evaluate(() => {
        const s = window.__chatdomKingdom.stats; return { source: s.source, citizens: s.citizens, activeWindows: s.activeWindows };
      })));
    }
    await page.close();
    await release();
    release = undefined;
    if (errors.length) throw new Error(`Errors on ${view}:\n${errors.join('\n')}`);
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
