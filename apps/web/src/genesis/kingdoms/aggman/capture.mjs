/* global requestAnimationFrame, AbortController, clearTimeout */
// Captures The_AGGman's harbour hamlet in the real kingdom route, and its door from the Atlas.
// Run from the repository root:
//   node apps/web/src/genesis/kingdoms/aggman/capture.mjs [--views hero,quay,light,atlas] [--hour 19.6] [--tag after]
// The kingdom views share one loaded page, posed in turn; the page loads before the lock is taken. With no --hour the route opens at the hamlet's own hour,
// exactly as a visitor arrives. It takes the machine-wide capture lock for each still and releases it in between, starts its own Vite dev server on a free capture port (never 5187 or
// 5190–5197), and fails on any page or console error. The adopted-land service is not part of this capture: its
// manifest request is answered in the browser with the realm's own "no adopted record" reply (HTTP 404), which is
// exactly what an unfounded channel receives, so the page opens the potential kingdom, labelled unfounded land and
// SIMULATED. The Atlas reads the running Surveyor's map data through the app's own proxy, read only.
// Output: shots/genesis/aggman/<tag>-<view>@1920x1080.png.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const ID = '63920635';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const views = (option('--views') ?? 'hero,atlas').split(',');
// Absent, the per-kingdom registry opens the hamlet at its own dusk (AGGMAN_HOUR).
const hour = option('--hour');
const tag = option('--tag') ?? 'after';
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
const out = 'shots/genesis/aggman';
const PORTS = CAPTURE_PORTS.filter(port => (port >= 5170 && port <= 5186) || port === 5188 || port === 5189);

