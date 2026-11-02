// The launch walk: chatdom.io as a first-time visitor, in headless Chrome, at the laptop and the phone size.
//
//   node work/lanes/launch/walk.mjs [--target https://chatdom.io] [--only front,map,...] [--sizes 1440x900,390x844]
//
// Each step loads like a stranger would (a fresh context, no cookies), does the one thing the step is about, and
// records what a visitor could trip over: console errors, uncaught page errors, failed or erroring requests to our
// origin, and developer words on screen (staged-data labels, stack traces, raw JSON, test names, undefined/NaN).
// Stills go to shots/launch/<step>@<w>x<h>.png and a JSON report to shots/launch/walk.json. Reading chatdom.io as a
// visitor is all it does: it never signs in, posts or writes anything.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const target = option('--target', 'https://chatdom.io').replace(/\/$/, '');
const only = option('--only', '')?.split(',').filter(Boolean) ?? [];
const sizes = option('--sizes', '1440x900,390x844').split(',').map(size => size.split('x').map(Number));
const KINGDOM = option('--kingdom', '129634568');
const LOGIN = option('--login', 'tobi4s_');
const root = resolve(import.meta.dirname, '../../..');
const out = join(root, 'shots/launch');

// Words a visitor should never read. Each hit is reported with its context, to be judged by a person.
const DEV_WORDS = /\bSIMULATED\b|\bsimulated\b|lorem|ipsum|\bTODO\b|\bFIXME\b|fixture|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|Error:|at [\w.$<>]+ \(|localhost|127\.0\.0\.1|\btest[-_ ]?channel\b|\bbench\b|\bdebug\b|\bstub\b|\bmock\b|\bplaceholder\b|\{"[a-zA-Z]+":/;

const steps = {
  async front(page) {
    await page.goto(`${target}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  },
  async story(page) {
    await page.goto(`${target}/`, { waitUntil: 'networkidle' });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) { await page.evaluate(top => window.scrollTo(0, top), y); await page.waitForTimeout(120); }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.45));
    await page.waitForTimeout(800);
  },
  async howitworks(page) {
    await page.goto(`${target}/how-it-works`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
  },
  async map(page) {
    await page.goto(`${target}/map`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2000);
  },
  async search(page, notes) {
    await page.goto(`${target}/map`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 }).catch(() => {});
    const input = page.locator('.atlas-search input[type=search]');
    await input.click();
    await input.fill(LOGIN);
    await page.waitForSelector('.atlas-search-result, .atlas-search[data-phase="none"], .atlas-search-state', { timeout: 20_000 });
    await page.waitForTimeout(1200);
    notes.push(`search phase: ${await page.locator('.atlas-search').getAttribute('data-phase')}`);
    const door = page.locator('.atlas-search-door');
    if (await door.count()) notes.push(`search offers: ${await door.textContent()} -> ${await door.getAttribute('href')}`);
  },
  async card(page, notes) {
    await page.goto(`${target}/map/${LOGIN}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForSelector('.atlas-door, .atlas-card', { timeout: 30_000 }).catch(() => notes.push('no card opened from /map/<login>'));
    await page.waitForTimeout(2500);
    notes.push(`enter link: ${await page.locator('.atlas-door').first().getAttribute('href').catch(() => 'none')}`);
  },
  // A stranger lands on /map cold: what can they act on after three seconds, and how many clicks to a kingdom?
  async coldmap(page, notes, size) {
    const started = Date.now();
    await page.goto(`${target}/map`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(Math.max(0, 3000 - (Date.now() - started)));
    await page.screenshot({ path: join(out, `coldmap-3s@${size}.png`) }).catch(() => {});
    const visible = await page.evaluate(() => [...document.querySelectorAll('a, button, input')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && window.getComputedStyle(el).visibility !== 'hidden'; })
      .map(el => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(Boolean));
    notes.push(`at 3 s: ${visible.join(' · ')}`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 }).catch(() => notes.push('map never said ready'));
    notes.push(`ready after ${((Date.now() - started) / 1000).toFixed(1)} s`);
    await page.locator('.atlas-search input[type=search]').waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => notes.push(`search field visible after ${((Date.now() - started) / 1000).toFixed(1)} s`))
      .catch(() => notes.push('search field never visible in 60 s'));
    notes.push(`survey seal: ${(await page.locator('.atlas-survey-seal').innerText().catch(() => 'none')).replace(/\s+/g, ' ')}`);
    const way = page.locator('a[href^="/kingdom/"], a[href*="walk=1"]').filter({ visible: true });
    notes.push(`visible ways in after ready: ${(await way.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).join(' · ') || 'none'}`);
  },
  // The whole way from a cold /map to the walk-in gate, as a stranger clicks it: search, the row, Enter on the card.
  async coldpath(page, notes) {
    const started = Date.now(), at = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
    let clicks = 0;
    await page.goto(`${target}/map`, { waitUntil: 'domcontentloaded' });
    const input = page.locator('.atlas-search input[type=search]');
    await input.waitFor({ state: 'visible', timeout: 90_000 });
    await input.click(); clicks++;
    await input.pressSequentially(LOGIN, { delay: 60 });
    const row = page.locator('.atlas-search-result').first();
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    notes.push(`row at ${at()}: ${(await row.innerText()).replace(/\s+/g, ' ')}`);
    await row.click(); clicks++;
    const enter = page.locator('a[href^="/kingdom/"]').filter({ visible: true }).first();
    await enter.waitFor({ state: 'visible', timeout: 30_000 });
    notes.push(`card at ${at()}: ${(await enter.innerText()).replace(/\s+/g, ' ')}`);
    await enter.click(); clicks++;
    await page.waitForSelector('.ke-gate[data-gate]', { timeout: 60_000 });
    await page.waitForTimeout(3000);
    notes.push(`gate at ${at()} after ${clicks} clicks and the login typed: ${await page.locator('.ke-gate').getAttribute('data-gate')} at ${page.url().slice(target.length)}`);
  },
  async kingdom(page, notes) {
    const started = Date.now();
    await page.goto(`${target}/kingdom/${KINGDOM}`, { waitUntil: 'domcontentloaded' });
    // A founded kingdom hands a visitor over to its walk-in gate: signed out, the gate asks for Twitch.
    await page.waitForURL(/[?&]walk=1/, { timeout: 30_000 }).catch(() => notes.push('no hand-over to the walk-in gate'));
    await page.waitForSelector('.ke-gate[data-gate]', { timeout: 60_000 }).catch(() => notes.push('no gate drawn'));
    await page.waitForTimeout(4000);
    notes.push(`after ${((Date.now() - started) / 1000).toFixed(1)} s at ${page.url().slice(target.length)}, gate ${await page.locator('.ke-gate').getAttribute('data-gate').catch(() => 'none')}`);
  },
  async panel(page) {
    await page.goto(`${target}/panel`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);
  },
  async stream(page) {
    await page.goto(`${target}/stream?kingdom=${KINGDOM}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(4000);
  },
  async gate(page) {
    await page.goto(`${target}/?walk=1&kingdom=${KINGDOM}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
  },
  async choose(page) {
    await page.goto(`${target}/stream`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
  },
  async legal(page) {
    await page.goto(`${target}/privacy`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  },
  async missing(page) {
    await page.goto(`${target}/kingdom/no-such-place`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
  },
  // Failures a stranger can reach by a stale link or a refused Twitch sign-in: each must read as a calm, worded state.
  async expired(page) {
    await page.goto(`${target}/?signin=expired`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  },
  async forgeexpired(page) {
    await page.goto(`${target}/?walk=1&kingdom=${KINGDOM}&forgeChat=expired`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
  },
  async walknowhere(page) {
    await page.goto(`${target}/?walk=1&kingdom=999999999999`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
  },
  async kingdomunknown(page) {
    await page.goto(`${target}/kingdom/999999999999`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);
  },
  async mapnowhere(page, notes) {
    await page.goto(`${target}/map/zz_no_such_channel_zz`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    notes.push(`card: ${(await page.locator('.atlas-card, .atlas-search-state').first().innerText().catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 160)}`);
  },
};

const chosen = only.length ? only : Object.keys(steps);
await mkdir(out, { recursive: true });
const release = await acquireCaptureLock();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const report = [];
try {
  for (const name of chosen) {
    for (const [width, height] of sizes) {
      const phone = width < 600;
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone,
        userAgent: phone ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined });
      const page = await context.newPage();
      const entry = { step: name, size: `${width}x${height}`, console: [], errors: [], requests: [], words: [], notes: [] };
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) entry.console.push(`${message.type()}: ${message.text().slice(0, 300)}`); });
      page.on('pageerror', error => entry.errors.push(String(error.stack ?? error).slice(0, 400)));
      page.on('requestfailed', request => { if (request.url().startsWith(target)) entry.requests.push(`failed ${request.url().slice(target.length)} ${request.failure()?.errorText}`); });
      page.on('response', response => { if (response.url().startsWith(target) && response.status() >= 400) entry.requests.push(`${response.status()} ${response.url().slice(target.length)}`); });
      const started = Date.now();
      try { await steps[name](page, entry.notes, `${width}x${height}`); } catch (error) { entry.notes.push(`step failed: ${String(error.message ?? error).split('\n')[0]}`); }
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      for (const line of text.split('\n')) if (DEV_WORDS.test(line)) entry.words.push(line.trim().slice(0, 200));
      entry.title = await page.title().catch(() => '');
      entry.url = page.url();
      entry.seconds = Math.round((Date.now() - started) / 100) / 10;
      await page.screenshot({ path: join(out, `${name}@${width}x${height}.png`), timeout: 90_000 }).catch(error => entry.notes.push(`no still: ${error.message}`));
      report.push(entry);
      await writeFile(join(out, 'walk.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`${name}@${width}x${height}: ${entry.seconds}s console=${entry.console.length} errors=${entry.errors.length} requests=${entry.requests.length} words=${entry.words.length} ${entry.notes.join(' | ')}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await release();
  await writeFile(join(out, 'walk.json'), `${JSON.stringify(report, null, 2)}\n`);
}
