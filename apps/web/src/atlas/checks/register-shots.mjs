// Atlas register shots and checks in real Chrome (Spec 01 R13, R16–R17, R22): search, a mapped card with its roads, a
// road with its ink, a shared link opened cold on a phone, a search that finds nothing and an unknown route. Needs a
// built web app and `atlas:serve` on 5193 with a fresh survey (names lapse a day after a channel was last seen live).
// Run from the repo root:
//   node apps/web/src/atlas/checks/register-shots.mjs [--query kai] [--login xqc]
// Writes shots/atlas/register-*.png and shots/atlas/register.json. SwiftShader frame times mean nothing here.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { startCapturePreview, closeCapturePreview } from '../../../../../packages/testing/preview.mjs';

const GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const OUT = 'shots/atlas';
const arg = (name, fallback) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback);
const QUERY = arg('query', 'kai');
const LOGIN = arg('login', 'xqc');
const report = { checks: [], failures: [] };

function check(name, ok, detail) {
  report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) report.failures.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stats = (page) => page.evaluate(() => window.__chatdomAtlas?.stats() ?? null);
const path = (page) => new URL(page.url()).pathname;

async function still(page, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await stats(page);
    if (s && !s.flying && !s.gesture && s.tiles.uncovered === 0 && s.tiles.fading === 0) return s;
    await sleep(120);
  }
  return stats(page);
}

