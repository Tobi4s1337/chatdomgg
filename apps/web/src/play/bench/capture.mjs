// The play HUD and ledger at the web sizes, plus a few checks in a real browser (keyboard, Escape layers, trusted
// clicks, no browser control left default). Serves this checkout's web app on 127.0.0.1 (5178 or 5179, else a free capture port) for its own run only.
// node apps/web/src/play/bench/capture.mjs [--only <name>] [--out <dir>]
/* global getComputedStyle, MouseEvent */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const web = `${repo}apps/web`;
const out = option('--out') ?? `${repo}work/evidence/play/ledger`;
const only = option('--only');
// 5178 or 5179 first, then any other free capture port (never 5187 or 5190-5197; see packages/testing/capture-ports.mjs).
const PORTS = [5178, 5179, ...CAPTURE_PORTS.filter(port => port !== 5178 && port !== 5179)];

async function serve() {
  for (const port of PORTS) {
    const server = await createServer({ configFile: `${web}/vite.config.ts`, root: web, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true } });
    try { await server.listen(); return { server, port }; }
    catch (error) { await server.close(); if (!/already in use/.test(error?.message ?? '')) throw error; }
  }
  throw new Error(`Every bench port is in use: ${PORTS.join(', ')}`);
}
const { server, port } = await serve();
console.log(`bench on 127.0.0.1:${port}`);
const base = `http://127.0.0.1:${port}/src/play/bench/index.html`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const report = { shots: [], checks: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) console.error(`FAIL ${name}`, detail ?? ''); };

const shots = [
  ['hud-idle', ''],
  ['hud-drift', '?drift=1'],
  ['ledger-drift', '?page=settings&drift=1'],
  ['hud-touch', '?cursor=touch&prompt=1&slots=1'],
  ['hud-prompt', '?cursor=locked&prompt=1&slots=1'],
  ['settings', '?page=settings'],
  ['settings-keys', '?page=settings&slots=1', async page => {
    await page.evaluate(() => document.querySelector('.pl-section[data-area="keys"]')?.scrollIntoView({ block: 'start' }));
    await page.click('[data-key-action="jump"]');
  }],
  ['way-home', '?page=way-home'],
  ['way-home-inside', '?page=way-home&home=inside'],
  ['way-home-none', '?page=way-home&home=none'],
  ['build', '?page=build'],
  ['build-closed', '?page=build&build=closed'],
  ['help', '?page=help&slots=1'],
  ['slots', '?page=look&slots=1'],
  ['help-touch', '?page=help&cursor=touch'],
  ['settings-touch', '?page=settings&cursor=touch'],
];
const sizes = [[1440, 900], [390, 844]];

async function open(page, query) {
  await page.goto(`${base}${query}`);
  await page.waitForFunction(() => window.__chatdomReady === true);
  await page.waitForTimeout(900);
}

try {
  await mkdir(out, { recursive: true });
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 600, isMobile: width < 600 });
    const page = await context.newPage();
    page.on('pageerror', error => check(`no page error (${width})`, false, String(error)));
    for (const [name, query, act] of shots) {
      if (only && only !== name) continue;
      await open(page, query);
      if (act) { await act(page); await page.waitForTimeout(700); }
      const file = `${out}/${name}@${width}x${height}.png`;
      await page.screenshot({ path: file });
      report.shots.push(file.replace(repo, ''));
    }

    if (!only) {
      // No default control or scrollbar anywhere in the open ledger.
      await open(page, '?page=settings&slots=1');
      const defaults = await page.evaluate(() => [...document.querySelectorAll('.pl-ledger input, .pl-ledger select, .pl-ledger progress, .pl-ledger meter')].length);
      check(`no native controls (${width})`, defaults === 0, defaults);
      const scrollbars = await page.evaluate(() => [...document.querySelectorAll('.pl-ledger *')].filter(el => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY + style.overflowX) && (el.offsetWidth - el.clientWidth > 0 || el.offsetHeight - el.clientHeight > 0);
      }).map(el => el.className));
      check(`no visible scrollbars (${width})`, scrollbars.length === 0, scrollbars);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.pl-ledger .pl-tab-name, .pl-ledger .pl-control-name, .pl-ledger .pl-choice-words, .pl-ledger .pl-keyplate-words')]
        .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
      check(`no clipped words (${width})`, overflow.length === 0, overflow);
    }
    await context.close();
  }

  if (!only) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await open(page, '?page=settings');
    // Keyboard: the open tab has focus; arrows walk the contents and turn the page.
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-tab'));
    check('the open tab takes focus', focused === 'settings', focused);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
    check('ArrowDown turns to Way home', await page.getAttribute('[data-tab="way-home"]', 'aria-selected') === 'true');
    await page.keyboard.press('End');
    await page.waitForTimeout(80);
    check('End turns to Help', await page.getAttribute('[data-tab="help"]', 'aria-selected') === 'true');
    await page.keyboard.press('Home');
    // Escape: a listening plate first, then the ledger.
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('.pl-section[data-area="keys"]')?.scrollIntoView());
    await page.click('[data-key-action="use"]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const afterFirst = await page.evaluate(() => ({ open: window.__bench.hud.ledgerOpen, listening: !!document.querySelector('[data-listening="true"]') }));
    check('first Escape cancels the key capture only', afterFirst.open && !afterFirst.listening, afterFirst);
    await page.click('[data-key-action="use"]');
    await page.keyboard.press('KeyR');
    const bound = await page.evaluate(() => window.__bench.play.settings.current.keys.use);
    check('a pressed key binds and persists through the store', bound === 'KeyR', bound);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    check('second Escape closes the ledger', await page.evaluate(() => !window.__bench.hud.ledgerOpen && !document.querySelector('.pl-ledger')));
    check('the calm click-to-walk slip shows after Escape', await page.isVisible('.pl-walk-slip'));
    // Back to the street only from a trusted click.
    await page.evaluate(() => window.__bench.hud.openLedger('help'));
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('.pl-back')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    check('a scripted click does not resume', await page.evaluate(() => window.__bench.hud.ledgerOpen));
    await page.click('.pl-back');
    await page.waitForTimeout(100);
    check('a trusted click goes back to the street', await page.evaluate(() => !window.__bench.hud.ledgerOpen));
    const cues = await page.evaluate(() => [...new Set(window.__bench.cues)].sort());
    check('wood, brass and parchment all sounded', cues.join() === 'brass,parchment,wood', cues);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
const failed = report.checks.filter(item => !item.ok);
console.log(`${report.shots.length} shots, ${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
