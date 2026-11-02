/* global AbortSignal, clearTimeout, performance */
// AM14: search a channel the survey never saw on a served Atlas and open its card, at 1440x900 and 390x844.
// ATLAS_CHECK_URL is the site (default: the lane's own preview; after the deploy, https://chatdom.io).
// ATLAS_CHECK_LOGIN is the channel (default tobi4s_), ATLAS_CHECK_NAME names the stills (am14-<name>-<what>-<width>.png).
// Writes the timings and what each reply said to work/evidence/atlas-map/am14-<name>.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = (process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175').replace(/\/$/, '');
const login = process.env.ATLAS_CHECK_LOGIN ?? 'tobi4s_';
const name = process.env.ATLAS_CHECK_NAME ?? 'local';
const out = 'work/evidence/atlas-map';
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(600_000) });
let browser;
const deadline = setTimeout(() => { void browser?.close(); }, 240_000);
const runs = [], errors = [], twitchCalls = [];
let failed = false;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const width of [1440, 390]) {
    const phone = width === 390;
    const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
    page.on('pageerror', e => errors.push(`${width}: ${e.message}`));
    page.on('request', r => { if (/api\.twitch\.tv|id\.twitch\.tv/.test(r.url())) twitchCalls.push(r.url()); });
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-chatdom-atlas][data-atlas-ready="map"], [data-chatdom-atlas][data-atlas-ready="still"]', { timeout: 90_000 });
    await page.evaluate(() => document.fonts.ready);
    const field = page.getByRole('combobox', { name: 'Find a channel' });
    const searched = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search') && new URL(r.url()).searchParams.get('q') === login, { timeout: 20_000 });
    await field.pressSequentially(login, { delay: 90 });
    const typed = performance.now();
    const reply = await searched;
    const search = await reply.json();
    const result = search.results?.find(r => r.channel.login === login) ?? null;
    const row = page.getByRole('option').filter({ hasText: login }).first();
    await row.waitFor({ timeout: 10_000 });
    const rowShown = performance.now();
    const cardRead = page.waitForResponse(r => /\/card\//.test(new URL(r.url()).pathname), { timeout: 20_000 });
    const pressed = performance.now();
    await row.click();
    const card = await (await cardRead).json();
    await page.getByRole('heading', { name: login, exact: true, level: 2 }).waitFor({ timeout: 10_000 });
    const cardShown = performance.now();
    // The flight, the seal and the close land's tiles settle (SwiftShader bakes them slowly).
    await page.waitForTimeout(Number(process.env.ATLAS_CHECK_SETTLE_MS ?? 6_000));
    const text = await page.locator('.atlas-card').innerText();
    const shot = `${out}/am14-${name}-card-${width}.png`;
    await page.screenshot({ path: shot });
    const run = {
      width, shot, search: { status: reply.status(), place: result?.channel.place ?? null, position: result?.position ?? null, average: result?.average ?? null, unavailable: search.unavailable ?? null },
      card: { place: card.channel?.place ?? null, tier: card.channel?.tier ?? null, position: card.position ?? null, live: card.stream?.live ?? null, game: card.stream?.game ?? null },
      ms: { typedToRow: Math.round(rowShown - typed), pressToCard: Math.round(cardShown - pressed), typedToCard: Math.round(cardShown - typed) },
      pencil: await page.locator('[data-atlas-pencil-place]').count(), cardText: text.replace(/\s+/g, ' ').slice(0, 240),
    };
    runs.push(run);
    if (!result?.position || run.search.place !== 'waiting' && run.search.place !== 'mapped') failed = true;
    if (JSON.stringify(run.card.position) !== JSON.stringify(run.search.position)) failed = true;
    await page.close();
  }
} catch (error) {
  failed = true;
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  release();
}
if (twitchCalls.length) failed = true;
const report = { at: new Date().toISOString(), base, login, runs, errors, browserTwitchCalls: twitchCalls.length, ok: !failed && errors.length === 0 };
await writeFile(`${out}/am14-${name}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
