/* global URLSearchParams:readonly, getComputedStyle:readonly, NodeFilter:readonly, PointerEvent:readonly */
// Captures the passport bench at main's `/-/passport` route (SIMULATED fixtures) under the shared capture lock: one
// owned Vite server and one Chrome, both closed before the lock is released.
//   node apps/web/src/passport/capture.mjs [--port 5185]
// Shots land in shots/passport/<name>@<w>x<h>.png with a contact sheet; console errors, off-host requests,
// horizontal overflow and text under 12 px fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5185);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/passport`;
const run = promisify(execFile);

/** name, query, viewport. The bench header stays on for its reading controls; the 2026-11-01 founder decision 25 removes visible simulation labels. */
const SHOTS = [
  ['none', { fixture: 'none', view: '1', layout: 'spread' }, [1440, 900]],
  ['few', { fixture: 'few', view: '1', layout: 'spread' }, [1440, 900]],
  ['many-journeys', { fixture: 'many', view: '5', layout: 'spread' }, [1440, 900]],
  ['many-cover', { fixture: 'many', view: '0', layout: 'spread' }, [1440, 900]],
  ['many-page', { fixture: 'many', view: '3', layout: 'page' }, [390, 844]],
  // The closed states: travels kept private, the read still out, and a reply the boundary refused.
  ['private', { fixture: 'few', state: 'hidden', layout: 'spread' }, [1440, 900]],
  ['opening', { fixture: 'few', state: 'pending', layout: 'spread' }, [1440, 900]],
  ['unreadable', { fixture: 'few', state: 'malformed', layout: 'spread' }, [1440, 900]],
  ['private-page', { fixture: 'many', state: 'unsigned', layout: 'page' }, [390, 844]],
];

