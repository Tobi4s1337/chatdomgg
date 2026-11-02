/* global AbortSignal, clearTimeout */
// Run against a built preview and the Atlas data service:
// ATLAS_CHECK_URL=http://127.0.0.1:5175 node apps/web/src/atlas/checks/face-checks.mjs
import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.1:5175';
const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failures.push(name);
  console.log(`${ok ? 'ok' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aN8AAAAASUVORK5CYII=', 'base64');
const urls = [0, 1, 2, 3, 4, 5].map(i => `https://static-cdn.jtvnw.net/jtv_user_pictures/face-check-${i}.png`);
let browser, release, deadline;
try {
  release = await acquireCaptureLock({ signal: AbortSignal.timeout(Number(process.env.ATLAS_CAPTURE_WAIT_MS ?? 150000)) });
  deadline = setTimeout(() => { void browser?.close(); }, 240000);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    const pending = new Set();
    const schedule = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      const id = schedule(() => { pending.delete(id); callback(...args); }, delay);
      pending.add(id);
      return id;
    };
    window.clearTimeout = id => { pending.delete(id); cancel(id); };
    window.__portraitPendingTimers = () => pending.size;
  });
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let cardPortrait = () => ({ url: urls[0], freshUntil: Date.now() + 60_000 });
  let imageFails = false;
  await page.route('https://static-cdn.jtvnw.net/**', async route => {
    requests.push(route.request().url());
    if (imageFails) await route.abort('failed');
    else await route.fulfill({ status: 200, contentType: 'image/png', body: image });
  });
  await page.route('**/map-data/v1/preview/**', async route => {
    const url = new URL(route.request().url());
    if (!/\/(search|card\/)/.test(url.pathname)) return route.continue();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    if (url.pathname.endsWith('/search')) {
      body.results = body.results.slice(0, 2).map((row, i) => ({ ...row, portrait: { url: urls[i], freshUntil: Date.now() + 60_000 } }));
    } else body.portrait = cardPortrait();
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${base}/-/atlas-embed?mode=explore&lazy=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__atlasBench);
  const timerBaseline = await page.evaluate(() => window.__portraitPendingTimers());
  await page.evaluate(() => window.__atlasBench.mount({ mode: 'explore' }));
  await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 60000 });
  check('WebGL-free dated still is ready', await page.evaluate(async () => (await window.__atlasBench.handle.ready) === 'still' && !!document.querySelector('[data-as-of]')?.getAttribute('data-as-of')));
  await sleep(500);
  check('overview does not request portraits', requests.length === 0, requests);
  const input = page.getByRole('combobox', { name: 'Find a channel' });
  await input.fill('kai');
  const rows = page.locator('.atlas-search-result');
  const openResults = async () => {
    await input.focus();
    await input.press('ArrowDown');
    await rows.first().waitFor();
  };
  const closeCard = async () => {
    await page.getByRole('button', { name: 'Close card' }).click();
    await page.locator('.atlas-card').waitFor({ state: 'hidden', timeout: 4000 }).catch(async error => {
      throw new Error(`${error.message}\nClose state: ${JSON.stringify(await page.evaluate(() => ({ heading: document.querySelector('.atlas-card h2')?.textContent, active: document.activeElement?.outerHTML.slice(0, 160), view: window.__atlasBench.handle.view() })))}\nPage errors: ${errors.join('; ')}`);
    });
  };
  await rows.nth(1).waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.atlas-search-result [data-atlas-face="picture"]').length === 2, null, { timeout: 10000 });
  check('open search rows load only their portraits', urls.slice(0, 2).every(url => requests.includes(url)) && requests.every(url => urls.slice(0, 2).includes(url)), requests);
  await input.press('Escape');
  check('closing search unmounts row portraits', await page.locator('.atlas-search-result [data-atlas-face]').count() === 0);
  await openResults();
  await rows.first().click();
  await page.waitForSelector('.atlas-card [data-atlas-face="picture"]', { timeout: 20000 });
  check('selected card shows its own portrait', await page.locator('.atlas-card [data-atlas-face="picture"] img').getAttribute('src') === urls[0]);
  await closeCard();
  check('closing card removes its portrait', await page.locator('.atlas-card [data-atlas-face] img').count() === 0);
  imageFails = true;
  cardPortrait = () => ({ url: urls[2], freshUntil: Date.now() + 60_000 });
  await openResults();
  await Promise.all([page.waitForResponse(response => /\/card\//.test(response.url()) && response.ok()), rows.nth(1).click()]);
  await page.waitForSelector('.atlas-card [data-atlas-face="shield"]', { timeout: 20000 });
  await sleep(500);
  check('failed second portrait was requested and falls back without showing the first', requests.includes(urls[2]) && await page.locator('.atlas-card [data-atlas-face="picture"]').count() === 0 && await page.locator(`.atlas-card img[src="${urls[0]}"]`).count() === 0, requests);
  await closeCard();
  imageFails = false;
  cardPortrait = () => ({ url: urls[3], freshUntil: Date.now() + 5000 });
  await openResults();
  await rows.first().click();
  await page.waitForSelector('.atlas-card [data-atlas-face="picture"]', { timeout: 20000 });
  await page.waitForSelector('.atlas-card [data-atlas-face="shield"]', { timeout: 10000 });
  check('open card returns to shield when portrait expires', requests.includes(urls[3]) && await page.locator('.atlas-card [data-atlas-face="picture"]').count() === 0);
  await closeCard();
  cardPortrait = () => ({ url: urls[4], freshUntil: Date.now() - 1 });
  await openResults();
  await Promise.all([page.waitForResponse(response => /\/card\//.test(response.url()) && response.ok()), rows.first().click()]);
  await page.waitForSelector('.atlas-card [data-atlas-face="shield"]', { timeout: 20000 });
  await sleep(500);
  check('stale portrait is never requested', !requests.includes(urls[4]) && await page.locator('.atlas-card [data-atlas-face="picture"]').count() === 0, requests);
  await closeCard();
  cardPortrait = () => ({ url: urls[5], freshUntil: Date.now() + 60_000 });
  await openResults();
  await rows.first().click();
  await page.waitForSelector('.atlas-card [data-atlas-face="picture"]', { timeout: 20000 });
  await page.evaluate(() => window.__atlasBench.dispose());
  check('disposing embed removes portrait images', await page.locator('[data-atlas-face] img').count() === 0 && await page.locator('[data-chatdom-atlas]').count() === 0);
  await page.waitForFunction(expected => window.__portraitPendingTimers() === expected, timerBaseline, { timeout: 2000 });
  check('disposing a fresh picture restores the timer baseline', await page.evaluate(() => window.__portraitPendingTimers()) === timerBaseline);
  check('no uncaught browser errors', errors.length === 0, errors);
  await page.close();
} catch (error) {
  check('suite completes', false, String(error?.stack ?? error));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await release?.();
  console.log(`${checks - failures.length}/${checks} checks passed`);
  if (failures.length) process.exitCode = 1;
}
