/* global AbortSignal, clearTimeout */
// AM15: a channel the survey never saw is drawn on the map once found, and the key explains itself.
// For 1440x900 and 390x844: the default view (key closed), the key open, then search ATLAS_CHECK_LOGIN (default
// tobi4s_), fly, and check that its mark is drawn at its pencil place under the selection ring with the card open; then
// close the card (the mark stays), tap the mark (the card opens again), search a second channel outside the survey
// (both drawn at once) and reload (both drawn again from the session).
// ATLAS_CHECK_URL is the site (default: the lane's own preview), ATLAS_CHECK_NAME names the stills
// (am15-<name>-<what>-<width>.png) and the report (am15-<name>.json) in work/evidence/atlas-map/.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = (process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175').replace(/\/$/, '');
const login = process.env.ATLAS_CHECK_LOGIN ?? 'tobi4s_';
const second = process.env.ATLAS_CHECK_SECOND ?? 'zliifer';
const name = process.env.ATLAS_CHECK_NAME ?? 'local';
const widths = (process.env.ATLAS_CHECK_WIDTHS ?? '1440,390').split(',').map(Number);
const out = 'work/evidence/atlas-map';
const results = [], errors = [];
const check = (label, ok, detail) => { results.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) console.error(`FAIL ${label}`, detail ?? ''); };
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(600_000) });
let browser;
const deadline = setTimeout(() => { void browser?.close(); }, 280_000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const width of widths) {
    const phone = width < 600;
    const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${width}: ${e.message}`));
    const shot = (what) => page.screenshot({ path: `${out}/am15-${name}-${what}-${width}.png` });
    const ready = () => page.waitForSelector('[data-chatdom-atlas][data-atlas-ready="map"]', { timeout: 120_000 });
    const settle = async (ms = 2_500) => {
      await page.waitForFunction(() => window.__chatdomAtlas?.stats()?.flying === false, null, { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(ms);
    };
    const found = () => page.evaluate(() => window.__chatdomAtlas?.found?.() ?? []);
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await ready();
    await page.evaluate(() => document.fonts.ready);
    await settle(1_500);

    // The key, closed and open.
    const toggle = page.getByRole('button', { name: 'Map key', exact: true });
    check(`${width}: one worded Map key button, closed`, await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) === 'false');
    await shot('key-closed');
    await toggle.click();
    await page.waitForTimeout(900);
    const items = await page.locator('[data-atlas-key-item]').allInnerTexts();
    check(`${width}: the open key names seven marks in words`, items.length === 7 && items.every(text => text.split('\n').filter(Boolean).length >= 2), items);
    await shot('key-open');
    await page.keyboard.press('Escape');
    check(`${width}: Escape closes the key`, (await toggle.getAttribute('aria-expanded')) === 'false');

    // Search, fly, and land on a drawn mark.
    const search = async (who) => {
      const field = page.getByRole('combobox', { name: 'Find a channel' });
      await field.fill('');
      const answered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search') && new URL(r.url()).searchParams.get('q') === who, { timeout: 20_000 });
      await field.pressSequentially(who, { delay: 60 });
      const reply = await (await answered).json();
      const result = reply.results?.find(r => r.channel.login === who) ?? null;
      const row = page.getByRole('option').filter({ hasText: who }).first();
      await row.waitFor({ timeout: 10_000 });
      await row.click();
      await page.getByRole('heading', { name: who, exact: true, level: 2 }).waitFor({ timeout: 15_000 });
      await settle();
      return result;
    };
    const result = await search(login);
    const id = result?.channel.id;
    let marks = await found();
    const mark = marks.find(m => m.id === id);
    const card = await page.locator('.atlas-card').boundingBox();
    const view = page.viewportSize();
    const free = mark && card && (phone ? mark.y < card.y - 8 : mark.x < card.x - 8) && mark.x > 0 && mark.y > 0 && mark.x < view.width && mark.y < view.height;
    check(`${width}: ${login} is drawn at its place after the flight, clear of its card`, !!mark && free, { mark, card, place: result?.channel.place, position: result?.position });
    const kind = await page.locator('.atlas-card').getAttribute('data-kind');
    check(`${width}: its card and its mark agree on what it is`, !!mark && (mark.kind === 'kingdom') === (kind === 'kingdom'), { kind, mark });
    check(`${width}: no stand-in DOM flag over the moving map`, await page.locator('[data-atlas-pencil-place]').count() === 0);
    await shot('found-card');

    // The mark stays when the card closes, and a tap opens its card again.
    await page.locator('.atlas-card-close').click();
    await page.waitForTimeout(600);
    marks = await found();
    const stayed = marks.find(m => m.id === id);
    check(`${width}: the mark stays drawn once the card closes`, !!stayed, marks);
    if (stayed) {
      if (phone) await page.touchscreen.tap(stayed.x, stayed.y);
      else await page.mouse.click(stayed.x, stayed.y);
      const reopened = await page.getByRole('heading', { name: login, exact: true, level: 2 }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
      check(`${width}: tapping the mark opens its card`, reopened);
      if (reopened) await page.locator('.atlas-card-close').click();
    }
    if (!phone) await shot('found-closed');

    // A second channel outside the survey: both are drawn at once, and both come back after a reload.
    if (second) {
      const other = await search(second);
      marks = await found();
      check(`${width}: ${second} is drawn at its place too`, marks.some(m => m.id === other?.channel.id), marks);
      await shot('found-second');
      const kept = () => page.evaluate(() => window.__chatdomAtlas?.foundIds?.() ?? []);
      check(`${width}: several found channels are kept at once`, (await kept()).includes(id) && (await kept()).includes(other?.channel.id), await kept());
      const saved = await page.evaluate(() => window.sessionStorage.getItem('chatdom:atlas:found:v1'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ready();
      await settle(2_000);
      await page.waitForFunction((ids) => ids.every(i => (window.__chatdomAtlas?.foundIds?.() ?? []).includes(i)), [id, other?.channel.id].filter(Boolean), { timeout: 30_000 }).catch(() => undefined);
      const back = await kept();
      check(`${width}: a reload in the same tab finds them again`, back.includes(id) && back.includes(other?.channel.id), { saved, back });
      // Both stand on the map: at the whole map's view each found mark is drawn wherever it lies in view.
      await page.keyboard.press('Escape');
      await page.locator('.atlas-map').focus();
      await page.keyboard.press('0');
      await settle(1_500);
      marks = await found();
      check(`${width}: after the reload both are drawn on the whole map`, marks.some(m => m.id === id) && marks.some(m => m.id === other?.channel.id), marks);
      if (!phone) await shot('found-world');
    }
    await context.close();
  }
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  release();
}
const report = { at: new Date().toISOString(), base, login, second, results, errors, ok: errors.length === 0 && results.every(r => r.ok) };
await writeFile(`${out}/am15-${name}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, failed: results.filter(r => !r.ok), errors }, null, 2));
process.exit(report.ok ? 0 : 1);
