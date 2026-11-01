/* global getComputedStyle:readonly, NodeFilter:readonly, PointerEvent:readonly */
// Captures the citizen card and the passport as the panel carries them, on the SIMULATED night, under the shared capture
// lock: one owned Vite server for the panel and one Chrome, both closed before the lock is released.
//   node apps/panel/src/card/capture.mjs [--port 5173] [--before shots/card-passport/before]
// Shots land in shots/card-passport/panel/<name>@<w>x<h>.png with contact sheets, and before/after pairs when a
// before folder holds the same views. Console errors, off-host requests, overflow of the frame, text under 11.5 px and
// a turn that does not land or return focus fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5173);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/card-passport/panel`;
const before = option('--before') ? `${root}${option('--before')}` : `${root}shots/card-passport/before`;
const run = promisify(execFile);
const PANEL = [318, 496], PHONE = [390, 844];
const failures = [];
const report = { port, shots: [], console: [], external: [], checks: {} };

let server, browser, release;
try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/panel`, configFile: false, base: '/', logLevel: 'error', plugins: [solid()],
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });

  const open = async (state, [width, height] = PANEL, context = {}) => {
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...context });
    const page = await scope.newPage();
    page.on('close', () => { void scope.close(); });
    page.on('console', message => { if (message.type() === 'error') report.console.push(`${state}: ${message.text()}`); });
    page.on('pageerror', error => report.console.push(`${state}: ${error.message}`));
    // The Helper script is Twitch's; the simulated night never needs it. Every other request must stay on this host.
    await page.route('https://extension-files.twitch.tv/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', ''].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol) && url.hostname !== 'extension-files.twitch.tv') report.external.push(request.url()); });
    await page.goto(`http://127.0.0.1:${port}/panel.html?source=simulated&state=${state}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  const shot = async (page, name) => {
    const { width, height } = page.viewportSize();
    const path = `${output}/${name}@${width}x${height}.png`;
    await page.screenshot({ path });
    report.shots.push(path);
    return path;
  };
  const audit = page => page.evaluate(() => {
    let smallest = Infinity, where = '';
    const scope = document.querySelector('.cp-book-layer') ?? document.querySelector('.cp-drawer') ?? document.querySelector('.cp');
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest('svg')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < smallest) { smallest = size; where = node.textContent.trim().slice(0, 30); }
    }
    const frame = document.querySelector('.cp');
    const wide = [...frame.querySelectorAll('*')].filter(node => { const r = node.getBoundingClientRect(); return r.width && (r.right > window.innerWidth + .5 || r.left < -.5); })
      .filter(node => !node.closest('.cp-drawer[data-book], .pp-leaf, .pp-turning, .cpp-lamp'));
    return { smallest, where, overflow: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight
      ? 'document scrolls' : wide.slice(0, 3).map(node => node.className?.baseVal ?? node.className).join(' | ') };
  });
  const check = async (page, name) => {
    const result = await audit(page);
    report.checks[name] = result;
    if (result.smallest < 11.5) failures.push(`${name}: text at ${result.smallest}px ("${result.where}")`);
    if (result.overflow) failures.push(`${name}: overflow ${result.overflow}`);
  };
  const openCard = async page => {
    await page.click('.cp-nav .cp-tab:first-child');
    await page.waitForSelector('.cpc-face');
    await page.waitForFunction(() => [...document.querySelectorAll('.cpc img')].every(image => image.complete && image.naturalWidth > 0));
    // The keepsakes come from the passport's first read; wait for them, or for the book to say it is not shown.
    await page.waitForSelector('.cpc-keepsakes, .cpc-corner[aria-label*="private"]', { timeout: 30_000 });
    await page.waitForTimeout(400);
  };
  const turnToBook = async page => {
    await page.click('.cpc-corner');
    await page.waitForFunction(() => document.querySelector('.cp')?.dataset.book === 'open', {}, { timeout: 10_000 });
    await page.waitForSelector('.cpp .pp-book');
    await page.waitForTimeout(500);
  };

  // The first view: the lit plate now carries the portrait.
  for (const state of ['named', 'resting']) {
    const page = await open(state);
    await page.waitForTimeout(300);
    await shot(page, `first-${state}`);
    await check(page, `first-${state}`);
    await page.close();
  }

  // The card, its foot, mid-turn, the book, an open leaf, and back.
  {
    const page = await open('named');
    await openCard(page);
    await shot(page, 'card');
    await check(page, 'card');
    await page.evaluate(() => { const scroller = document.querySelector('.cp-drawer-page'); scroller.scrollTop = scroller.scrollHeight; });
    await page.waitForTimeout(200);
    await shot(page, 'card-foot');
    await page.evaluate(() => { document.querySelector('.cp-drawer-page').scrollTop = 0; });
    // Mid-turn: the page swinging away from its left edge over the leather.
    // Software rendering is slower than the turn, so the page is held at its middle: the panel's landing timer is
    // held back and the turn's animations are stopped at 300 ms, shot, then let go.
    await page.evaluate(() => {
      const real = window.setTimeout;
      window.__held = [];
      window.setTimeout = (callback, ms, ...rest) => ms === 560 ? (window.__held.push(callback), 0) : real(callback, ms, ...rest);
      window.__release = () => { window.setTimeout = real; window.__held.splice(0).forEach(callback => callback()); };
    });
    await page.click('.cpc-corner');
    await page.evaluate(() => document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 300; }));
    await shot(page, 'turning');
    await page.evaluate(() => { document.getAnimations().forEach(animation => animation.play()); window.__release(); });
    await page.waitForFunction(() => document.querySelector('.cp')?.dataset.book === 'open', {}, { timeout: 10_000 });
    await page.waitForTimeout(500);
    const focus = await page.evaluate(() => document.activeElement?.textContent?.trim());
    report.checks.bookFocus = focus;
    if (!/Your card/.test(focus ?? '')) failures.push(`book opened with focus on "${focus}"`);
    await shot(page, 'passport-cover');
    await check(page, 'passport-cover');
    await page.keyboard.press('Tab');
    await page.click('.pp-cover');
    await page.waitForTimeout(700);
    await shot(page, 'passport-flyleaf');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
    await shot(page, 'passport-journey');
    await check(page, 'passport-journey');
    // Escape lays the card back over the book, and focus returns to the corner it was turned from.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.cp')?.dataset.book === 'shut', {}, { timeout: 10_000 });
    await page.waitForTimeout(150);
    const back = await page.evaluate(() => document.activeElement?.className);
    report.checks.returnFocus = back;
    if (!String(back).includes('cpc-corner')) failures.push(`closing the book left focus on "${back}"`);
    await shot(page, 'card-again');
    await page.close();
  }

  // Touch: a swipe to the left across the card turns to the book.
  {
    const page = await open('named', PANEL, { hasTouch: true, isMobile: false });
    await openCard(page);
    const box = await page.locator('.cpc-face').boundingBox();
    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const fire = (type, cx) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: cx, clientY: y }));
      fire('pointerdown', x); fire('pointerup', x - 90);
    }, { x: box.x + box.width - 20, y: box.y + 40 });
    await page.waitForFunction(() => document.querySelector('.cp')?.dataset.book === 'open', {}, { timeout: 10_000 }).catch(() => failures.push('a swipe did not turn to the book'));
    report.checks.swipe = await page.evaluate(() => document.querySelector('.cp')?.dataset.book);
    await page.close();
  }

  // Reduced motion: the page turns at once, nothing animates, the book still opens.
  {
    const page = await open('named', PANEL, { reducedMotion: 'reduce' });
    await openCard(page);
    await page.click('.cpc-corner');
    const at = await page.evaluate(() => document.querySelector('.cp')?.dataset.book);
    report.checks.reducedMotion = at;
    if (at !== 'open') failures.push(`reduced motion turned to "${at}" instead of open`);
    await page.close();
  }

  // Variants: a guest's card, the longest names, the phone sheet.
  for (const [state, size, name] of [['guest', PANEL, 'card-guest'], ['long-names', PANEL, 'card-long-names'], ['named', PHONE, 'card-phone']]) {
    const page = await open(state, size);
    await openCard(page);
    await shot(page, name);
    await check(page, name);
    if (name === 'card-phone') {
      await turnToBook(page);
      await page.click('.pp-cover');
      await page.waitForTimeout(600);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      await shot(page, 'passport-phone');
    }
    await page.close();
  }

  // Contact sheet and before/after pairs of the same views.
  const sheet = async (name, files, rows = 1) => {
    const inputs = files.flatMap(file => ['-i', file]);
    const per = Math.ceil(files.length / rows);
    const layout = files.map((_, i) => `${(i % per) === 0 ? '0' : Array.from({ length: i % per }, (_, j) => `w${j}`).join('+')}_${Math.floor(i / per) === 0 ? '0' : Array.from({ length: Math.floor(i / per) }, (_, j) => `h${j * per}`).join('+')}`).join('|');
    await run('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}:fill=#120b07`, `${output}/${name}`]);
    report.shots.push(`${output}/${name}`);
  };
  const p = name => `${output}/${name}@318x496.png`;
  await sheet('contact@318x496.png', ['first-named', 'card', 'card-foot', 'turning', 'passport-cover', 'passport-flyleaf', 'passport-journey', 'card-guest', 'card-long-names', 'first-resting'].map(p), 2);
  const exists = path => access(path).then(() => true, () => false);
  const pairs = [['panel-named@318x496.png', p('first-named')], ['panel-home@318x496.png', p('card')], ['panel-home-scrolled@318x496.png', p('card-foot')], ['passport-many@318x496.png', p('passport-cover')], ['passport-many-v2@318x496.png', p('passport-journey')]];
  // Top row the panel as it was, bottom row the same views now.
  const was = [], now = [];
  for (const [old, current] of pairs) if (await exists(`${before}/${old}`)) { was.push(`${before}/${old}`); now.push(current); }
  if (was.length) await sheet('before-after@318x496.png', [...was, ...now], 2).catch(error => failures.push(`before/after sheet: ${error.message}`));

  if (report.console.length) failures.push(`console: ${report.console.join(' | ')}`);
  if (report.external.length) failures.push(`external requests: ${report.external.join(' | ')}`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
report.failures = failures;
await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ shots: report.shots.length, checks: report.checks, failures }, null, 2));
if (failures.length) process.exitCode = 1;
