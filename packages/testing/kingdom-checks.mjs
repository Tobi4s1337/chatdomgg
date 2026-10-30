import { chromium } from '@playwright/test';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base-url');
const external = baseIndex < 0 ? undefined : args[baseIndex + 1];
let base = external;
let server, browser;
try {
  if (!external) ({ server, base } = await startCapturePreview());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__workerCounts = { created: 0, live: 0 };
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.__workerCounts.created++; window.__workerCounts.live++; this.counted = true; }
      terminate() { if (this.counted) { this.counted = false; window.__workerCounts.live--; } return super.terminate(); }
    };
  });
  await page.goto(`${base}/?seed=willowmere&tier=town&hour=23&time=0&camera=hero`);
  await page.waitForFunction(() => window.__chatdomReady && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldUploads > 0 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 240_000 });
  const initial = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
  assert.equal(initial.homes, 240);
  assert.ok(initial.geometryBuilds > 0 && initial.fieldBytes > 0 && initial.fieldBytes <= 8 * 1024 * 1024, `Invalid scene cost: ${JSON.stringify(initial)}`);
  assert.ok(initial.drawCalls > 0 && initial.drawCalls <= 120 && initial.triangles > 0 && initial.triangles <= 2_000_000, `Empty render: ${JSON.stringify(initial)}`);
  assert.ok((await page.locator('.source-ribbon').innerText()).includes('SIMULATED'));
  for (const [time, active] of [[0, 0], [1.8, 1], [30, 240], [0, 0]]) {
    await page.evaluate(time => window.__chatdomKingdom.seek(time, time === 1.8 ? 'window' : 'hero'), time);
    await page.waitForFunction(({ time, active }) => window.__chatdomKingdom.stats.time === time && window.__chatdomKingdom.stats.activeWindows === active, { time, active });
    const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
    assert.equal(stats.geometryBuilds, initial.geometryBuilds, `Geometry rebuilt at ${time}s`);
    if (time === 1.8) await page.getByText('Juniper', { exact: false }).waitFor({ state: 'visible' });
  }
  const counts = await page.evaluate(() => window.__workerCounts);
  assert.ok(counts.created > 0 && counts.live > 0, `No live workers observed: ${JSON.stringify(counts)}`);
  await page.locator('canvas').dispatchEvent('webglcontextlost', { cancelable: true });
  await page.waitForFunction(() => window.__workerCounts.live === 0);
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log(`Kingdom checks passed: 0 → 1 → 240 → 0 windows; ${counts.created} real workers cleaned up; ${initial.geometryBuilds} geometry builds; ${initial.drawCalls} draws; ${initial.triangles} triangles; ${initial.fieldBytes} field bytes.`);
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
}