async function open(browser, view, route, touch = false) {
  const page = await browser.newPage({ viewport: view, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // A failed load is judged by its response, not its console line: a card looked up by a login the survey does not
  // name answers 404 by design (the page then says so), every other failure is an error.
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  page.on('response', (response) => {
    if (response.status() >= 400 && !(response.status() === 404 && /\/card\/login\/[a-z0-9_]+$/.test(response.url()))) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${base}${route}`);
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

/** The stream-first view: search, choose, read the card, open its strongest road. */
async function stream(browser) {
  const view = { width: 1920, height: 1080 };
  const { page, errors } = await open(browser, view, '/map');
  await still(page);
  await page.keyboard.press('/');
  check('stream: / focuses the search', await page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'));
  await page.keyboard.type(QUERY, { delay: 40 });
  await page.locator('.atlas-search[data-phase="results"]').waitFor({ timeout: 20_000 });
  const names = await page.locator('.atlas-search-name').allTextContents();
  check(`stream: "${QUERY}" finds named channels`, names.length > 0, { names });
  await page.screenshot({ path: `${OUT}/register-search@1920x1080.png` });

  await page.keyboard.press('Enter');
  await page.locator('.atlas-card').waitFor();
  await page.locator('.atlas-roads, .atlas-register-failed').first().waitFor({ timeout: 20_000 });
  await still(page);
  await sleep(500);
  const heading = (await page.locator('.atlas-card h2').textContent())?.trim();
  check('stream: Enter opens the first result’s card', !!heading && names[0]?.startsWith(heading), { heading });
  check('stream: the card’s address is the channel’s', /^\/map\/[a-z0-9_]+$/.test(path(page)), { path: path(page) });
  check('stream: the list folds once a card opens', (await page.locator('.atlas-search-panel').count()) === 0);
  const roads = await page.locator('.atlas-road').count();
  check('stream: the card reads its roads', (await page.locator('.atlas-roads').count()) === 1, { roads });
  await page.screenshot({ path: `${OUT}/register-card@1920x1080.png` });

  if (roads > 0) {
    const cardPath = path(page);
    await page.locator('.atlas-road').first().click();
    await page.locator('.atlas-card[data-kind="road"] .atlas-road-tally').first().waitFor({ timeout: 20_000 });
    await still(page);
    await sleep(500);
    check('stream: a road has its own address', /^\/map\/road\/[a-z0-9_]+\/[a-z0-9_]+$/.test(path(page)), { path: path(page) });
    await page.screenshot({ path: `${OUT}/register-road@1920x1080.png` });
    // One card entry at a time (R9): the road replaced the channel's card, so Back closes it and leaves the map.
    await page.goBack();
    await page.locator('.atlas-card').waitFor({ state: 'detached', timeout: 20_000 });
    check('stream: Back from a road closes it onto the map', path(page) === '/map', { path: path(page), from: cardPath });
  }
  check('stream: no page errors', errors.length === 0, errors);
  await page.close();
}

/** A shared card link opened cold on a phone, then a search that finds nothing, then an unknown route. */
async function phone(browser) {
  const view = { width: 390, height: 844 };
  const { page, errors } = await open(browser, view, `/map/${LOGIN}`, true);
  await page.locator('.atlas-card').waitFor({ timeout: 30_000 });
  await page.locator('.atlas-roads, .atlas-register-failed, .atlas-card[data-kind="waiting"]').first().waitFor({ timeout: 20_000 });
  await still(page);
  await sleep(500);
  check('phone: a shared link opens the channel’s card', path(page) === `/map/${LOGIN}`, { heading: (await page.locator('.atlas-card h2').textContent())?.trim() });
  await page.screenshot({ path: `${OUT}/register-link@390x844.png` });
  await page.goBack();
  await page.locator('.atlas-card').waitFor({ state: 'detached' });
  check('phone: Back from a shared card stays on the map', path(page) === '/map', { path: path(page) });

  const field = page.locator('.atlas-search input');
  await field.tap();
  await field.fill('qzxjvwkplm');
  await page.locator('.atlas-search[data-phase="none"]').waitFor({ timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/register-none@390x844.png` });
  check('phone: no match says so and offers Twitch', (await page.locator('.atlas-search-away').count()) === 1);
  check('phone: no page errors', errors.length === 0, errors);
  await page.close();

  const odd = await open(browser, { width: 1440, height: 900 }, '/map/line/');
  await still(odd.page);
  check('laptop: /map/line/ alone is the login “line”, not found and said so', path(odd.page) === '/map' && (await odd.page.getByText('No channel called “line”').count()) === 1);
  await odd.page.goto(`${base}/map/not%20a%20login`);
  await odd.page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
  await sleep(800);
  check('laptop: an unknown route settles on the map', path(odd.page) === '/map', { path: path(odd.page) });
  await odd.page.screenshot({ path: `${OUT}/register-unknown@1440x900.png` });

  // Any script: the register folds accents and widths, so an accented or full-width name is found typed plainly.
  await odd.page.keyboard.press('/');
  await odd.page.keyboard.type('ｓｈｒｏｕｄ', { delay: 30 });
  await odd.page.locator('.atlas-search[data-phase="results"], .atlas-search[data-phase="none"]').waitFor({ timeout: 20_000 });
  const wide = await odd.page.locator('.atlas-search-name').allTextContents();
  check('laptop: a full-width query is folded and searched', (await odd.page.locator('.atlas-search').getAttribute('data-phase')) !== null, { wide });
  await odd.page.screenshot({ path: `${OUT}/register-wide@1440x900.png` });
  check('laptop: no page errors', odd.errors.length === 0, odd.errors);
  await odd.page.close();
}

/** Without WebGL the still stands in for the map: the same search finds a channel and opens its card there. */
async function stillSearch() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-3d-apis', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/map`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
    check('still: drawn without WebGL', (await page.locator('[data-chatdom-atlas]').getAttribute('data-state')) === 'still');
    await page.locator('.atlas-search input').fill(QUERY);
    await page.locator('.atlas-search[data-phase="results"]').waitFor({ timeout: 20_000 });
    await page.keyboard.press('Enter');
    await page.locator('.atlas-card .atlas-roads, .atlas-card .atlas-register-failed').first().waitFor({ timeout: 30_000 });
    check('still: search opens a card with its register', /^\/map\/[a-z0-9_]+$/.test(path(page)), { path: path(page), heading: (await page.locator('.atlas-card h2').textContent())?.trim() });
    await sleep(400);
    await page.screenshot({ path: `${OUT}/register-still@1440x900.png` });
    check('still: no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}

let base;
let server;
try {
  await mkdir(OUT, { recursive: true });
  ({ server, base } = await startCapturePreview());
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
  try {
    await stream(browser);
    await phone(browser);
  } finally {
    await browser.close();
  }
  await stillSearch();
} finally {
  if (server) await closeCapturePreview(server);
  await writeFile(`${OUT}/register.json`, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(report.failures.length ? `${report.failures.length} failed` : `all ${report.checks.length} passed`);
process.exitCode = report.failures.length ? 1 : 0;
