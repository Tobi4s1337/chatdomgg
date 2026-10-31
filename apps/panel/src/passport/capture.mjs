/* global URLSearchParams:readonly, getComputedStyle:readonly, NodeFilter:readonly, PointerEvent:readonly */
// Builds the passport panel bench the way the Extension is built (relative base, nothing inlined) and captures it at
// the panel's 318 x 496 under the shared capture lock: one owned preview server and one Chrome, both closed before
// the lock is released. SIMULATED fixtures only.
//   node apps/panel/src/passport/capture.mjs [--port 5184]
// Shots land in shots/passport-panel/<name>@318x496.png with a contact sheet; console errors, off-host requests,
// overflow, text under 12 px and any leaf whose words must scroll to be read fail the run.
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import solid from 'vite-plugin-solid';
import { execFile } from 'node:child_process';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5184);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const panel = `${root}apps/panel`;
const outDir = '/tmp/chatdom-passport-panel-bench';
const output = `${root}shots/passport-panel`;
const run = promisify(execFile);
const SIZE = [318, 496];
// Words that belong to the SIMULATED holders and their travels; none may reach a private or unread book.
const PRIVATE_WORDS = ['Pellam', 'Rook', 'Hollowmere', 'Copperleaf', 'Brindlewick', 'Maple Wren', 'Raid', 'Journeys', 'Kingdoms'];

