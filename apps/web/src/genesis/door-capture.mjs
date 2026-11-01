/* global requestAnimationFrame, AbortController, clearTimeout, sessionStorage */
// Captures generated kingdoms through their real door: the kingdom route a holding's Atlas card opens.
// Run from the repository root:
//   node apps/web/src/genesis/door-capture.mjs [--random 10] [--seed atlas-door] [--ids 123,456] [--authored]
//     [--hour 19.4] [--tag after] [--size 1920x1080] [--sheet] [--with <tags>] [--card <id>] [--raid <from>:<to>]
//     [--before]  (with --card, run from an export of the earlier tree: the card alone, for a before/after)
//     [--simulate-names]  (looks only: a lapsed survey's holdings under labelled stand-in names, never evidence)
// --random picks holdings uniformly from the named, shown holdings of the current survey (seeded, so a run repeats);
// --authored adds The_AGGman, PinkKittyRose and MashaD4 at their own opening hours; --sheet tiles everything taken
// into one contact sheet with each holding's name, tier and land (--with <tags> adds stills earlier runs took). --card captures the Atlas card and the door's
// first frame for one holding; --raid captures a raider's ride in.
// Each kingdom loads and settles first; only its last frames and the still itself hold the machine-wide capture lock,
// released right after, so main never waits behind a loading kingdom.
// It starts its own Vite dev server on a free capture port (never 5187 or 5190–5197; it waits when all are busy) and fails on any page error.
// The adopted-land service is answered in the browser with its own "no adopted record" reply (HTTP 404), which is
// what every unfounded channel receives. The survey is read, read only, from the running Surveyor's map data.
// Output: shots/genesis-door/<tag>-<id>@<w>x<h>.png and, with --sheet, shots/genesis-door/<tag>-sheet.png.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = name => args.includes(name);
const tag = option('--tag') ?? 'after';
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
const hour = option('--hour');
const out = 'shots/genesis-door';
const SURVEY = 'http://127.0.0.1:5193/map-data';
const AUTHORED = ['63920635', '4363967', '154972160'];
// The shared capture ports only: never 5187 or the service ports 5190–5197.
const PORTS = CAPTURE_PORTS.filter(port => port !== 5187 && (port < 5190 || port > 5197));
const SIMULATE = flag('--simulate-names');
const UNADOPTED = { version: 1, status: 'unavailable', message: 'No adopted record exists for this kingdom.' };

/** FNV-1a then a xorshift stream: a seeded, repeatable pick. */
function random(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
}

async function surveyHoldings() {
  const read = async path => { const response = await fetch(`${SURVEY}${path}`); if (!response.ok) throw new Error(`${path}: ${response.status}`); return response.json(); };
  const pointer = await read('/v1/preview');
  const world = await read(`/v1/preview/${pointer.id}/world.json`);
  const names = await read(`/v1/preview/${pointer.id}/names`);
  const withheld = new Set(names.withheld), named = new Map(names.ids.map((id, i) => [id, { name: names.names[i], fresh: names.freshUntil[i] }]));
  const tiers = ['capital', 'city', 'town', 'village'];
  const holdings = [];
  const take = columns => columns.ids.forEach((id, i) => {
    const entry = named.get(id);
    if (withheld.has(id)) return;
    if (!SIMULATE && (!entry || entry.fresh <= Date.now())) return;
    const tier = tiers[columns.tier[i]] ?? String(columns.tier[i]);
    const game = columns.game[i] >= 0 ? world.games[columns.game[i]] : null, realm = world.realms[columns.realm[i]], region = world.regions[columns.region[i]];
    // The door's own record of the holding, as the Atlas card hands it over; with --simulate-names its name is a
    // labelled stand-in, for looking at a land while the survey's names have lapsed. Never used for evidence.
    const door = { version: 1, id, login: `simulated_${id}`, name: `SIMULATED · ${id}`, freshUntil: Date.now() + 3_600_000, tier, average: columns.average[i],
      game: game?.name ? { id: game.gameId, name: game.name } : null,
      realm: { kind: realm.kind, family: realm.family >= 0 ? world.families[realm.family].id : null, name: realm.name },
      region: { language: region.language, name: region.englishName ?? region.name }, x: columns.x[i] / world.coordScale, y: columns.y[i] / world.coordScale,
      survey: { preview: world.id, revision: world.revision, asOf: world.asOf, windowHours: world.window.hours } };
    holdings.push({ id, name: SIMULATE ? door.name : entry.name, tier, average: columns.average[i], door, survey: door.survey });
  });
  take(world.head);
  for (const region of world.regions) take((await read(`/v1/preview/${world.id}/${region.chunk.path}`)).settlers);
  return holdings;
}

