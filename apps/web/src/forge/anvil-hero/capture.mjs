/* global URLSearchParams:readonly, Buffer:readonly */
// Captures the anvil art bench with Chrome/SwiftShader from a temporary Vite dev server.
// node apps/web/src/forge/anvil-hero/capture.mjs [--view anvil-close,anvil-mark] [--style hearth|tide|grove]
//   [--size desktop|phone] [--hour 19] [--heat 0..1 [--shaping] [--time s]] [--sheet | --no-sheet] [--sheet-width 1440]
//   [--anvil] [--base-url http://127.0.0.1:5170]
// Shots go to shots/anvil-hero/. The server takes the first free port in 5170–5199 and is the only one stopped.
// A full run takes the four primary views cold at both sizes, the close anvil at pour heat at both sizes, the
// cheek face on (cold and at pour) with its comparison against the official SVG, and the dragon contact sheet
// (three kits, four angles, colour and greyscale). Every anvil-mark shot also writes its SVG comparison.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const PRIMARY = ['anvil-close', 'anvil-square', 'dragon-close', 'dragon-square'];
const BUILT = [...PRIMARY, 'anvil-mark'];
/** Pour: every rune lit and steady, the face's arrises warm. The close views' heated state. */
const POUR = { heat: '0.85', time: '1.3' };
const STYLES = ['hearth', 'tide', 'grove'];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const BENCH = '/src/forge/anvil-hero/bench/index.html';
const SHEET = '/src/forge/anvil-hero/bench/sheet.html';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const sheetOnly = args.includes('--sheet');
// --anvil: only what the anvil changes (both anvil views, the heated close view and the mark comparisons).
const anvilOnly = args.includes('--anvil');
const full = !sheetOnly && !option('--view');
const views = sheetOnly ? [] : (option('--view') ?? (anvilOnly ? 'anvil-close,anvil-square' : PRIMARY.join(','))).split(',');
const sheet = sheetOnly || (!option('--view') && !anvilOnly && !args.includes('--no-sheet'));
const sheetWidth = option('--sheet-width') ?? '1440';
const style = option('--style') ?? 'hearth';
const sizes = option('--size') ? [option('--size')] : Object.keys(SIZES);
const hour = option('--hour') ?? '19';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const out = `${root}shots/anvil-hero`;

for (const view of views) if (!BUILT.includes(view)) throw new Error(`Unknown or unbuilt --view ${view}. Choose ${BUILT.join(', ')}.`);
const heat = option('--heat') ?? '0', time = option('--time') ?? (Number(heat) > 0 ? POUR.time : '0'), shaping = args.includes('--shaping');
if (!/^(?:[01](?:\.\d+)?|\.\d+)$/.test(heat) || Number(heat) > 1) throw new Error('--heat must be a number from 0 to 1.');
if (!/^\d{1,5}(?:\.\d+)?$/.test(time)) throw new Error('--time must be seconds from 0.');
if (!STYLES.includes(style)) throw new Error(`Unknown --style ${style}. Choose ${STYLES.join(', ')}.`);
for (const size of sizes) if (!SIZES[size]) throw new Error(`Unknown --size ${size}. Choose ${Object.keys(SIZES).join(', ')}.`);
if (!/^(?:1?\d|2[0-3])$/.test(hour)) throw new Error('--hour must be a whole hour 0..23.');
if (!/^\d{3,4}$/.test(sheetWidth) || Number(sheetWidth) < 960 || Number(sheetWidth) > 2880) throw new Error('--sheet-width must be 960..2880 pixels.');

const tag = q => `${q.view}-${q.style}-h${q.hour}${Number(q.heat) > 0 ? `-heat${q.heat}${q.shaping === '1' ? '-shaping' : ''}-t${q.time}` : ''}`;
/** One page load per viewpoint, state and size. */
function plan() {
  const shots = [], add = (query, size) => shots.push({ name: tag(query), size: SIZES[size], query });
  const state = { style, hour, heat, time, shaping: shaping ? '1' : '0' };
  for (const view of views) for (const size of sizes) add({ view, ...state }, size);
  if (full) {
    for (const size of sizes) add({ view: 'anvil-close', ...state, ...POUR }, size);
    add({ view: 'anvil-mark', ...state }, 'desktop');
    add({ view: 'anvil-mark', ...state, ...POUR }, 'desktop');
  }
  return shots;
}

