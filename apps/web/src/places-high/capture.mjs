/* global URLSearchParams:readonly */
// Captures the place bench with Chrome/SwiftShader, one page per view and size, serially, under the host capture lock.
//   node apps/web/src/places-high/capture.mjs [--only court-arrive,court-town] [--size desktop|phone]
//     [--hour 18.5] [--time 30] [--occupied 1|0] [--tier town|hamlet] [--base-url http://127.0.0.1:5190]
// Without --base-url it serves apps/web from its own Vite dev server on the first free port in 5170–5199 and stops
// only that server. Shots go to shots/places-high/<view>-h<hour>[-empty]@<w>x<h>.png with capture-stats.json.
// Console errors, page errors, shader failures, a bench error or a report that disagrees with the request fail it.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const BUILT = ['court-arrive', 'court-town'];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const BENCH = '/src/places-high/bench/index.html';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const views = (option('--only') ?? BUILT.join(',')).split(',');
const sizes = option('--size') ? [option('--size')] : Object.keys(SIZES);
const hour = option('--hour') ?? '18.5', time = option('--time') ?? '30', occupied = option('--occupied') ?? '1', tier = option('--tier') ?? 'town';
for (const view of views) if (!BUILT.includes(view)) throw new Error(`Unknown or unbuilt view ${view}. Choose ${BUILT.join(', ')}.`);
for (const size of sizes) if (!SIZES[size]) throw new Error(`Unknown --size ${size}. Choose ${Object.keys(SIZES).join(', ')}.`);
if (!/^(?:1?\d|2[0-3])(?:\.\d{1,2})?$/.test(hour)) throw new Error('--hour must be 0 to 23.99.');
if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(time)) throw new Error('--time must be seconds from 0.');
if (occupied !== '0' && occupied !== '1') throw new Error('--occupied must be 1 or 0.');
if (tier !== 'town' && tier !== 'hamlet') throw new Error('--tier must be town or hamlet.');

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const out = `${root}shots/places-high`;

async function serve() {
  for (let port = 5170; port <= 5199; port++) {
    const server = await createServer({
      root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', clearScreen: false,
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
      // Crawl the bench up front, so dependency optimisation never reloads a page mid-capture.
      optimizeDeps: { entries: [BENCH.slice(1)] },
    });
    try {
      await server.listen();
      console.log(`[places-high] dev server on port ${port}`);
      return { server, base: `http://127.0.0.1:${port}` };
    } catch (error) {
      await server.close();
      if (error?.code !== 'EADDRINUSE' && !/already in use/i.test(String(error?.message))) throw error;
    }
  }
  throw new Error('No free port in 5170–5199 for the place bench.');
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await serve());
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const taken = [];
  for (const view of views) for (const size of sizes) {
    const [width, height] = SIZES[size];
    const query = { place: 'court', view, hour, time, occupied, tier };
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || /THREE\.WebGLProgram/.test(message.text())) errors.push(`${message.text()} ${message.location().url}`); });
    const started = Date.now();
    await page.goto(`${base}${BENCH}?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomPlacesError === 'string', {}, { timeout: 900_000 });
    const failure = await page.evaluate(() => window.__chatdomPlacesError);
    if (failure) throw new Error(`${view}@${width}x${height}: ${failure}`);
    if (errors.length) throw new Error(`${view}@${width}x${height}:\n${errors.join('\n')}`);
    const report = await page.evaluate(() => window.__chatdomPlaces);
    if (!report || report.view !== view || report.hour !== Number(hour) || report.time !== Number(time) || report.occupied !== (occupied === '1') || report.tier !== tier) {
      throw new Error(`${view}@${width}x${height}: the bench reported a different state.`);
    }
    if (report.width !== width || report.height !== height || !(report.triangles > 0) || !report.pieces.includes('court:well')) throw new Error(`${view}@${width}x${height}: wrong viewport or an empty court.`);
    const name = `${view}-h${hour}${occupied === '1' ? '' : '-empty'}${tier === 'town' ? '' : `-${tier}`}@${width}x${height}.png`;
    await page.screenshot({ path: `${out}/${name}`, timeout: 180_000 });
    await page.close();
    const seconds = Math.round((Date.now() - started) / 1000);
    taken.push({ path: `shots/places-high/${name}`, seconds, ...report });
    console.log(`[places-high] shots/places-high/${name} · ${report.triangles} triangles · ${report.draws} draws · meshes ${report.meshMs} ms, terrain ${report.terrainMs} ms · ${seconds} s`);
  }
  await writeFile(`${out}/capture-stats.json`, JSON.stringify(taken, null, 2) + '\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await server?.close(); } finally { await release?.(); }
  }
}