/** A free capture port for our own Vite server; when every one is busy, wait for one rather than give up. */
async function start() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const started = await startOnce();
    if (started) return started;
    console.log('[capture] every capture port is busy; trying again in 30 s');
    await new Promise(resolve => setTimeout(resolve, 30_000));
  }
  throw new Error('No safe capture port came free in 30 minutes.');
}

async function startOnce() {
  for (const port of PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  return null;
}

/** The shared lock, requeued every four minutes so the measured hold is the still itself, not the queue. */
async function takeLock() {
  for (;;) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('requeue')), 240_000);
    try { return await acquireCaptureLock({ signal: controller.signal }); }
    catch (error) { if (!controller.signal.aborted) throw error; }
    finally { clearTimeout(timer); }
  }
}

/**
 * Walks the routes' module graph on the server before the first page asks for it, so Vite discovers and optimises
 * every dependency up front. Without this, a dependency found mid-load re-optimises and the route's dynamic import
 * fails in a page that has no hot reload to recover.
 */
async function warm(server) {
  const seen = new Set(), queue = ['/src/main.tsx', '/src/genesis/index.tsx', '/src/atlas/index.tsx'];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const result = await server.transformRequest(url).catch(() => null);
    for (const match of result?.code.matchAll(/(?:import|from)\s*\(?\s*["'](\/src\/[^"'?]+)/g) ?? []) queue.push(match[1]);
  }
  await new Promise(resolve => setTimeout(resolve, 3000));
}

/** Opens a route, reloading once if its dynamic import raced a dependency re-optimisation. */
async function visit(page, errors, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const opened = await page.waitForSelector('.door, [data-chatdom-atlas]', { timeout: 120_000 }).then(() => true, () => false);
  const raced = errors.filter(error => /Failed to fetch dynamically imported module/.test(error));
  if (opened && !raced.length) return;
  for (const error of raced) errors.splice(errors.indexOf(error), 1);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * Waits for `n` drawn frames, never longer than `limit`: a stalled page must not sit on the lock. Under software
 * rendering one frame of a big kingdom can take many seconds, so the settling frames are drawn before the lock and
 * only the last two under it.
 */
const frames = (page, n = 30, limit = 900_000) => Promise.race([
  page.evaluate(n => new Promise(resolve => { let i = 0; const step = () => (++i >= n ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); }), n),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`The page drew fewer than ${n} frames in ${limit / 1000} s.`)), limit)),
]);

async function kingdomReady(page) {
  await page.waitForFunction(() => (window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldSettled
    && !document.querySelector('.door:not([data-phase="gone"])')) || !!document.querySelector('.door-failure'), null, { timeout: 900_000 });
  const failure = await page.locator('.door-failure').count();
  if (failure) throw new Error(`Door failure: ${await page.locator('.door-failure').innerText()}`);
  await page.evaluate(() => document.fonts.ready);
}

