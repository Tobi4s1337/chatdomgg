/* global AbortSignal, clearTimeout, innerHeight, innerWidth */
// Capture real Atlas results: set ATLAS_FACE_LIVE, ATLAS_FACE_OFFLINE and ATLAS_FACE_STALE to public logins.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.1:5175';
const out = 'work/evidence/atlas-map';
const logins = { live: process.env.ATLAS_FACE_LIVE, offline: process.env.ATLAS_FACE_OFFLINE, stale: process.env.ATLAS_FACE_STALE };
for (const [kind, login] of Object.entries(logins)) {
  if (!login || !/^[a-z0-9_]{1,25}$/.test(login)) throw new Error(`Set ATLAS_FACE_${kind.toUpperCase()} to a lowercase Twitch login`);
}
const errors = [];
const captures = [];
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60_000) });
let browser;
// A stalled service must not hold the shared capture slot for five minutes.
const deadline = setTimeout(() => { void browser?.close(); }, 270_000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390 });
    page.on('pageerror', error => errors.push({ width, message: error.message }));
    for (const [kind, login] of Object.entries(logins)) {
      const responsePromise = page.waitForResponse(response => /\/card\//.test(new URL(response.url()).pathname) && response.ok(), { timeout: 45_000 });
      await page.goto(`${base}/map/${encodeURIComponent(login)}`, { waitUntil: 'domcontentloaded' });
      const response = await responsePromise;
      const card = await response.json();
      if (card.channel?.login !== login || !card.channel?.name) throw new Error(`${kind}: register answered for another or unnamed channel`);
      if (kind === 'live' && card.stream?.live !== true) throw new Error(`${login}: register did not report a live stream`);
      if (kind === 'offline' && card.stream?.live === true) throw new Error(`${login}: register reported a live stream`);
      if (kind === 'stale' && card.portrait && card.portrait.freshUntil > Date.now()) throw new Error(`${login}: register supplied a fresh portrait`);
      await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 45_000 });
      await page.getByRole('heading', { name: card.channel.name, exact: true, level: 2 }).waitFor({ timeout: 25_000 });
      await page.locator('.atlas-card .atlas-register-stream').waitFor({ timeout: 25_000 });
      const face = page.locator(`.atlas-card-head [data-atlas-face="${kind === 'stale' ? 'shield' : 'picture'}"]`);
      await face.waitFor({ timeout: 25_000 });
      if (kind === 'stale' && await face.locator('img').count()) throw new Error(`${login}: stale shield still contains an image`);
      if (kind !== 'stale') {
        const image = face.locator('img');
        if (!(await image.evaluate(el => el.complete && el.naturalWidth > 0))) throw new Error(`${login}: image was not decoded`);
        if (await image.getAttribute('src') !== card.portrait?.url) throw new Error(`${login}: picture does not match register`);
      }
      const visible = await page.locator('.atlas-card-head').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
      });
      if (!visible) throw new Error(`${login}: card header is outside the viewport`);
      await page.evaluate(() => document.fonts.ready);
      const state = await page.locator('.atlas').evaluate(el => ({ preview: el.getAttribute('data-preview'), revision: el.getAttribute('data-revision'), asOf: el.getAttribute('data-as-of'), liveAsOf: el.getAttribute('data-live-as-of'), renderer: el.getAttribute('data-state') }));
      if (state.renderer !== 'still') throw new Error(`${login}: renderer is not still`);
      const frameLive = await page.locator('.atlas-card-live').getAttribute('data-live').catch(() => null);
      const path = `${out}/am10-face-${kind}-${width}.png`;
      const png = await page.screenshot();
      if (png.length >= 2_000_000) throw new Error(`${path}: PNG exceeds 2 MB`);
      await writeFile(path, png);
      captures.push({ path, kind, login, channelId: card.channel.id, name: card.channel.name, preview: card.preview, servedAt: card.servedAt, registerAsOf: card.asOf, registerStreamLive: card.stream?.live ?? null, frameLive, ...state });
    }
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 45_000 });
    const query = logins.live.slice(0, 3);
    const searchResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/search') && response.ok(), { timeout: 25_000 });
    await page.getByRole('combobox', { name: 'Find a channel' }).fill(query);
    const result = await (await searchResponse).json();
    if (result.results.length < 2) throw new Error(`${query}: register returned fewer than two search rows`);
    await page.locator('.atlas-search[data-phase="results"] .atlas-search-result').nth(1).waitFor({ timeout: 25_000 });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.atlas-search-result')];
      return rows.length >= 2 && rows.every(row => {
        const seal = row.querySelector('[data-atlas-face]');
        const image = seal?.querySelector('img');
        return seal && (!image || (seal.getAttribute('data-atlas-face') === 'picture' && image.complete && image.naturalWidth > 0));
      });
    }, null, { timeout: 25_000 });
    const path = `${out}/am10-face-search-${width}.png`;
    const png = await page.screenshot();
    if (png.length >= 2_000_000) throw new Error(`${path}: PNG exceeds 2 MB`);
    await writeFile(path, png);
    captures.push({ path, kind: 'search', query, preview: result.preview, servedAt: result.servedAt, registerAsOf: result.asOf, logins: result.results.map(row => row.channel.login), renderer: 'still' });
    await page.close();
  }
  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`);
  const metadata = `${out}/am10-face-shots.json`;
  await writeFile(metadata, JSON.stringify({ capturedAt: new Date().toISOString(), captures, pageErrors: errors }, null, 2) + '\n');
  console.log(`Captured ${captures.length} real Atlas views; metadata: ${metadata}`);
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await release();
}
