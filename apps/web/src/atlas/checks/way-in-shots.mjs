/* global AbortSignal, clearTimeout */
// AM15 (3): the map leads into the game. For 1440x900 and 390x844, from a browser that has never opened the map:
// the opening caption and the always-visible way in ("Walk into a kingdom", leading to the door's first founded
// kingdom); a return visit without the caption; a founded kingdom's card leading with "Enter <name>"; a waiting
// channel's card with "Visit <kingdom>" as its next step; and the click count from a cold /map to the walk page.
// ATLAS_CHECK_URL is the site (default: the lane's own preview), ATLAS_CHECK_NAME names the stills
// (am15-<name>-<what>-<width>.png) and the report (am15-<name>-way-in.json) in work/evidence/atlas-map/.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = (process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175').replace(/\/$/, '');
const login = process.env.ATLAS_CHECK_LOGIN ?? 'tobi4s_';
const waiting = process.env.ATLAS_CHECK_SECOND ?? 'zliifer';
const name = process.env.ATLAS_CHECK_NAME ?? 'local';
const widths = (process.env.ATLAS_CHECK_WIDTHS ?? '1440,390').split(',').map(Number);
const OPENING = 'Every Twitch channel is a kingdom on this map. Step into one.';
const out = 'work/evidence/atlas-map';
const results = [], errors = [];
const check = (label, ok, detail) => { results.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) console.error(`FAIL ${label}`, detail ?? ''); };
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(600_000) });
let browser;
const deadline = setTimeout(() => { void browser?.close(); }, 280_000);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  // The door names the kingdom the way in leads to.
  const door = await fetch(`${base}/api/public/door`, { headers: { Accept: 'application/json' } }).then(r => r.json()).catch(() => null);
  const first = door?.mode === 'live' ? door.kingdoms?.[0] ?? null : null;
  check('the door names a founded kingdom', !!first, door);
  const walk = first ? `/?walk=1&kingdom=${first.kingdomId}` : null;
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
    /** The element is in the viewport and nothing stands over its middle. */
    const uncovered = (selector) => page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { ok: false, why: 'missing' };
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      const top = document.elementFromPoint(x, y);
      const inView = box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth;
      return { ok: inView && !!top && element.contains(top), box: { x: box.left, y: box.top, w: box.width, h: box.height } };
    }, selector);
    const wayIn = page.locator('[data-atlas-walk="way-in"]');

    // A first visit: the caption and the way in.
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await ready();
    await page.evaluate(() => document.fonts.ready);
    await settle(1_500);
    await wayIn.waitFor({ timeout: 15_000 }).catch(() => undefined);
    const opening = page.locator('[data-atlas-chrome="opening"]');
    check(`${width}: a first visit reads the opening caption`, await opening.isVisible() && (await opening.innerText()).includes(OPENING), await opening.innerText().catch(() => null));
    check(`${width}: the way in is on the title plate`, await wayIn.isVisible() && (await wayIn.innerText()).includes('Walk into a kingdom') && (!first || (await wayIn.innerText()).includes(first.name)), await wayIn.innerText().catch(() => null));
    check(`${width}: the way in walks into the founded kingdom`, (await wayIn.getAttribute('href')) === walk, await wayIn.getAttribute('href'));
    check(`${width}: nothing covers the way in or the caption`, (await uncovered('[data-atlas-walk="way-in"]')).ok && (await uncovered('[data-atlas-chrome="opening"]')).ok);
    await shot('opening');

    // A return visit opens quietly, and the way in stays.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await settle(1_200);
    check(`${width}: a return visit has no caption`, await opening.count() === 0);
    check(`${width}: the way in stays on a return visit`, await wayIn.isVisible());

    const search = async (who) => {
      const field = page.getByRole('combobox', { name: 'Find a channel' });
      await field.fill('');
      const answered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search') && new URL(r.url()).searchParams.get('q') === who, { timeout: 40_000 });
      await field.pressSequentially(who, { delay: 60 });
      await answered;
      const row = page.getByRole('option').filter({ hasText: who }).first();
      await row.waitFor({ timeout: 20_000 });
      await row.click();
      await page.getByRole('heading', { name: who, exact: true, level: 2 }).waitFor({ timeout: 15_000 });
      await settle();
    };
    // A founded kingdom's card leads with its way in.
    await search(login);
    const card = page.locator('.atlas-card');
    const enter = card.locator('[data-atlas-walk="enter"]');
    const kind = await card.getAttribute('data-kind');
    check(`${width}: ${login}'s card is a Chatdom kingdom`, kind === 'kingdom', kind);
    const enterText = (await enter.innerText().catch(() => '')).split('\n')[0];
    check(`${width}: its first action is "Enter ${first?.name}"`, enterText === `Enter ${first?.name}` && (await enter.getAttribute('href')) === walk, enterText);
    const order = await page.evaluate(() => {
      const card = document.querySelector('.atlas-card');
      const links = [...(card?.querySelectorAll('a, button:not(.atlas-card-close)') ?? [])];
      return links[0]?.getAttribute('data-atlas-walk') ?? links[0]?.textContent ?? null;
    });
    check(`${width}: "Enter" comes before every other action on the card`, order === 'enter', order);
    const big = await enter.boundingBox();
    const watch = await card.locator('.atlas-card-actions .atlas-watch').first().boundingBox();
    check(`${width}: "Enter" is the biggest action`, !!big && !!watch && big.height > watch.height && big.width >= watch.width, { big, watch });
    check(`${width}: "Enter" is in view, uncovered`, (await uncovered('.atlas-card [data-atlas-walk="enter"]')).ok);
    check(`${width}: the way in stays put with a card open`, (await uncovered('[data-atlas-walk="way-in"]')).ok);
    await shot('enter-card');

    // A waiting channel's card has a next step.
    await search(waiting);
    const visit = card.locator('[data-atlas-walk="visit"]');
    check(`${width}: ${waiting}'s card is waiting`, (await card.getAttribute('data-kind')) === 'waiting');
    check(`${width}: its next step is "Visit ${first?.name}"`, (await visit.innerText().catch(() => '')).trim() === `Visit ${first?.name}` && (await visit.getAttribute('href')) === walk, await visit.innerText().catch(() => null));
    check(`${width}: the next step is in view, uncovered`, (await uncovered('.atlas-card [data-atlas-walk="visit"]')).ok);
    await shot('visit-card');
    await context.close();

    // Count the clicks from a cold /map to the kingdom's gate.
    const cold = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
    const coldPage = await cold.newPage();
    await coldPage.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    const coldWay = coldPage.locator('[data-atlas-walk="way-in"]');
    await coldWay.waitFor({ timeout: 120_000 });
    const started = Date.now();
    await Promise.all([coldPage.waitForURL(url => url.search.includes('walk=1'), { timeout: 20_000 }), phone ? coldWay.tap() : coldWay.click()]);
    const landed = new URL(coldPage.url());
    check(`${width}: one click from a cold /map to ${first?.name}'s gate`, `${landed.pathname}${landed.search}` === walk, { url: coldPage.url(), ms: Date.now() - started });
    await cold.close();
  }
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  release();
}
const report = { at: new Date().toISOString(), base, login, waiting, results, errors, ok: errors.length === 0 && results.every(r => r.ok) };
await writeFile(`${out}/am15-${name}-way-in.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, failed: results.filter(r => !r.ok), errors }, null, 2));
process.exit(report.ok ? 0 : 1);
