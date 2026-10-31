/* global URLSearchParams:readonly */
// Captures the anvil art bench with Chrome/SwiftShader from a temporary Vite dev server.
// node apps/web/src/forge/anvil-hero/capture.mjs [--view anvil-close,dragon-square] [--style hearth|tide|grove]
//   [--size desktop|phone] [--hour 19] [--sheet | --no-sheet] [--sheet-width 1440] [--base-url http://127.0.0.1:5170]
// Shots go to shots/anvil-hero/. The server takes the first free port in 5170–5199 and is the only one stopped.
// The dragon contact sheet (three kits, four angles, colour and greyscale) is taken with every full run, or alone with --sheet.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const BUILT = ['anvil-close', 'anvil-square', 'dragon-close', 'dragon-square'];
const STYLES = ['hearth', 'tide', 'grove'];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const BENCH = '/src/forge/anvil-hero/bench/index.html';
const SHEET = '/src/forge/anvil-hero/bench/sheet.html';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sheetOnly = args.includes('--sheet');
const views = sheetOnly ? [] : (option('--view') ?? BUILT.join(',')).split(',');
const sheet = sheetOnly || (!option('--view') && !args.includes('--no-sheet'));
const sheetWidth = option('--sheet-width') ?? '1440';
const style = option('--style') ?? 'hearth';
const sizes = option('--size') ? [option('--size')] : Object.keys(SIZES);
const hour = option('--hour') ?? '19';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const out = `${root}shots/anvil-hero`;

for (const view of views) if (!BUILT.includes(view)) throw new Error(`Unknown or unbuilt --view ${view}. Choose ${BUILT.join(', ')}.`);
if (args.includes('--heat')) throw new Error('The heated anvil is not carved yet.');
if (!STYLES.includes(style)) throw new Error(`Unknown --style ${style}. Choose ${STYLES.join(', ')}.`);
for (const size of sizes) if (!SIZES[size]) throw new Error(`Unknown --size ${size}. Choose ${Object.keys(SIZES).join(', ')}.`);
if (!/^(?:1?\d|2[0-3])$/.test(hour)) throw new Error('--hour must be a whole hour 0..23.');
if (!/^\d{3,4}$/.test(sheetWidth) || Number(sheetWidth) < 960 || Number(sheetWidth) > 2880) throw new Error('--sheet-width must be 960..2880 pixels.');

/** One page load per viewpoint and size. The heated close view is the one extra state. */
function plan() {
  const shots = [];
  for (const view of views) for (const size of sizes) shots.push({ name: `${view}-${style}-h${hour}`, size: SIZES[size], query: { view, style, hour } });
  return shots;
}

async function startServer() {
  for (let port = 5170; port <= 5199; port++) {
    const server = await createServer({
      root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', clearScreen: false,
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
      // Crawl the bench up front, so dependency optimisation never reloads a page mid-capture.
      optimizeDeps: { entries: [BENCH.slice(1), SHEET.slice(1)] },
    });
    try {
      await server.listen();
      console.log(`[anvil-hero] dev server on port ${port}`);
      return { server, base: `http://127.0.0.1:${port}` };
    } catch (error) {
      await server.close();
      if (error?.code !== 'EADDRINUSE' && !/already in use/i.test(String(error?.message))) throw error;
    }
  }
  throw new Error('No free port in 5170–5199 for the anvil bench.');
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startServer());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  const taken = [];
  for (const shot of plan()) {
    const [width, height] = shot.size;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await page.goto(`${base}${BENCH}?${new URLSearchParams(shot.query)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomAnvilHeroError === 'string', {}, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomAnvilHeroError);
    if (failure) throw new Error(`${shot.name}: ${failure}`);
    if (errors.length) throw new Error(`${shot.name}: ${errors.join('\n')}`);
    const measured = await page.evaluate(() => window.__chatdomAnvilHero);
    const q = shot.query;
    if (!measured || measured.view !== q.view || measured.style !== q.style || measured.hour !== Number(q.hour) || measured.heat !== Number(q.heat ?? 0)) throw new Error(`${shot.name}: the bench reported a different state.`);
    if (measured.width !== width || measured.height !== height || !(measured.heroTriangles > 0)) throw new Error(`${shot.name}: wrong viewport or an empty anvil.`);
    const path = `${out}/${shot.name}@${width}x${height}.png`;
    await page.screenshot({ path });
    await page.close();
    taken.push({ path: path.slice(root.length), ...measured });
    console.log(`[anvil-hero] ${path.slice(root.length)} · anvil ${measured.heroTriangles} triangles, cast ${measured.heroCastMs} ms · camera ${measured.cameraDistance} m · ${measured.draws} draws${measured.dragon ? ` · dragon ${measured.dragon.boxes} boxes, seen from the ${measured.dragon.side}` : ''}`);
  }
  if (sheet) {
    const page = await browser.newPage({ viewport: { width: Number(sheetWidth), height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await page.goto(`${base}${SHEET}?${new URLSearchParams({ hour })}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomAnvilHeroError === 'string', {}, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomAnvilHeroError);
    if (failure) throw new Error(`dragon sheet: ${failure}`);
    if (errors.length) throw new Error(`dragon sheet: ${errors.join('\n')}`);
    const measured = await page.evaluate(() => window.__chatdomAnvilHeroSheet);
    if (!measured || measured.hour !== Number(hour) || STYLES.some(s => !(measured.triangles[s] > 0))) throw new Error('dragon sheet: an empty or stale dragon.');
    const path = `${out}/dragon-sheet-h${hour}@${sheetWidth}.png`, grey = `${out}/dragon-sheet-h${hour}-grey@${sheetWidth}.png`;
    await page.screenshot({ path, fullPage: true });
    await page.close();
    // The same pixels without colour: the silhouettes and value steps must hold on their own.
    await new Promise((resolve, reject) => execFile('ffmpeg', ['-loglevel', 'error', '-y', '-i', path, '-vf', 'format=gray', grey], error => error ? reject(error) : resolve()));
    taken.push({ path: path.slice(root.length), grey: grey.slice(root.length), ...measured });
    console.log(`[anvil-hero] ${path.slice(root.length)} and ${grey.slice(root.length)} · dragon triangles ${STYLES.map(s => `${s} ${measured.triangles[s]}`).join(', ')} · boxes ${STYLES.map(s => `${s} ${measured.boxes[s]}`).join(', ')}`);
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