let server, browser, release;
const report = { port, build: {}, shots: [], console: [], external: [], checks: {} };
try {
  release = await acquireCaptureLock();
  const config = { root: panel, configFile: false, base: './', logLevel: 'warn', plugins: [solid()] };
  await build({ ...config, build: { outDir, emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, minify: false, modulePreload: { polyfill: false },
    rolldownOptions: { input: { bench: `${panel}/src/passport/bench.html` } } } });
  let bytes = 0;
  const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else bytes += (await stat(path)).size; } };
  await walk(outDir);
  report.build = { outDir, kilobytes: Math.round(bytes / 1024) };
  server = await preview({ ...config, build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
  const base = `http://127.0.0.1:${port}/src/passport/bench.html`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });

  const open = async (query, context = {}) => {
    const scope = await browser.newContext({ viewport: { width: SIZE[0], height: SIZE[1] }, deviceScaleFactor: 1, ...context });
    scope.on('response', response => { if (response.status() >= 400) report.console.push(`${JSON.stringify(query)}: ${response.status()} ${response.url()}`); });
    const page = await scope.newPage();
    page.on('close', () => { void scope.close(); });
    page.on('console', message => { if (message.type() === 'error') report.console.push(`${JSON.stringify(query)}: ${message.text()}`); });
    page.on('pageerror', error => report.console.push(`${JSON.stringify(query)}: ${error.message}`));
    page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', ''].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) report.external.push(request.url()); });
    await page.goto(`${base}?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 180_000 });
    return page;
  };
  /** Smallest visible text, overflow of the slot, and whether the open leaf's words need scrolling. */
  const audit = page => page.evaluate(() => {
    let smallest = Infinity, where = '';
    const view = document.querySelector('.cpp');
    const walker = document.createTreeWalker(view ?? document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest('svg')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < smallest) { smallest = size; where = node.textContent.trim().slice(0, 30); }
    }
    const body = document.querySelector('.pp-page-body');
    return {
      smallest, where,
      overflow: document.documentElement.scrollWidth > window.innerWidth || (view ? view.scrollWidth > view.clientWidth : false)
        ? [...(view ?? document.body).querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > window.innerWidth + .5).map(node => node.className?.baseVal ?? node.className).slice(0, 4).join(' | ') || 'page'
        : '',
      scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
      where_: document.querySelector('.pp-where')?.textContent ?? '',
    };
  });
  const shoot = async (page, name) => {
    // The turning leaf has settled and removed itself before the picture is taken.
    await page.waitForFunction(() => !document.querySelector('.pp-leaf'), {}, { timeout: 10_000 });
    await page.waitForTimeout(450);
    const path = `${output}/${name}@${SIZE.join('x')}.png`;
    await page.screenshot({ path });
    const result = await audit(page);
    if (result.overflow) report.console.push(`${name}: overflow (${result.overflow})`);
    if (result.smallest < 12) report.console.push(`${name}: text at ${result.smallest}px ("${result.where}")`);
    report.shots.push({ name, path: path.slice(root.length), smallestText: result.smallest, leafScrolls: result.scrolls, at: result.where_ });
    console.log(`Captured ${name}.`);
  };
  /** Turn forward until the open leaf satisfies `test`, at most `limit` turns. */
  const turnUntil = async (page, test, limit = 120) => {
    for (let i = 0; i < limit; i++) {
      if (await page.evaluate(test)) return true;
      await page.click('.pp-turn[data-dir="next"]');
      await page.waitForTimeout(30);
    }
    return false;
  };

  // The many-journeys book: closed on the walnut, its flyleaf, its first journey, its longest and non-Latin names, its kingdoms.
  {
    const page = await open({ fixture: 'many', view: '0' });
    await shoot(page, 'many-cover');
    await page.click('.pp-cover');
    await shoot(page, 'many-flyleaf');
    await page.click('.pp-turn[data-dir="next"]');
    await shoot(page, 'many-journey');
    if (!(await turnUntil(page, () => /Long-Ridge/.test(document.querySelector('.pp-entry-name')?.textContent ?? '')))) throw new Error('No leaf carries the longest kingdom name');
    await shoot(page, 'many-long-name');
    await page.click('.pp-turn[data-dir="next"]');
    if (!(await turnUntil(page, () => /[؀-ۿ぀-ヿ一-鿿]/.test(document.querySelector('.pp-entry-name')?.textContent ?? '')))) throw new Error('No leaf carries a non-Latin kingdom name');
    await shoot(page, 'many-non-latin');
    await page.click('.pp-tab:has-text("Kingdoms")');
    await shoot(page, 'many-kingdoms');
    await page.click('.pp-tab:has-text("Keepsakes")');
    await shoot(page, 'many-keepsakes');
    // Every leaf of the book, front to back: none may need scrolling to read its words.
    await page.keyboard.press('Home');
    await page.focus('.pp-turn[data-dir="next"]');
    const scrolling = [];
    let leaves = 0;
    for (let i = 0; i < 160; i++) {
      await page.keyboard.press('ArrowRight');
      const seen = await audit(page);
      if (seen.scrolls) scrolling.push(seen.where_);
      leaves++;
      if (await page.evaluate(() => document.querySelector('.pp-page')?.dataset.kind === 'endpaper')) break;
    }
    report.checks.leaves = { leaves, scrolling };
    if (scrolling.length) report.console.push(`leaves that scroll: ${scrolling.join('; ')}`);
    await page.close();
  }
  {
    const page = await open({ fixture: 'few', view: '2' });
    await shoot(page, 'few-journey');
    await page.close();
  }
  {
    const page = await open({ fixture: 'none', view: '2' });
    const tabs = await page.locator('.pp-tab:visible').count();
    report.checks.emptyTabs = tabs;
    if (tabs) throw new Error(`An empty book shows ${tabs} thumb tabs`);
    await shoot(page, 'none-invitation');
    await page.close();
  }
  for (const [name, state] of [['private', 'hidden'], ['never-signed-in', 'unsigned'], ['unreadable', 'malformed'], ['opening', 'pending']]) {
    const page = await open({ fixture: 'many', state });
    await shoot(page, name);
    if (state === 'hidden' || state === 'unsigned') {
      const exposed = await page.evaluate(words => {
        const view = document.querySelector('.cpp');
        const text = [view?.textContent ?? '', ...[...(view?.querySelectorAll('[aria-label]') ?? [])].map(node => node.getAttribute('aria-label'))].join(' ');
        return words.filter(word => text.includes(word));
      }, PRIVATE_WORDS);
      report.checks[`private-${state}`] = { exposed };
      if (exposed.length) throw new Error(`A ${state} passport exposed: ${exposed.join(', ')}`);
    }
    if (state === 'malformed') {
      const seen = await page.evaluate(() => ({ state: document.querySelector('.cpp')?.dataset.state, retry: !!document.querySelector('.pp-retry'), flyleaf: !!document.querySelector('.pp-flyleaf') }));
      report.checks.unreadable = seen;
      if (seen.state !== 'unavailable' || !seen.retry || seen.flyleaf) throw new Error(`Corrupt reply was not unavailable: ${JSON.stringify(seen)}`);
    }
    await page.close();
  }

  // Keyboard: Enter opens the cover, arrows turn, the fore-edge tabs are reachable, End and Home, Escape goes back.
  {
    const page = await open({ fixture: 'few', view: '0' });
    await page.focus('.pp-cover');
    await page.keyboard.press('Enter');
    const opened = await page.textContent('.pp-where');
    await page.focus('.pp-turn[data-dir="next"]');
    await page.keyboard.press('ArrowRight');
    const turned = await page.textContent('.pp-where');
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.pp-tab')].filter(tab => tab.getBoundingClientRect().height > 0).map(tab => {
      const rect = tab.getBoundingClientRect();
      return { label: tab.textContent, inside: rect.right <= 318 && rect.bottom <= 496, w: Math.round(rect.width), h: Math.round(rect.height) };
    }));
    await page.keyboard.press('End');
    const end = await page.evaluate(() => document.querySelector('.pp-page')?.dataset.kind);
    await page.keyboard.press('Home');
    const home = await page.evaluate(() => document.querySelector('.pp-book')?.dataset.view);
    await page.keyboard.press('Escape');
    const closed = await page.evaluate(() => !document.querySelector('.cpp') && !!document.querySelector('.cppb-reopen'));
    report.checks.keyboard = { opened, turned, tabs, end, home, closed };
    if (!/Page 1 of/.test(opened ?? '') || !/Page 2 of/.test(turned ?? '') || end !== 'endpaper' || home !== 'cover' || !closed
      || tabs.some(tab => !tab.inside || tab.w < 24 || tab.h < 24)) throw new Error(`Keyboard reading failed: ${JSON.stringify(report.checks.keyboard)}`);
    await page.close();
  }
  // Touch: a tap opens the cover, and a leftward swipe across the leaf turns it.
  {
    const page = await open({ fixture: 'many', view: '0' }, { hasTouch: true, isMobile: true });
    await page.tap('.pp-cover');
    const before = await page.textContent('.pp-where');
    await page.evaluate(() => {
      const stage = document.querySelector('.pp-stage');
      const fire = (type, x) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: x, clientY: 240 }));
      fire('pointerdown', 250); fire('pointerup', 70);
    });
    const after = await page.textContent('.pp-where');
    report.checks.touch = { before, after };
    if (!/Page 1 of/.test(before ?? '') || before === after) throw new Error(`Touch reading failed: ${JSON.stringify(report.checks.touch)}`);
    await page.close();
  }
  // Reduced motion: the leaf settles instead of turning, the dust and ribbon are still, and turning still works.
  {
    const page = await open({ fixture: 'many', view: '1' }, { reducedMotion: 'reduce' });
    await page.click('.pp-turn[data-dir="next"]');
    const seen = await page.evaluate(() => ({
      leaf: (() => { const leaf = document.querySelector('.pp-leaf'); return leaf ? getComputedStyle(leaf).animationName : 'none'; })(),
      mote: getComputedStyle(document.querySelector('.cpp-motes i')).animationName,
      ribbon: getComputedStyle(document.querySelector('.pp-ribbon')).animationName,
      where: document.querySelector('.pp-where')?.textContent,
    }));
    report.checks.reducedMotion = seen;
    if (!['pp-settle', 'none'].includes(seen.leaf) || seen.mote !== 'none' || seen.ribbon !== 'none' || !/Page 2 of/.test(seen.where ?? '')) throw new Error(`Reduced motion failed: ${JSON.stringify(seen)}`);
    await page.close();
  }

  // Contact sheet: two rows of five slots at their real size.
  const sheet = `${output}/contact@1590x992.png`;
  const names = ['many-cover', 'many-flyleaf', 'many-journey', 'many-long-name', 'many-non-latin', 'many-kingdoms', 'few-journey', 'none-invitation', 'private', 'unreadable'];
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...names.flatMap(name => ['-i', `${output}/${name}@318x496.png`]),
    '-filter_complex', '[0][1][2][3][4]hstack=inputs=5[top];[5][6][7][8][9]hstack=inputs=5[bottom];[top][bottom]vstack', sheet]);
  report.shots.push({ name: 'contact', path: sheet.slice(root.length) });

  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (report.console.length || report.external.length) throw new Error(`Capture problems:\n${[...report.console, ...report.external].join('\n')}`);
  console.log(`Captured ${report.shots.length} frames into ${output} (port ${port}); bench build ${report.build.kilobytes} KB.`);
} catch (error) {
  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await new Promise(resolve => (server ? server.httpServer.close(resolve) : resolve())); } finally { await release?.(); }
  }
}