let server, browser, release;
const report = { port, shots: [], console: [], external: [], checks: {} };
try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
    // The host entry is JSX the dependency scanner cannot parse; name the bench's dependencies instead.
    optimizeDeps: { noDiscovery: true, include: ['solid-js', 'solid-js/web', 'zod'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  const base = `http://127.0.0.1:${port}/-/passport`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });

  const open = async (query, [width, height], context = {}) => {
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...context });
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
  /** Smallest rendered font size among visible text inside the book, and any horizontal overflow. */
  const audit = page => page.evaluate(() => {
    let smallest = Infinity, where = '';
    const walker = document.createTreeWalker(document.querySelector('.pp-book') ?? document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest('svg')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < smallest) { smallest = size; where = node.textContent.trim().slice(0, 30); }
    }
    return { smallest, where, overflow: document.documentElement.scrollWidth > window.innerWidth };
  });

  for (const [name, query, viewport] of SHOTS) {
    const page = await open(query, viewport);
    await page.waitForTimeout(700);
    const path = `${output}/${name}@${viewport[0]}x${viewport[1]}.png`;
    await page.screenshot({ path });
    const result = await audit(page);
    if (result.overflow) report.console.push(`${name}: horizontal overflow`);
    if (result.smallest < 12) report.console.push(`${name}: text at ${result.smallest}px ("${result.where}")`);
    report.shots.push({ path: path.slice(root.length), smallestText: result.smallest });
    await page.close();
    console.log(`Captured ${name}@${viewport.join('x')}.`);
  }

  // Keyboard: open from the cover with the turn button, then arrow keys turn spreads and End reaches the endpaper.
  {
    const page = await open({ fixture: 'few', view: '0', layout: 'spread' }, [1440, 900]);
    await page.focus('.pp-turn[data-dir="next"]');
    await page.keyboard.press('Enter');
    const opened = await page.textContent('.pp-where');
    await page.keyboard.press('ArrowRight');
    const turned = await page.textContent('.pp-where');
    await page.keyboard.press('End');
    const end = await page.evaluate(() => [...document.querySelectorAll('.pp-page')].map(page => page.dataset.kind));
    await page.keyboard.press('Home');
    const home = await page.evaluate(() => document.querySelector('.pp-book')?.dataset.view);
    const focusRing = await page.evaluate(() => { const b = document.querySelector('.pp-turn[data-dir="next"]'); b.focus(); return getComputedStyle(b).outlineStyle; });
    report.checks.keyboard = { opened, turned, end, home, focusRing };
    if (!/Pages 1 and 2/.test(opened ?? '') || !/Pages 3 and 4/.test(turned ?? '') || !end.includes('endpaper') || home !== 'cover') throw new Error(`Keyboard turning failed: ${JSON.stringify(report.checks.keyboard)}`);
    await page.close();
  }
  // Touch: a leftward swipe on the pages turns forward.
  {
    const page = await open({ fixture: 'many', view: '1', layout: 'page' }, [390, 844], { hasTouch: true, isMobile: true });
    const before = await page.textContent('.pp-where');
    await page.evaluate(() => {
      const stage = document.querySelector('.pp-stage');
      const fire = (type, x) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: 400 }));
      fire('pointerdown', 300); fire('pointerup', 120);
    });
    const after = await page.textContent('.pp-where');
    report.checks.swipe = { before, after };
    if (before === after) throw new Error(`Swipe did not turn: ${JSON.stringify(report.checks.swipe)}`);
    await page.close();
  }
  // Reduced motion: the turn becomes a short settle, and turning still works.
  {
    const page = await open({ fixture: 'many', view: '1', layout: 'spread' }, [1440, 900], { reducedMotion: 'reduce' });
    await page.click('.pp-turn[data-dir="next"]');
    const animation = await page.evaluate(() => { const leaf = document.querySelector('.pp-leaf'); return leaf ? getComputedStyle(leaf).animationName : 'none'; });
    report.checks.reducedMotion = { animation, where: await page.textContent('.pp-where') };
    if (!['pp-settle', 'none'].includes(animation)) throw new Error(`Reduced motion still turns the full leaf: ${animation}`);
    await page.close();
  }
  // Older pages: the stamps leaf asks the SIMULATED fixture, validated by schema, and the book grows by spreads.
  {
    const page = await open({ fixture: 'many', view: '1', layout: 'spread' }, [1440, 900]);
    await page.click('.pp-tab:has-text("Kingdoms")');
    const kingdomsAt = await page.textContent('.pp-where');
    // The leaf that ends the loaded journeys sits just before the Kingdoms tab: on its spread, or the one before.
    if (!(await page.locator('.pp-more-action').count())) await page.click('.pp-turn[data-dir="prev"]');
    const moreVisible = await page.locator('.pp-more-action:has-text("older journeys")').count();
    await page.click('.pp-more-action:has-text("older journeys")');
    const after = await page.evaluate(() => [...document.querySelectorAll('.pp-page')].map(page => page.dataset.kind));
    await page.click('.pp-tab:has-text("Kingdoms")');
    const kingdomsLater = await page.textContent('.pp-where');
    report.checks.olderPages = { kingdomsAt, moreVisible, after, kingdomsLater };
    if (!moreVisible || kingdomsAt === kingdomsLater) throw new Error(`Older pages did not extend the book: ${JSON.stringify(report.checks.olderPages)}`);
    await page.close();
  }

  // Privacy: a hidden or never-signed-in book shows nothing of its holder or travels, in text or accessibility names.
  for (const state of ['hidden', 'unsigned']) {
    const page = await open({ fixture: 'few', state, layout: 'spread' }, [1440, 900]);
    const exposed = await page.evaluate(() => {
      const book = document.querySelector('.pp-book');
      const words = [book?.textContent ?? '', ...[...(book?.querySelectorAll('[aria-label]') ?? [])].map(node => node.getAttribute('aria-label')), book?.getAttribute('aria-label') ?? ''].join(' ');
      return ['Pellam', 'Rook', 'Hollowmere', 'Copperleaf', 'Brindlewick', 'Maple Wren', 'raid', 'Journeys'].filter(word => words.includes(word));
    });
    report.checks[`private-${state}`] = { exposed };
    if (exposed.length) throw new Error(`A ${state} passport exposed: ${exposed.join(', ')}`);
    await page.close();
  }
  // A corrupt reply is unavailable with a way to try again, never an empty book.
  {
    const page = await open({ fixture: 'few', state: 'malformed', layout: 'spread' }, [1440, 900]);
    const seen = await page.evaluate(() => ({ state: document.querySelector('.ppb-reading')?.dataset.state, retry: !!document.querySelector('.pp-retry'), flyleaf: !!document.querySelector('.pp-flyleaf') }));
    report.checks.unreadable = seen;
    if (seen.state !== 'unavailable' || !seen.retry || seen.flyleaf) throw new Error(`Corrupt reply was not unavailable: ${JSON.stringify(seen)}`);
    await page.close();
  }
  // A journey lands while reading: turning to older journeys reopens the book on the new snapshot, then turns.
  {
    const page = await open({ fixture: 'many', state: 'revised', view: '1', layout: 'spread' }, [1440, 900]);
    const before = await page.evaluate(() => document.querySelectorAll('.pp-entry').length);
    await page.click('.pp-tab:has-text("Kingdoms")');
    if (!(await page.locator('.pp-more-action').count())) await page.click('.pp-turn[data-dir="prev"]');
    await page.click('.pp-more-action:has-text("older journeys")');
    await page.waitForFunction(() => !document.querySelector('.pp-more-note[role="status"]'), {}, { timeout: 10_000 });
    const failed = await page.locator('.pp-more-note:has-text("could not be read")').count();
    await page.click('.pp-tab:has-text("Journeys")');
    const fresh = await page.evaluate(() => [...document.querySelectorAll('.pp-entry-name')].slice(0, 2).map(node => node.textContent));
    report.checks.revised = { before, failed, fresh };
    if (failed || fresh[0] !== 'Copperleaf') throw new Error(`Revised reading did not reopen on the new journey: ${JSON.stringify(report.checks.revised)}`);
    await page.close();
  }

  // The closed states and the few-journeys spread with its roads, at half size.
  const states = `${output}/states@1440x900.png`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...['private', 'opening', 'unreadable', 'few'].flatMap(name => ['-i', `${output}/${name}@1440x900.png`]),
    '-filter_complex', '[0]scale=720:450[a];[1]scale=720:450[b];[2]scale=720:450[c];[3]scale=720:450[d];[a][b]hstack[top];[c][d]hstack[bottom];[top][bottom]vstack', states]);
  report.shots.push({ path: states.slice(root.length) });

  // Contact sheet: none, few and many open, with the many cover, each scaled to half size.
  const sheet = `${output}/contact@1440x900.png`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...['none', 'few', 'many-journeys', 'many-cover'].flatMap(name => ['-i', `${output}/${name}@1440x900.png`]),
    '-filter_complex', '[0]scale=720:450[a];[1]scale=720:450[b];[2]scale=720:450[c];[3]scale=720:450[d];[a][b]hstack[top];[c][d]hstack[bottom];[top][bottom]vstack', sheet]);
  report.shots.push({ path: sheet.slice(root.length) });

  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (report.console.length || report.external.length) throw new Error(`Capture problems:\n${[...report.console, ...report.external].join('\n')}`);
  console.log(`Captured ${report.shots.length} frames into ${output} (port ${port}).`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await server?.close(); } finally { await release?.(); }
  }
}
