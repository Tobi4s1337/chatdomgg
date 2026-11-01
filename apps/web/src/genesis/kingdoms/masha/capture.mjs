// Captures MashaD4's potential kingdom through the production kingdom route, and its Atlas door.
// Run from the repository root:
//   node apps/web/src/genesis/kingdoms/masha/capture.mjs [--view hero|atlas] [--sizes 1920x1080,1440x900] [--hour 19.1]
//     [--time 40] [--query k=v&k2=v2] [--tag name] [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on a free
// capture port unless --base-url is given, answers the adopted-land manifest with the realm's own "no adopted
// record" reply (this kingdom has not been founded), waits for the page's readiness, fails on page or shader
// errors, and stops only what it started. Output: shots/genesis/masha/<view>[-tag]@<w>x<h>.png.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { URLSearchParams } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const ID = '154972160';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sizes = (option('--sizes') ?? '1920x1080').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const view = option('--view') ?? 'hero';
if (!['hero', 'atlas'].includes(view)) throw new Error('Expected --view hero|atlas');
const hour = option('--hour'), time = option('--time') ?? '40', extra = option('--query') ?? '';
const tag = option('--tag') ? `-${option('--tag')}` : '';
const out = 'shots/genesis/masha';

async function startServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
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
  if (!base) ({ server, base } = await startServer());
  console.log(`Serving ${base}${server ? ' (started here)' : ''}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const [width, height] of sizes) {
    const tab = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|status of 50\d/.test(message.text())) errors.push(message.text()); });
    // Unfounded land: the realm answers that no adopted record exists for this broadcaster.
    await tab.route(`**/api/realm/founded/${ID}**`, route => route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ version: 1, status: 'unavailable', message: 'No adopted kingdom exists for this channel.' }) }));
    const params = new URLSearchParams(extra);
    if (hour) params.set('hour', hour);
    params.set('time', time);
    if (view === 'atlas') {
      await tab.goto(`${base}/map?${params}`);
      await tab.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 600_000 });
      // The door: MashaD4's own mark, opened to its card with the way into its land. A city is not drawn at the
      // whole-map distance, so find its holding in the survey and zoom in about it until its shield is drawn.
      const canvas = await tab.locator('canvas').first().boundingBox();
      const holding = await tab.evaluate(async id => {
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
      if (!holding) throw new Error('MashaD4 is not in the current survey.');
      const drawn = () => tab.evaluate(id => window.__chatdomAtlas?.marks(5000).find(item => item.id === id) ?? null, ID);
      let mark = await drawn();
      for (let step = 0; !mark && step < 16; step++) {
        const camera = await tab.evaluate(() => window.__chatdomAtlas?.stats()?.camera ?? null);
        if (!camera) throw new Error('The Atlas camera is not readable.');
        const at = { x: (holding.x - camera.x) * camera.scale + canvas.width / 2, y: (holding.y - camera.y) * camera.scale + canvas.height / 2 };
        await tab.mouse.move(canvas.x + at.x, canvas.y + at.y);
        await tab.mouse.wheel(0, -240);
        await tab.waitForTimeout(1200);
        mark = await drawn();
      }
      if (!mark) throw new Error('MashaD4 is not drawn on the Atlas, even close in.');
      await tab.mouse.click((canvas?.x ?? 0) + mark.x, (canvas?.y ?? 0) + mark.y);
      await tab.locator('a.atlas-watch[href^="/kingdom/"]').waitFor({ timeout: 60_000 });
      report[`${width}x${height}`] = { mark, door: await tab.locator('a.atlas-watch[href^="/kingdom/"]').getAttribute('href') };
      await tab.waitForTimeout(1500);
    } else {
      await tab.goto(`${base}/kingdom/${ID}?${params}`);
      // Poll from here, so a page error ends the wait at once instead of after the timeout.
      for (const started = Date.now(); ;) {
        if (errors.length) throw new Error(`Page errors:\n${errors.join('\n')}`);
        if (await tab.evaluate(() => window.__chatdomReady === true || !!document.querySelector('.genesis-wait h1')?.textContent?.includes('moment'))) break;
        if (Date.now() - started > 900_000) throw new Error('The kingdom did not become ready.');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      const failed = await tab.evaluate(() => document.querySelector('.genesis-wait')?.textContent ?? null);
      if (failed) throw new Error(`Kingdom failed: ${failed}`);
      report[`${width}x${height}`] = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomKingdom?.stats ?? null)));
    }
    if (errors.length) throw new Error(`Page errors:\n${errors.join('\n')}`);
    await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const path = `${out}/${view}${tag}@${width}x${height}.png`;
    await tab.screenshot({ path, timeout: 300_000 });
    console.log(`Captured ${path}`);
    await tab.close();
  }
  await writeFile(`${out}/${view}${tag}-report.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
