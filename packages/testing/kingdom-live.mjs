import { chromium } from '@playwright/test';
import { acquireCaptureLock } from './capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base-url');
if (baseIndex >= 0 && (!args[baseIndex + 1] || args[baseIndex + 1].startsWith('--'))) throw new Error('--base-url requires a URL');
let base = baseIndex < 0 ? undefined : args[baseIndex + 1].replace(/\/$/, '');
let browser, page, release, server;
const report = { checks: [], timeline: [], errors: [], workerErrors: [], limitations: ['SwiftShader behavior only; no real-GPU performance measurement.'] };
try {
  release = await acquireCaptureLock();
  if (!base) ({ server, base } = await startCapturePreview());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(`console: ${message.text()}`); });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__liveWorkerErrors = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.addEventListener('error', event => window.__liveWorkerErrors.push({ url: String(args[0]), message: event.message })); this.addEventListener('messageerror', () => window.__liveWorkerErrors.push({ url: String(args[0]), message: 'messageerror' })); }
    };
  });
  const start = Date.now();
  await page.goto(`${base}/?tier=town&hour=19.5`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  let last = '', lastPrint = 0, state;
  while (Date.now() - start < 240_000) {
    state = await page.evaluate(() => ({ flag: window.__chatdomReady === true, stats: window.__chatdomKingdom?.stats ? { ...window.__chatdomKingdom.stats } : null, gate: document.querySelector('.kingdom-gate')?.innerText ?? null, workerErrors: window.__liveWorkerErrors }));
    const elapsedMs = Date.now() - start;
    const key = JSON.stringify([state.flag, state.stats?.ready, state.gate]);
    if (key !== last || elapsedMs - lastPrint >= 10_000) { report.timeline.push({ elapsedMs, ...state }); console.log(JSON.stringify(report.timeline.at(-1))); last = key; lastPrint = elapsedMs; }
    report.workerErrors = state.workerErrors;
    // A live feed may keep advancing the light-worker queue. Opening the page
    // requires a rendered scene and the first upload from all three fields;
    // queue idleness is only needed below for deterministic replay assertions.
    if ((state.flag && state.stats?.ready) || state.gate?.includes('Try the gate again')) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  report.readyElapsedMs = Date.now() - start;
  assert.ok(state?.flag && state.stats?.ready, `Live page did not open within 240s or entered error state: ${JSON.stringify(state)}`);
  assert.equal(state.gate, null, `Readiness gate remains: ${state.gate}`);
  const stats = state.stats;
  assert.ok(stats?.ready && stats.drawCalls > 0 && stats.triangles > 0 && stats.fieldUploads >= 3 && stats.fieldBytes > 0, `Ready without rendered scene and all fields: ${JSON.stringify(stats)}`);
  assert.equal(stats.homes, 240, 'Town should render 240 homes');
  assert.equal(stats.activeWindows, 240, 'Default live presentation should show the simulated crowd');
  assert.equal(stats.source, 'SIMULATED');
  assert.match(await page.locator('.source-ribbon').innerText(), /SIMULATED/);
  report.checks.push({ name: 'no-time default readiness', stats });
  await page.evaluate(() => window.__chatdomKingdom.play());
  for (const [time, active] of [[0, 0], [1.8, 1], [30, 240]]) {
    await page.evaluate(time => window.__chatdomKingdom.seek(time, time === 1.8 ? 'window' : 'hero'), time);
    await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    await page.waitForFunction(({ time, active }) => { const s = window.__chatdomKingdom.stats; return s.time === time && s.activeWindows === active && s.fieldSettled && (active ? s.windowFieldVisited > 0 : s.windowFieldVisited === 0); }, { time, active }, { timeout: 180_000 });
    if (time === 1.8) await page.getByText('Juniper', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 });
    report.checks.push({ name: `fixed replay at ${time}s`, stats: await page.evaluate(() => ({ ...window.__chatdomKingdom.stats })) });
  }
  assert.deepEqual(report.errors, [], `Browser errors: ${report.errors.join('\n')}`);
  report.workerErrors = await page.evaluate(() => window.__liveWorkerErrors);
  assert.deepEqual(report.workerErrors, [], `Worker errors: ${JSON.stringify(report.workerErrors)}`);
  report.result = 'passed';
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.result = 'failed'; report.failure = error.stack ?? String(error); throw error;
} finally {
  try { await page?.close(); } finally {
    try { await browser?.close(); } finally {
      try { if (server) await closeCapturePreview(server); } finally {
        try { await release?.(); } finally {
          await mkdir('shots/kingdom/live', { recursive: true });
          await writeFile('shots/kingdom/live/report.json', `${JSON.stringify(report, null, 2)}\n`);
        }
      }
    }
  }
}
