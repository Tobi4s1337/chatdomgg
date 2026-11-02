/* global AbortSignal -- Node 22 */
// GW16 crown and tag review under SwiftShader: apps/web/src/kingdom/grand-land/monarch/review.html at the walk's
// sizes, through Vite's dev server on a free capture port, under the shared capture lock (a few seconds of render).
//   node work/lanes/grand-world/capture-monarch-review.mjs [--views guest,monarch,far] [--sizes 1440x900,390x844]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';

const { values } = parseArgs({ options: { views: { type: 'string', default: 'guest,monarch,far' }, sizes: { type: 'string', default: '1440x900,390x844' }, out: { type: 'string', default: 'work/evidence/grand-world' } } });
const views = values.views.split(','), sizes = values.sizes.split(',').map(s => s.split('x').map(Number));
const report = { renderer: 'Chrome SwiftShader', shots: [] };
let server, browser, release;
try {
  // Compile the page before taking the lock; only the renders hold it.
  for (const port of CAPTURE_PORTS) {
    try {
      server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', optimizeDeps: { entries: ['src/kingdom/grand-land/monarch/review.html'] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
      await server.listen(); report.port = port; break;
    } catch (error) { await server?.close(); server = undefined; if (!/already in use|EADDRINUSE/i.test(String(error?.message ?? error))) throw error; }
  }
  if (!server) throw new Error('No free capture port; nothing was started');
  const url = view => `http://127.0.0.1:${report.port}/src/kingdom/grand-land/monarch/review.html?view=${view}`;
  await fetch(url('guest')).then(r => r.text());
  release = await acquireCaptureLock({ signal: AbortSignal.timeout(900_000) });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(values.out, { recursive: true });
  for (const view of views) for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const started = Date.now();
    await page.goto(url(view), { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => window.__chatdomReady === true || document.body.textContent.startsWith('Review failed'), null, { timeout: 240_000, polling: 250 });
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(errors.join('\n'));
    const png = `${values.out}/gw16-review-${view}-golden@${w}x${h}.png`;
    await page.screenshot({ path: png, timeout: 120_000 });
    const state = await page.evaluate(() => ({ review: window.__monarchReview ?? null, line: document.querySelector('.monarch-arrival')?.innerText ?? null,
      tags: [...document.querySelectorAll('.walk-person-label')].map(el => el.textContent) }));
    report.shots.push({ view, size: `${w}x${h}`, png, ms: Date.now() - started, ...state });
    console.log(JSON.stringify(report.shots.at(-1)));
    await page.close();
  }
  await writeFile(`${values.out}/gw16-review-report.json`, JSON.stringify(report, null, 2) + '\n');
} finally { await browser?.close(); await server?.close(); await release?.(); }