const svgSource = await readFile(`${fileURLToPath(new URL('../engraving/codex.svg', import.meta.url))}`, 'utf8');
/**
 * The cheek, cropped to the official SVG's 24-unit box (plus a margin), beside the untouched SVG drawn at the
 * same size, and the two laid over each other: any redrawing, distortion or drift shows as a doubled edge.
 */
async function compareMark(browser, shotPath, shotSize, rect, name) {
  const pad = rect.width * .12, scale = 3;
  const clip = { x: rect.x - pad, y: rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad };
  const crop = (await readFile(shotPath)).toString('base64');
  const svg = `data:image/svg+xml;base64,${Buffer.from(svgSource).toString('base64')}`;
  const w = Math.round(clip.width * scale), h = Math.round(clip.height * scale), box = rect.width * scale, inset = pad * scale;
  const panel = (inner, label) => `<figure><div class="p" style="width:${w}px;height:${h}px">${inner}</div><figcaption>${label}</figcaption></figure>`;
  const shot = '<div class="crop"></div>';
  const page = await browser.newPage({ viewport: { width: 3 * w + 80, height: h + 80 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>
    body{margin:0;padding:16px;background:#1b1a20;color:#e9dcc3;font:40px Georgia,serif;display:flex;gap:16px}
    figure{margin:0}.p{position:relative;overflow:hidden}figcaption{margin-top:6px}
    .crop{position:absolute;inset:0}
    .svg{position:absolute;left:${inset}px;top:${inset}px;width:${box}px;height:${box}px}
    .paper{background:#e9e3d6}.over .svg{filter:invert(1) sepia(1) saturate(6) hue-rotate(140deg);opacity:.55}
  </style>
  ${panel(shot, 'The cheek, as rendered')}
  ${panel(`<img class="svg" src="${svg}">`, 'engraving/codex.svg, untouched').replace('class="p"', 'class="p paper"')}
  ${panel(`${shot}<img class="svg" src="${svg}">`, 'Overlaid: the SVG in cyan').replace('class="p"', 'class="p over"')}`);
  // The crop is the original shot, scaled up as one image and positioned on the SVG's box.
  await page.evaluate(({ url, clip, scale, size }) => {
    for (const el of document.querySelectorAll('.crop')) {
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${size[0] * scale}px ${size[1] * scale}px`;
      el.style.backgroundPosition = `${-clip.x * scale}px ${-clip.y * scale}px`;
    }
  }, { url: `data:image/png;base64,${crop}`, clip, scale, size: shotSize });
  const path = `${out}/${name}`;
  await page.screenshot({ path, fullPage: true, timeout: 180_000 });
  await page.close();
  return path;
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
    if (!measured || measured.view !== q.view || measured.style !== q.style || measured.hour !== Number(q.hour) || measured.heat !== Number(q.heat) || measured.time !== Number(q.time) || measured.shaping !== (q.shaping === '1')) throw new Error(`${shot.name}: the bench reported a different state.`);
    if (measured.width !== width || measured.height !== height || !(measured.heroTriangles > 0)) throw new Error(`${shot.name}: wrong viewport or an empty anvil.`);
    const path = `${out}/${shot.name}@${width}x${height}.png`;
    await page.screenshot({ path, timeout: 180_000 });
    await page.close();
    const compared = q.view === 'anvil-mark' ? await compareMark(browser, path, [width, height], measured.mark.rect, `mark-compare-${shot.name}.png`) : null;
    taken.push({ path: path.slice(root.length), ...measured, ...(compared ? { compared: compared.slice(root.length) } : {}) });
    console.log(`[anvil-hero] ${path.slice(root.length)} · anvil ${measured.heroTriangles} triangles, cast ${measured.heroCastMs} ms · camera ${measured.cameraDistance} m · ${measured.draws} draws · plate set ${(measured.mark.setBack * 1000).toFixed(2)} mm back${measured.dragon ? ` · dragon ${measured.dragon.boxes} boxes, seen from the ${measured.dragon.side}` : ''}${compared ? ` · ${compared.slice(root.length)}` : ''}`);
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
    await page.screenshot({ path, fullPage: true, timeout: 180_000 });
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
