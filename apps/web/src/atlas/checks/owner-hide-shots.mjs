/* global AbortSignal, clearTimeout, setTimeout, process */
// The streamer's own hide flow on the real map, against a lane-owned Atlas service with its private listener.
// The session authority (apps/api, `/api/atlas/me`) needs Postgres and a real Twitch sign-in, neither of which this
// bench has, so this script plays exactly that part for one channel: it answers `/api/atlas/me*` by calling the
// Atlas service's private routes with the token, the way `apps/api/src/atlas-owner` does for a verified session.
// Everything else (the map, the cards, search, the names projection and the public card routes) is the real thing.
//   ATLAS_CHECK_URL=http://127.0.0.3:5173 ATLAS_PRIVATE_URL=http://127.0.0.3:5170 ATLAS_TOKEN_FILE=/tmp/am13-token \
//   ATLAS_OWNER_ID=129634568 ATLAS_OWNER_LOGIN=tobi4s_ node src/atlas/checks/owner-hide-shots.mjs
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.3:5173';
const privateUrl = process.env.ATLAS_PRIVATE_URL ?? 'http://127.0.0.3:5170';
const token = (await readFile(process.env.ATLAS_TOKEN_FILE ?? '/tmp/am13-token', 'utf8')).trim();
const ownerId = process.env.ATLAS_OWNER_ID ?? '129634568';
const login = process.env.ATLAS_OWNER_LOGIN ?? 'tobi4s_';
const out = 'work/evidence/atlas-map';
const CSRF = 'bench-session-csrf-token-0123456789abcdef';

const atlas = async (path, init = {}) => {
  const response = await fetch(new URL(path, privateUrl), { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
  if (!response.ok) throw new Error(`private ${path}: ${response.status}`);
  return response.json();
};
/** What apps/api/src/atlas-owner answers for a live session of `ownerId`. */
async function authority(route) {
  const url = new URL(route.request().url());
  const pick = (v) => ({ hidden: v.hidden, onMap: v.onMap, card: v.card && typeof v.card === 'object' ? v.card : null });
  if (url.pathname === '/api/atlas/me' && route.request().method() === 'GET') {
    const v = await atlas(`/v1/channels/${ownerId}/visibility${url.searchParams.get('preview') ? `?preview=${url.searchParams.get('preview')}` : ''}`);
    return route.fulfill({ status: 200, headers: { 'cache-control': 'no-store', vary: 'Cookie' }, json: { version: 1, status: 'broadcaster', channelId: ownerId, ...pick(v), csrfToken: CSRF } });
  }
  if ((url.pathname === '/api/atlas/me/hide' || url.pathname === '/api/atlas/me/show') && route.request().method() === 'POST') {
    if (route.request().headers()['x-csrf-token'] !== CSRF) return route.fulfill({ status: 403, json: { version: 1, status: 'refused' } });
    const v = await atlas(`/v1/channels/${ownerId}/${url.pathname.endsWith('/hide') ? 'hide' : 'unhide'}`, { method: 'POST', body: JSON.stringify({ version: 1, at: Date.now() }) });
    return route.fulfill({ status: 200, json: { version: 1, status: 'broadcaster', channelId: ownerId, hidden: v.hidden, onMap: v.onMap, card: null, csrfToken: CSRF } });
  }
  return route.fulfill({ status: 404, json: { version: 1, status: 'refused' } });
}

const release = await acquireCaptureLock({ signal: AbortSignal.timeout(900_000) });
let browser;
const deadline = setTimeout(() => { void browser?.close(); }, 270_000);
const captures = [], errors = [], checks = [];
const check = (ok, what) => { if (!ok) throw new Error(`failed: ${what}`); checks.push(what); };
try {
  // Start shown, whatever a previous run left.
  await atlas(`/v1/channels/${ownerId}/unhide`, { method: 'POST', body: JSON.stringify({ version: 1, at: Date.now() }) });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const width of [1440, 390]) {
    const phone = width === 390;
    const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone });
    await context.route(/\/api\/atlas\/me/, authority);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const shot = async (name, kind) => {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(450);
      const path = `${out}/am13-hide-${name}-${width}.png`;
      await page.screenshot({ path });
      captures.push({ path, kind, width });
    };
    await page.goto(`${base}/map/${login}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 60_000 });
    await page.getByRole('heading', { name: login, exact: true, level: 2 }).waitFor({ timeout: 30_000 });
    const hide = page.getByRole('button', { name: 'Hide my channel' });
    await hide.waitFor({ timeout: 15_000 });
    await page.locator('.atlas-card-head [data-atlas-face="picture"]').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await shot('own-card', 'own card with the hide line');

    const preview = (await (await fetch(`${base}/map-data/v1/preview`)).json()).id;
    const publicCard = () => fetch(`${base}/map-data/v1/preview/${preview}/card/login/${login}?lookup=1`).then(r => r.status);
    const publicSearch = () => fetch(`${base}/map-data/v1/preview/${preview}/search?q=${login}&lookup=1`).then(r => r.json()).then(r => r.results.map(x => x.channel.login));
    check(await publicCard() === 200, `${width}: public card answers while shown`);

    const t0 = Date.now();
    await hide.click();
    await page.getByRole('button', { name: 'Show my channel' }).waitFor({ timeout: 10_000 });
    const hiddenMs = Date.now() - t0;
    check(await page.locator('[data-atlas-owner="hidden"]').count() === 1, `${width}: own hidden card is up`);
    check(await publicCard() === 404, `${width}: public card is gone at once`);
    check(!(await publicSearch()).includes(login), `${width}: public search no longer finds it`);
    await shot('hidden-card', 'own card while hidden');

    await page.getByRole('button', { name: 'Close card' }).click();
    if (!phone) {
      const input = page.getByRole('combobox', { name: 'Find a channel' });
      await input.pressSequentially(login.slice(0, 5), { delay: 120 });
      const own = page.getByRole('option').filter({ hasText: 'Hidden by you' });
      await own.waitFor({ timeout: 10_000 });
      await shot('own-search', 'search shows the owner their hidden channel');
      await own.click();
      await page.getByRole('button', { name: 'Show my channel' }).waitFor({ timeout: 10_000 });
    } else {
      // On a phone the address is the way back too.
      await page.goto(`${base}/map/${login}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 60_000 });
      await page.getByRole('button', { name: 'Show my channel' }).waitFor({ timeout: 20_000 });
    }
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Show my channel' }).click();
    await page.getByRole('button', { name: 'Hide my channel' }).waitFor({ timeout: 15_000 });
    const shownMs = Date.now() - t1;
    check(await publicCard() === 200, `${width}: public card is back`);
    await shot('shown-again', 'own public card back after showing');
    captures.push({ width, hiddenMs, shownMs });
    await context.close();
  }
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => undefined);
  await atlas(`/v1/channels/${ownerId}/unhide`, { method: 'POST', body: JSON.stringify({ version: 1, at: Date.now() }) }).catch(() => undefined);
  await release();
}
await writeFile(`${out}/am13-hide-shots.json`, `${JSON.stringify({ base, ownerId, login, captures, checks, errors }, null, 2)}\n`);
console.log(JSON.stringify({ captures, checks: checks.length, errors }, null, 2));