let server, browser, release;
const taken = [];
try {
  let ids = (option('--ids') ?? '').split(',').filter(Boolean);
  const count = Number(option('--random') ?? 0);
  const picked = new Map();
  if (count) {
    const holdings = await surveyHoldings(), next = random(option('--seed') ?? 'atlas-door');
    console.log(`${holdings.length} ${SIMULATE ? 'shown' : 'named'} holdings on the survey${SIMULATE ? ' (names SIMULATED)' : ''}`);
    if (holdings.filter(holding => !AUTHORED.includes(holding.id)).length < count) throw new Error('Not enough eligible holdings on the survey for this sample.');
    while (picked.size < count) { const holding = holdings[Math.floor(next() * holdings.length)]; if (!AUTHORED.includes(holding.id)) picked.set(holding.id, holding); }
    ids = [...ids, ...picked.keys()];
  }
  if (SIMULATE && !count && ids.length) {
    // Named by --ids: their door records come from the survey's geometry too.
    const holdings = new Map((await surveyHoldings()).map(holding => [holding.id, holding]));
    for (const id of ids) if (holdings.has(id)) picked.set(id, holdings.get(id));
  }
  if (flag('--authored')) ids = [...AUTHORED, ...ids];
  // A sheet of earlier stills alone needs no server or browser.
  const started = ids.length || option('--card') || option('--raid') ? await start() : null;
  if (started) {
    server = started.server;
    console.log(`Serving ${started.base} (started here)`);
    await warm(server);
  }
  if (started) browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  const open = async () => {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console: ${message.text()}`); });
    await page.route('**/api/realm/founded/*', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(UNADOPTED) }));
    return { page, errors };
  };

  // A kingdom loads and settles before the lock is taken: the lock covers only its last frames and the still, so a
  // heavy capital never holds it for minutes while main waits.
  for (const id of ids) {
    const { page, errors } = await open();
    const query = hour && !AUTHORED.includes(id) ? `?hour=${hour}` : '';
    const simulated = SIMULATE ? picked.get(id)?.door : null;
    if (simulated) await page.addInitScript(record => sessionStorage.setItem('chatdom.door.v1', JSON.stringify(record)), simulated);
    const began = Date.now();
    await visit(page, errors, `${started.base}/kingdom/${id}${query}`);
    await kingdomReady(page);
    await frames(page);
    const loaded = Math.round((Date.now() - began) / 1000);
    release = await takeLock();
    const held = Date.now();
    await frames(page, 2, 120_000);
    const path = `${out}/${tag}-${id}@${width}x${height}.png`;
    await page.screenshot({ path, timeout: 180_000 });
    const info = await page.evaluate(() => window.__chatdomGenesis ?? null);
    await release(); release = undefined;
    const holding = Math.round((Date.now() - held) / 1000);
    await page.close();
    if (errors.length) throw new Error(`Errors on ${id}:\n${errors.join('\n')}`);
    taken.push({ id, path, info, holding: picked.get(id) ?? null });
    await writeFile(`${out}/${tag}-taken.json`, JSON.stringify(taken, null, 1));
    console.log(`Captured ${path} (loaded in ${loaded} s, lock held ${holding} s)`, JSON.stringify(info));
  }

  const card = option('--card');
  if (card) hand: {
    const { page, errors } = await open();
    // The card for a holding, then the door's first frame as the map hands over.
    await visit(page, errors, `${started.base}/map`);
    await page.waitForFunction(() => window.__chatdomReady === true && document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-state') === 'ready', null, { timeout: 300_000 });
    // A small holding is not drawn at the whole-map distance: zoom in about it until its own mark is drawn.
    const canvas = await page.locator('canvas').first().boundingBox();
    const spot = await page.evaluate(async id => {
      const read = async url => (await fetch(url)).json();
      const pointer = await read('/map-data/v1/preview');
      const world = await read(`/map-data/v1/preview/${pointer.id}/world.json`);
      const find = columns => { const i = columns.ids.indexOf(id); return i < 0 ? null : { x: columns.x[i] / world.coordScale, y: columns.y[i] / world.coordScale }; };
      let found = find(world.head);
      for (const region of world.regions) { if (found) break; found = find((await read(`/map-data/v1/preview/${world.id}/${region.chunk.path}`)).settlers); }
      return found;
    }, card);
    if (!spot) throw new Error(`${card} is not on this survey.`);
    const drawn = () => page.evaluate(id => window.__chatdomAtlas.marks(100000).find(item => item.id === id) ?? null, card);
    let mark = await drawn();
    for (let step = 0; !mark && step < 16; step++) {
      const camera = await page.evaluate(() => window.__chatdomAtlas.stats()?.camera ?? null);
      await page.mouse.move(canvas.x + (spot.x - camera.x) * camera.scale + canvas.width / 2, canvas.y + (spot.y - camera.y) * camera.scale + canvas.height / 2);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(1200);
      mark = await drawn();
    }
    if (!mark) throw new Error(`${card} is not drawn on the Atlas, even close in.`);
    await page.mouse.click(canvas.x + mark.x, canvas.y + mark.y);
    if (flag('--before')) {
      // The same card on code without the door (run from an export of the earlier tree): the card alone.
      await page.locator('.atlas-card').waitFor({ timeout: 60_000 });
      await frames(page, 6, 120_000);
      release = await takeLock();
      await page.screenshot({ path: `${out}/${tag}-card-${card}@${width}x${height}.png`, timeout: 180_000 });
      await release(); release = undefined;
      await page.close();
      if (errors.length) throw new Error(`Errors on the card:\n${errors.join('\n')}`);
      console.log(`Captured the card for ${card} (before)`);
      break hand;
    }
    const door = page.locator(`.atlas-card a.atlas-door[href="/kingdom/${card}"]`);
    await door.waitFor({ timeout: 60_000 });
    await frames(page, 6, 120_000);
    release = await takeLock();
    await page.screenshot({ path: `${out}/${tag}-card-${card}@${width}x${height}.png`, timeout: 180_000 });
    await release(); release = undefined;
    await door.click();
    await page.waitForTimeout(450);
    release = await takeLock();
    await page.screenshot({ path: `${out}/${tag}-door-${card}@${width}x${height}.png`, timeout: 180_000 });
    await release(); release = undefined;
    await page.waitForURL(`**/kingdom/${card}**`, { timeout: 60_000 });
    await page.waitForSelector('.door-steps li', { timeout: 60_000 });
    await frames(page, 2, 120_000);
    release = await takeLock();
    await page.screenshot({ path: `${out}/${tag}-door-page-${card}@${width}x${height}.png`, timeout: 180_000 });
    await release(); release = undefined;
    await page.close();
    if (errors.length) throw new Error(`Errors on the card:\n${errors.join('\n')}`);
    console.log(`Captured the card and door for ${card}`);
  }

  const raid = option('--raid');
  if (raid) {
    const [from, to] = raid.split(':');
    const { page, errors } = await open();
    await visit(page, errors, `${started.base}/kingdom/${to}?from=${from}&viewers=120`);
    await page.waitForSelector('.raid-ride-caption', { timeout: 300_000 });
    release = await takeLock();
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: `${out}/${tag}-raid-${from}-${to}@${width}x${height}.png`, timeout: 180_000 });
    await release(); release = undefined;
    await page.close();
    if (errors.length) throw new Error(`Errors on the raid ride:\n${errors.join('\n')}`);
    console.log(`Captured the raid ride ${from} → ${to}`);
  }

  if (flag('--sheet')) {
    // Earlier runs' stills (by tag) join this run's: the authored three can be taken once and reused.
    const earlier = [];
    for (const other of (option('--with') ?? '').split(',').filter(Boolean)) earlier.push(...JSON.parse(await readFile(`${out}/${other}-taken.json`, 'utf8')));
    const all = [...earlier, ...taken].filter((shot, i, list) => list.findIndex(item => item.id === shot.id) === i);
    const authored = all.filter(shot => AUTHORED.includes(shot.id)), generated = all.filter(shot => !AUTHORED.includes(shot.id));
    // Five across, each tile 640×360 with its name, size, land and landmark beneath. The first row holds a title
    // and the three authored kingdoms; the generated holdings fill the rows below.
    const cols = 5, w = 640, h = 360, label = 46;
    const tiles = [];
    const survey = generated.find(shot => shot.holding?.survey)?.holding.survey ?? null;
    if (authored.length) {
      tiles.push({ title: true, x: 0, y: 0, w: w * (cols - authored.length) });
      authored.forEach((shot, i) => tiles.push({ shot, x: w * (cols - authored.length + i), y: 0 }));
    }
    const top = authored.length ? 1 : 0;
    generated.forEach((shot, i) => tiles.push({ shot, x: (i % cols) * w, y: (top + Math.floor(i / cols)) * (h + label) }));
    const rows = top + Math.ceil(generated.length / cols);
    for (let i = generated.length; i < Math.ceil(generated.length / cols) * cols; i++) tiles.push({ blank: true, x: (i % cols) * w, y: (top + Math.floor(i / cols)) * (h + label) });
    const inputs = [], filters = [];
    const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', serif = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf';
    let input = 0;
    for (const [i, tile] of tiles.entries()) {
      if (tile.title) {
        const file = `${out}/.label-title.txt`, small = `${out}/.label-title-small.txt`;
        await writeFile(file, 'Every channel\'s kingdom');
        await writeFile(small, [`Ten holdings drawn at random from the Atlas survey${survey ? ` ${survey.revision}` : ''},`,
          'each opened through its door and seen at dusk,', 'beside the three authored kingdoms.', '', 'Land from the broadcaster ID, landmarks from the realm,', 'colours from the holding\'s Atlas arms, size from its audience.',
          ...(SIMULATE ? ['', 'Names SIMULATED: the survey\'s names have lapsed,', 'so each holding shows its ID. Lands are real.'] : [])].join('\n'));
        filters.push(`color=c=0x2a2420:s=${tile.w}x${h + label}:d=1,drawtext=fontfile=${serif}:textfile=${file}:fontcolor=0xf1dbaf:fontsize=44:x=48:y=70,drawtext=fontfile=${font}:textfile=${small}:fontcolor=0xd2c4a4:fontsize=19:line_spacing=10:x=50:y=150[t${i}]`);
        continue;
      }
      if (tile.blank) { filters.push(`color=c=0x2a2420:s=${w}x${h + label}:d=1[t${i}]`); continue; }
      const { shot } = tile;
      inputs.push('-i', shot.path);
      const info = shot.info ?? {};
      const text = `${info.name ?? shot.id}  ·  ${info.tier ?? ''} · ${String(info.landscape ?? '').replaceAll('-', ' ')} · ${info.landmark ?? ''} · ${info.kit ?? info.style ?? ''}${info.generated ? '' : '  (authored)'}`;
      const file = `${out}/.label-${i}.txt`;
      await writeFile(file, text);
      filters.push(`[${input++}:v]scale=${w}:${h},pad=${w}:${h + label}:0:0:color=0x2a2420,drawtext=fontfile=${font}:textfile=${file}:fontcolor=0xf1dbaf:fontsize=17:x=12:y=${h + 14}[t${i}]`);
    }
    const layout = tiles.map(tile => `${tile.x}_${tile.y}`).join('|');
    filters.push(`${tiles.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=0x2a2420[sheet]`);
    const sheet = `${out}/${tag}-sheet.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[sheet]', '-frames:v', '1', sheet]);
    console.log(`Contact sheet ${sheet} (${cols * w}×${rows * (h + label)})`);
    await writeFile(`${out}/${tag}-sheet.json`, JSON.stringify(all, null, 1));
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