/** Close views, as camera poses in world metres: [eye, target, fov]. */
const POSES = {
  // The hero view as it stood before the shingle and the lower, nearer hero camera.
  'hero-v1': [[120, 23, -214.75], [52, 9, -132.25], 44],
  // The quay from the water off the pier head: the statue, the stair, the stall and the inn behind.
  quay: [[82, 9, -186], [60, 4, -150], 46],
  // The Last Lantern from the west shingle: the lit window, the boats drawn up, the geese on the stones.
  light: [[22, 7, -178], [50, 7, -160], 48],
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

/**
 * The shared lock, queued for in short turns: the host's capture guard measures a hold from when the lock's
 * supervisor started, queue time included, so a fresh supervisor is queued every three minutes. A lane supervisor
 * polls either way, so the order others are admitted in is unchanged.
 */
async function takeLock() {
  for (;;) {
    const turn = new AbortController(), timer = setTimeout(() => turn.abort(new Error('requeue')), 180_000);
    try { return await acquireCaptureLock({ signal: turn.signal }); }
    catch (error) { if (!turn.signal.aborted) throw error; }
    finally { clearTimeout(timer); }
  }
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
  const watch = page => {
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console: ${message.text()}`); });
    return errors;
  };
  const check = (errors, view) => { if (errors.length) throw new Error(`Errors on ${view}:\n${errors.join('\n')}`); };
  const unadopted = page => page.route(`**/api/realm/founded/${ID}`, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(UNADOPTED) }));
  const query = hour ? `?hour=${hour}` : '';
  let kingdom, kingdomErrors = [];
  for (const view of views) {
    if (view !== 'atlas' && !kingdom) {
      // Loading and settling the kingdom is not a capture: it runs before the lock is taken, so a hold lasts only
      // one pose, its settle and its screenshot.
      kingdom = await browser.newPage({ viewport: { width, height } });
      kingdomErrors = watch(kingdom);
      await unadopted(kingdom);
      await kingdom.goto(`${started.base}/kingdom/${ID}${query}`, { waitUntil: 'domcontentloaded' });
      await kingdomReady(kingdom);
      console.log('Opened at', await kingdom.evaluate(() => window.location.search));
    }
    if (view !== 'atlas') {
      // Pose and settle before the lock: the hold is a few frames and one screenshot.
      // The hero view is the kingdom's own opening camera, so it is only true before any pose moves it.
      if (view === 'hero' && views.indexOf('hero') !== views.findIndex(item => item !== 'atlas')) throw new Error('Capture the hero view before any posed view.');
      const pose = POSES[view] ?? (view.startsWith('pose:') ? JSON.parse(view.slice(5)) : null);
      if (pose) {
        await kingdom.evaluate(([eye, target, fov]) => window.__chatdomKingdom.pose(eye, target, fov), pose);
        await frames(kingdom, 20);
        await kingdom.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 600_000 });
      }
      await frames(kingdom, 20);
    }
    // One still per hold of the shared capture lock, released in between so others can capture between our frames.
    if (view === 'atlas') {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = watch(page);
      await unadopted(page);
      await page.goto(`${started.base}/map`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true && document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-state') === 'ready', null, { timeout: 300_000 });
      // A hamlet is not drawn at the whole-map distance: find its holding in the survey and zoom in about it until
      // its mark is drawn, as a visitor scrolling toward it would.
      const canvas = await page.locator('canvas').first().boundingBox();
      const holding = await page.evaluate(async id => {
        const read = async url => (await fetch(url)).json();
        const pointer = await read('/map-data/v1/preview');
        const world = await read(`/map-data/v1/preview/${pointer.id}/world.json`);
        const find = columns => { const i = columns.ids.indexOf(id); return i < 0 ? null : { x: columns.x[i] / world.coordScale, y: columns.y[i] / world.coordScale }; };
        let found = find(world.head);
        for (const region of world.regions) {
          if (found) break;
          found = find((await read(`/map-data/v1/preview/${world.id}/${region.chunk.path}`)).settlers);
        }
        return found;
      }, ID);
      if (!holding) throw new Error('The_AGGman is not in the current survey.');
      const drawn = () => page.evaluate(id => window.__chatdomAtlas?.marks(5000).find(item => item.id === id) ?? null, ID);
      let mark = await drawn();
      for (let step = 0; !mark && step < 20; step++) {
        const camera = await page.evaluate(() => window.__chatdomAtlas?.stats()?.camera ?? null);
        if (!camera) throw new Error('The Atlas camera is not readable.');
        const at = { x: (holding.x - camera.x) * camera.scale + canvas.width / 2, y: (holding.y - camera.y) * camera.scale + canvas.height / 2 };
        await page.mouse.move(canvas.x + at.x, canvas.y + at.y);
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(1200);
        mark = await drawn();
      }
      if (!mark) throw new Error('The_AGGman is not drawn on the Atlas, even close in.');
      await page.mouse.click(canvas.x + mark.x, canvas.y + mark.y);
      const door = page.locator(`a[href="/kingdom/${ID}"]`).first();
      await door.waitFor({ timeout: 30_000 });
      await frames(page, 60);
      release = await takeLock();
      await page.screenshot({ path: `${out}/${tag}-atlas-card@${width}x${height}.png`, timeout: 180_000 });
      console.log(`Captured ${out}/${tag}-atlas-card@${width}x${height}.png`);
      await release();
      release = undefined;
      await door.click();
      await page.waitForURL(`**/kingdom/${ID}**`);
      await kingdomReady(page);
      await frames(page);
      release = await takeLock();
      await frames(page, 4);
      await page.screenshot({ path: `${out}/${tag}-atlas-door@${width}x${height}.png`, timeout: 180_000 });
      console.log(`Captured ${out}/${tag}-atlas-door@${width}x${height}.png`);
      await page.close();
      check(errors, view);
    } else {
      const page = kingdom;
      release = await takeLock();
      await frames(page, 4);
      const name = view.startsWith('pose:') ? `pose-${views.indexOf(view)}` : view;
      await page.screenshot({ path: `${out}/${tag}-${name}@${width}x${height}.png`, timeout: 180_000 });
      console.log(`Captured ${out}/${tag}-${name}@${width}x${height}.png`, JSON.stringify(await page.evaluate(() => {
        const s = window.__chatdomKingdom.stats; return { source: s.source, citizens: s.citizens, activeWindows: s.activeWindows };
      })));
      check(kingdomErrors, view);
    }
    await release();
    release = undefined;
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
