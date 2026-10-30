import { chromium } from '@playwright/test';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base-url');
const external = baseIndex < 0 ? undefined : args[baseIndex + 1];
let base = external;
let server, browser;
const report = { checks: [], limitations: ['SwiftShader verifies behavior, not real-GPU performance.', 'No client-side unmount route exists; construction cancellation on unmount is not exercised.'] };
try {
  if (!external) ({ server, base } = await startCapturePreview());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  async function newPage({ failDuringLoading = false, throwOnConstruction = false, herald = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    await page.addInitScript(({ failDuringLoading, throwOnConstruction, herald }) => {
      const NativeWorker = window.Worker;
      window.__workers = [];
      window.__workerCounts = { created: 0, live: 0 };
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          if (throwOnConstruction && String(args[0]).includes('light-field-worker')) {
            window.__constructorThrew = true;
            throw new Error('injected Worker constructor failure');
          }
          super(...args); this.counted = true; this.url = String(args[0]);
          window.__workers.push(this); window.__workerCounts.created++; window.__workerCounts.live++;
          if (failDuringLoading && this.url.includes('light-field-worker') && !window.__failureScheduled) {
            window.__failureScheduled = true;
            window.setTimeout(() => this.dispatchEvent(new window.ErrorEvent('error', { message: 'injected light worker failure', cancelable: true })), 0);
          }
        }
        terminate() { if (this.counted) { this.counted = false; window.__workerCounts.live--; } return super.terminate(); }
      };
      if (herald) {
        window.__eventSources = [];
        window.EventSource = class {
          constructor() { window.__eventSources.push(this); }
          close() { this.closed = true; }
          emit(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
          disconnect() { this.onerror?.(new window.Event('error')); }
        };
      }
    }, { failDuringLoading, throwOnConstruction, herald });
    return { page, errors };
  }
  const ready = page => page.waitForFunction(() => window.__chatdomReady && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldUploads > 0 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 240_000 });
  const failedGate = async page => {
    await page.getByRole('button', { name: 'Try the gate again' }).waitFor({ state: 'visible', timeout: 240_000 });
    await page.waitForFunction(() => window.__workerCounts.created > 0 && window.__workerCounts.live === 0 && !window.__chatdomReady, null, { timeout: 30_000 });
  };
  const url = `${base}/?seed=willowmere&tier=town&hour=19.5&time=0&camera=hero`;
  {
    const { page, errors } = await newPage();
    await page.goto(url); await ready(page);
    const initial = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
    assert.equal(initial.homes, 240);
    assert.ok(initial.shadowUpdates > 0, `No sun shadow map rendered: ${JSON.stringify(initial)}`);
    assert.equal(initial.windowFieldVisited, 0, 'Empty town still has window light');
    assert.ok(initial.geometryBuilds > 0 && initial.fieldBytes > 0 && initial.fieldBytes <= 12 * 1024 * 1024, `Invalid scene cost: ${JSON.stringify(initial)}`);
    assert.ok(initial.drawCalls > 0 && initial.drawCalls <= 120 && initial.triangles > 0 && initial.triangles <= 2_000_000, `Invalid scene render cost: ${JSON.stringify(initial)}`);
    assert.ok((await page.locator('.source-ribbon').innerText()).includes('SIMULATED'));
    for (const [time, active] of [[0, 0], [1.8, 1], [30, 240], [0, 0]]) {
      const previousUploads = await page.evaluate(() => window.__chatdomKingdom.stats.fieldUploads);
      await page.evaluate(time => window.__chatdomKingdom.seek(time, time === 1.8 ? 'window' : 'hero'), time);
      await page.waitForFunction(({ time, active }) => window.__chatdomKingdom.stats.time === time && window.__chatdomKingdom.stats.activeWindows === active, { time, active });
      if (time !== 0 || active !== 0 || previousUploads !== initial.fieldUploads) await page.waitForFunction(previous => window.__chatdomKingdom.stats.fieldUploads > previous && window.__chatdomKingdom.stats.fieldSettled, previousUploads, { timeout: 120_000 });
      const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
      assert.equal(stats.geometryBuilds, initial.geometryBuilds, `Geometry rebuilt at ${time}s`);
      assert.equal(stats.shadowUpdates, initial.shadowUpdates, `Sun shadow map rebuilt at ${time}s`);
      if (active === 0) assert.equal(stats.windowFieldVisited, 0, `Window light remained at ${time}s`);
      else assert.ok(stats.windowFieldVisited > 0, `No window light propagated at ${time}s`);
      if (time === 1.8) await page.getByText('Juniper', { exact: false }).waitFor({ state: 'visible' });
    }
    const counts = await page.evaluate(() => window.__workerCounts);
    assert.ok(counts.created >= 7 && counts.live > 0, `Unexpected workers: ${JSON.stringify(counts)}`);
    const lost = await page.locator('canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_lose_context'); if (!ext) return false; ext.loseContext(); return true; });
    assert.ok(lost, 'WEBGL_lose_context unavailable');
    await failedGate(page);
    assert.equal(await page.evaluate(() => window.__chatdomKingdom.stats.ready), false);
    assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join('\n')}`);
    report.checks.push({ name: 'wave and actual WebGL context loss', initial, workers: counts });
    await page.close();
  }
  {
    const { page, errors } = await newPage({ throwOnConstruction: true });
    await page.goto(url); await failedGate(page);
    const state = await page.evaluate(() => ({ threw: window.__constructorThrew === true, ...window.__workerCounts, ready: window.__chatdomReady === true }));
    assert.ok(state.threw && state.created > 0 && state.live === 0 && !state.ready, `Constructor failure did not clean up prior workers: ${JSON.stringify(state)}`);
    assert.ok(errors.some(error => error.includes('injected Worker constructor failure')), `Missing constructor failure diagnostic: ${errors.join('\n')}`);
    assert.ok(errors.every(error => error.startsWith('console: Kingdom construction failed')), `Unexpected browser errors: ${errors.join('\n')}`);
    report.checks.push({ name: 'Worker constructor throws during construction', state, errors });
    await page.close();
  }
  {
    const { page, errors } = await newPage({ failDuringLoading: true });
    await page.goto(url); await failedGate(page);
    assert.ok(errors.every(error => error.startsWith('console: Kingdom construction failed')), `Unexpected browser errors: ${errors.join('\n')}`);
    report.checks.push({ name: 'light worker failure during construction', errors });
    await page.close();
  }
  {
    const { page, errors } = await newPage();
    await page.goto(url); await ready(page);
    const injected = await page.evaluate(() => { const worker = window.__workers.find(w => w.counted && w.url.includes('light-field-worker')); if (!worker) return false; worker.dispatchEvent(new window.ErrorEvent('error', { message: 'injected light worker failure', cancelable: true })); return true; });
    assert.ok(injected, 'No live light worker to fail');
    await failedGate(page);
    assert.equal(await page.evaluate(() => window.__chatdomKingdom.stats.ready), false);
    assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join('\n')}`);
    report.checks.push({ name: 'light worker failure after ready' });
    await page.close();
  }
  {
    const { page, errors } = await newPage({ herald: true });
    await page.goto(`${url}&source=herald`); await ready(page);
    const emit = async (sequence, streamLive, connection, windows, age = 0) => page.evaluate(({ sequence, streamLive, connection, windows, age }) => {
      const now = Date.now() - age;
      window.__eventSources.at(-1).emit({ version: 1, kingdomId: '900000000000000001', epoch: 'browser-test:1', sequence, asOf: now, origin: 'live', streamLive, connection, windows: windows.map(w => ({ ...w, since: now })) });
    }, { sequence, streamLive, connection, windows, age });
    await emit(0, true, 'fresh', [{ slot: 0, present: true, publicName: 'Juniper' }], 91_000);
    await page.getByText('CONNECTION LOST', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__chatdomKingdom.stats.activeWindows), 0);
    await emit(1, true, 'fresh', [{ slot: 0, present: true, publicName: 'Juniper' }]);
    await page.getByText('LIVE CHAT', { exact: true }).waitFor();
    await page.waitForFunction(() => { const s = window.__chatdomKingdom.stats; return s.activeWindows === 1 && s.fieldSettled && s.windowFieldVisited > 0 && s.beaconFieldVisited > 0; }, null, { timeout: 120_000 });
    await emit(2, false, 'offline', []);
    await page.getByText('STREAM RESTING', { exact: true }).waitFor();
    await page.waitForFunction(() => { const s = window.__chatdomKingdom.stats; return s.activeWindows === 0 && s.fieldSettled && s.windowFieldVisited === 0 && s.beaconFieldVisited === 0; }, null, { timeout: 120_000 });
    await emit(3, true, 'fresh', [{ slot: 0, present: true, publicName: 'Juniper' }]);
    await page.waitForFunction(() => { const s = window.__chatdomKingdom.stats; return s.activeWindows === 1 && s.fieldSettled && s.windowFieldVisited > 0 && s.beaconFieldVisited > 0; }, null, { timeout: 120_000 });
    await page.evaluate(() => window.__eventSources.at(-1).disconnect());
    await page.getByText('CONNECTION LOST', { exact: true }).waitFor();
    await page.waitForFunction(() => { const s = window.__chatdomKingdom.stats; return s.activeWindows === 0 && s.fieldSettled && s.windowFieldVisited === 0 && s.beaconFieldVisited === 0; }, null, { timeout: 120_000 });
    assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join('\n')}`);
    report.checks.push({ name: 'expired frame, public live frame, offline, renewed frame and disconnect' });
    await page.close();
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  await mkdir('shots/kingdom', { recursive: true });
  await writeFile('shots/kingdom/runtime.json', `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  if (server) await closeCapturePreview(server);
}
