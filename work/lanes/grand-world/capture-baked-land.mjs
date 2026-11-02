import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';

const port = assertCapturePort(Number(process.env.GRAND_LAND_PORT ?? 5182));
const width = Number(process.env.GRAND_BAKED_WIDTH ?? 1920), height = width === 1280 ? 720 : 1080;
assert.ok(width === 1920 || width === 1280, 'Use a standard stream viewport');
process.env.GRAND_BAKED_PREVIEW_PORT ??= '5173';
process.env.CHATDOM_REALM_TARGET = 'http://127.0.0.1:5197';
process.env.CHATDOM_API_TARGET = 'http://127.0.0.1:5196';
process.env.CHATDOM_LAND_TARGET = `http://127.0.0.1:${port}`;
const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
const directory = resolve('shots/grand-world/land-bake-a');
const output = `work/evidence/grand-world/gw10-baked-stream-golden@${width}x${height}.png`;
const reportPath = `work/evidence/grand-world/gw10-baked-stream${width === 1920 ? '' : '-720'}.json`;
await mkdir('work/evidence/grand-world', { recursive: true });
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60_000) });
let server, preview, browser, page;
const report = { viewport: { width, height }, loaded: false, errors: [], landRequests: [], workerScripts: [], screenshot: null };
try {
  server = createLandReadServer(directory);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve); });
  preview = await startCapturePreview('GRAND_BAKED_PREVIEW_PORT');
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('worker', worker => report.workerScripts.push(new URL(worker.url()).pathname));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/realm/land/')) report.landRequests.push({ path, status: response.status(), at: Date.now() });
  });
  // Preserve the first genuinely loaded native frame for a bounded software still. No readiness is synthesized.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let loaded = false;
    window.requestAnimationFrame = callback => raf(time => {
      if (loaded && window.__chatdomReady && window.__chatdomKingdom?.inspect().loaded) return;
      callback(time);
      if (window.__chatdomReady && window.__chatdomKingdom?.inspect().loaded) loaded = true;
    });
  });
  const started = Date.now();
  await page.goto(`${preview.base}/stream?source=realm&kingdom=129634568&hour=17.5`, { timeout: 20_000 });
  // The diagnostic freezes RAF after readiness; poll on a timer so the readiness waiter is not frozen too.
  await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.inspect().loaded, undefined, { timeout: 150_000, polling: 100 });
  report.loaded = true; report.readyMs = Date.now() - started;
  report.inspect = await page.evaluate(() => {
    const k = window.__chatdomKingdom;
    return { land: k.inspect().land, renderCompletedAt: k.inspect().renderCompletedAt, stats: k.stats };
  });
  assert.equal(report.inspect.land.generatedColumns, 0);
  assert.ok(report.landRequests.length > 2);
  assert.deepEqual(report.errors, []);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output, timeout: 15_000 });
  report.screenshot = output;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  if (page) report.lastState = await page.evaluate(() => ({ ready: window.__chatdomReady, loaded: window.__chatdomKingdom?.inspect().loaded,
    land: window.__chatdomKingdom?.inspect().land, gate: document.querySelector('.stream-curtain')?.textContent })).catch(() => null);
  throw error;
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  if (preview) await closeCapturePreview(preview.server);
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await release();
}
