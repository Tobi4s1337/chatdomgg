/* global AbortSignal, clearTimeout */
// AM11 stills on the owned service and preview: a real road (run once with ATLAS_ROAD_PHASE=before, restart the
// service, run again with after), a sea lane, a caravan mid-ride, and the Raid Gate's finder at three sizes.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175';
const phase = ['after', 'finder'].includes(process.env.ATLAS_ROAD_PHASE) ? process.env.ATLAS_ROAD_PHASE : 'before';
// The finder alone, at the widths asked for (each gate page draws the whole map, so a capture takes few at a time).
const finderWidths = (process.env.ATLAS_FINDER_WIDTHS ?? '1920,1440,390').split(',').map(Number);
const from = process.env.ATLAS_GATE_FROM ?? '129634568';
const out = 'work/evidence/atlas-map';
const record = `${out}/am11-road-shots.json`;
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const errors = [];
const captures = [];

const ready = page => page.waitForSelector('.atlas[data-state="ready"]', { timeout: 90_000 });
const roadsDrawn = page => page.waitForFunction(() => {
  const value = document.querySelector('.atlas')?.getAttribute('data-roads');
  return !!value && Number(value.split(':')[0]) > 0;
}, null, { timeout: 30_000 });
const settle = async (page, ms = 2_600) => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(ms); };
const state = page => page.locator('.atlas').evaluate(el => Object.fromEntries(['data-preview', 'data-revision', 'data-roads', 'data-roads-focus', 'data-caravans', 'data-gate-from', 'data-gate-picked', 'data-state'].map(name => [name.slice(5), el.getAttribute(name)])));
async function shot(page, name, extra = {}) {
  let path = `${out}/am11-${name}.png`;
  let image = await page.screenshot();
  // A large still goes in as a high-quality JPEG so the evidence stays under 2 MB.
  if (image.length >= 2_000_000) { path = `${out}/am11-${name}.jpg`; image = await page.screenshot({ type: 'jpeg', quality: 90 }); }
  if (image.length >= 2_000_000) throw new Error(`${path}: still exceeds 2 MB`);
  await writeFile(path, image);
  captures.push({ path, at: new Date().toISOString(), ...(await state(page)), ...extra });
}
const json = (page, path) => page.evaluate(async url => { const reply = await fetch(url); return reply.ok ? reply.json() : null; }, path);

const known = await readFile(record, 'utf8').then(text => JSON.parse(text)).catch(() => ({ runs: [] }));
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(Number(process.env.ATLAS_LOCK_WAIT_MS ?? 1_200_000)) });
let browser;
// A stalled service must not hold the shared capture slot for five minutes.
const deadline = setTimeout(() => { void browser?.close(); }, 270_000);
const started = Date.now();
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  await mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let pick = known.road;
  if (phase !== 'finder') {
  page.on('pageerror', error => errors.push({ phase, message: error.message }));
  await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await roadsDrawn(page);
  const preview = await page.locator('.atlas').getAttribute('data-preview');
  const busiest = await json(page, `/map-data/v1/roads/${preview}/busiest`);
  if (!busiest?.roads.length) throw new Error('The service served no roads');
  // The road the before and after stills are about: the first run picks the busiest named road, the second keeps it.
  if (phase === 'before' || !pick) {
    for (const road of busiest.roads.slice(0, 40)) {
      const story = await json(page, `/map-data/v1/roads/${preview}/road/${road.a}/${road.b}`);
      if (story?.a.login && story?.b.login && story.basis !== 'none') { pick = { a: road.a, b: road.b, login: story.a.login, other: story.b.login }; break; }
    }
  }
  if (!pick) throw new Error('No named road among the busiest');
  const ledger = await json(page, `/map-data/v1/roads/${preview}/channel/${pick.a}`);
  await page.goto(`${base}/map/${pick.login}`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.locator('.atlas-card [data-atlas-roads]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => Number(document.querySelector('.atlas')?.getAttribute('data-roads-focus') ?? 0) > 0, null, { timeout: 30_000 }).catch(() => undefined);
  await settle(page);
  await shot(page, `road-${phase}`, { login: pick.login, total: ledger?.total ?? null, roads: ledger?.roads.slice(0, 4).map(road => ({ other: road.other.login, sent: road.sent, received: road.received, firstAt: road.firstAt, lastAt: road.lastAt, basis: road.basis })) ?? null });

  if (phase === 'before') {
    // A sea lane: a road between two languages, opened from its card route and framed.
    for (const road of busiest.roads.filter(candidate => candidate.ra !== null && candidate.rb !== null && candidate.ra !== candidate.rb).slice(0, 30)) {
      const story = await json(page, `/map-data/v1/roads/${preview}/road/${road.a}/${road.b}`);
      if (!story?.a.login || !story?.b.login) continue;
      await page.goto(`${base}/map/road/${story.a.login}/${story.b.login}`, { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.locator('[data-atlas-road-story]').waitFor({ timeout: 30_000 });
      await settle(page, 3_400);
      await shot(page, 'sea-lane', { a: story.a.login, b: story.b.login, ra: road.ra, rb: road.rb, raids: road.raids });
      break;
    }
    // A caravan mid-ride: the whole map, waiting for the next fresh raid from the survey's stream.
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const riding = await page.waitForFunction(() => Number(document.querySelector('.atlas')?.getAttribute('data-caravans') ?? 0) > 0, null, { timeout: 75_000, polling: 250 }).then(() => true, () => false);
    if (riding) {
      await page.waitForTimeout(4_000);
      await shot(page, 'caravan');
    } else {
      errors.push({ phase, message: 'No fresh raid rode within 75 s' });
    }
  }
  }
  if (phase !== 'before') {
    // The finder: the Raid Gate's own surface from tobi4s_, at the stream view, the laptop and the phone.
    for (const [width, height, mobile] of [[1920, 1080, false], [1440, 900, false], [390, 844, true]].filter(([width]) => finderWidths.includes(width))) {
      const gate = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      gate.on('pageerror', error => errors.push({ phase, width, message: error.message }));
      await gate.goto(`${base}/-/atlas-embed?mode=gate&from=${from}`, { waitUntil: 'domcontentloaded' });
      await gate.waitForSelector('.atlas[data-gate-finder="ready"][data-state="ready"]', { timeout: 90_000 });
      // The map flies down to the source once the finder answers: wait for it to arrive, then for the tiles to settle.
      await gate.waitForSelector('.atlas:not([data-distance="world"])', { timeout: 60_000 });
      await settle(gate, 5_000);
      const finder = await gate.locator('.atlas-finder').evaluate(el => ({
        groups: [...el.querySelectorAll('.atlas-finder-group')].map(group => ({ title: group.querySelector('h3')?.textContent, rows: group.querySelectorAll('.atlas-finder-row').length })),
      }));
      await shot(gate, `finder-${width}`, finder);
      await gate.close();
    }
  }
  known.road = pick;
  known.runs.push({ phase, base, ms: Date.now() - started, captures, errors });
  await writeFile(record, `${JSON.stringify(known, null, 2)}\n`);
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await release();
}
console.log(JSON.stringify({ phase, ms: Date.now() - started, captures: captures.map(capture => capture.path), errors }, null, 2));
