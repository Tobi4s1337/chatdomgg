/* global URLSearchParams:readonly, getComputedStyle:readonly */
// Captures the citizen card bench (SIMULATED fixtures) under the shared host capture lock: one owned Vite server
// and one Chromium, both closed before the lock is released.
//   node apps/web/src/citizen-card/capture.mjs [--port 5188]
// Shots land in shots/citizen-card/<name>@<w>x<h>.png; console errors and off-host requests fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5188);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/citizen-card`;

/** name, query, viewport and whether to keep the bench rail (never in product-facing frames). */
const SHOTS = [
  ['page-wren', { fixture: 'wren', mode: 'page' }, [1440, 900]],
  ['page-wren', { fixture: 'wren', mode: 'page' }, [390, 844]],
  ['dialog-wren', { fixture: 'wren', mode: 'dialog' }, [1440, 900]],
  ['dialog-wren', { fixture: 'wren', mode: 'dialog' }, [390, 844]],
  ['page-unknown', { fixture: 'unknown', mode: 'page', light: 'night' }, [390, 844]],
  ['page-lapsed', { fixture: 'lapsed', mode: 'page', light: 'day' }, [1440, 900]],
  ['dialog-loading', { fixture: 'wren', mode: 'dialog', state: 'loading' }, [390, 844]],
  ['page-withdrawn', { fixture: 'wren', mode: 'page', state: 'withdrawn' }, [390, 844]],
  ['dialog-unavailable', { fixture: 'wren', mode: 'dialog', state: 'unavailable' }, [1440, 900]],
];

let server, browser, release;
const report = { port, shots: [], console: [], external: [], focus: null, reducedMotion: null };
try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', optimizeDeps: { entries: ['src/citizen-card/bench.html'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  const base = `http://127.0.0.1:${port}/src/citizen-card/bench.html`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });

  const open = async (query, [width, height], context = {}) => {
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...context });
    // Context-level, so worker and module requests are named too.
    scope.on('response', response => { if (response.status() >= 400) report.console.push(`${JSON.stringify(query)}: ${response.status()} ${response.url()}`); });
    scope.on('requestfailed', request => report.console.push(`${JSON.stringify(query)}: failed ${request.url()} ${request.failure()?.errorText ?? ''}`));
    const page = await scope.newPage();
    page.on('close', () => { void scope.close(); });
    page.on('console', message => { if (message.type() === 'error') report.console.push(`${JSON.stringify(query)}: ${message.text()} ${message.location().url}`); });
    page.on('pageerror', error => report.console.push(`${JSON.stringify(query)}: ${error.message}`));
    page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', ''].includes(url.hostname) && !url.protocol.startsWith('blob') && !url.protocol.startsWith('data')) report.external.push(request.url()); });
    await page.goto(`${base}?${new URLSearchParams({ chrome: '0', ...query })}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomCardError === 'string', {}, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomCardError);
    if (failure) throw new Error(`${JSON.stringify(query)}: ${failure}`);
    return page;
  };

  for (const [name, query, viewport] of SHOTS) {
    const page = await open(query, viewport);
    const path = `${output}/${name}@${viewport[0]}x${viewport[1]}.png`;
    await page.screenshot({ path });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) report.console.push(`${name}@${viewport.join('x')}: horizontal overflow`);
    report.shots.push({ path: path.slice(root.length), bytes: (await stat(path)).size });
    if (name === 'page-wren' && viewport[0] === 390) {
      const full = `${output}/${name}-full@390x844.png`;
      await page.screenshot({ path: full, fullPage: true });
      report.shots.push({ path: full.slice(root.length), bytes: (await stat(full)).size });
    }
    await page.close();
    console.log(`Captured ${name}@${viewport.join('x')}.`);
  }

  // Keyboard: the close button takes focus, Tab stays inside, Escape closes and focus returns to the opener.
  {
    const page = await open({ fixture: 'wren', mode: 'dialog' }, [1440, 900]);
    const first = await page.evaluate(() => document.activeElement?.className);
    let escaped = false;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => Boolean(document.activeElement?.closest('.cc-dialog'))))) escaped = true;
    }
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({ open: Boolean(document.querySelector('.cc-dialog')), focus: document.activeElement?.className }));
    report.focus = { initial: first, escapedDialog: escaped, closedByEscape: !after.open, restoredTo: after.focus };
    if (first !== 'cc-close' || escaped || after.open || after.focus !== 'ccb-open') throw new Error(`Dialog focus failed: ${JSON.stringify(report.focus)}`);
    await page.close();
  }
  // Reduced motion: the entrance becomes a short fade, and the frame is the same finished plaque.
  {
    const page = await open({ fixture: 'wren', mode: 'page' }, [390, 844], { reducedMotion: 'reduce' });
    report.reducedMotion = await page.evaluate(() => getComputedStyle(document.querySelector('.cc-plaque')).animationName);
    await page.screenshot({ path: `${output}/page-wren-reduced@390x844.png` });
    await page.close();
  }

  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (report.console.length || report.external.length) throw new Error(`Console errors or external requests:\n${[...report.console, ...report.external].join('\n')}`);
  console.log(`Captured ${report.shots.length} frames into ${output} (port ${port}).`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await server?.close(); } finally { await release?.(); }
  }
}
