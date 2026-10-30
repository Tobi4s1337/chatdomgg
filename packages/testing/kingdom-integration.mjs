import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';

// One serial page: the browser adapter receives synthetic PUBLIC SSE frames.
// This proves the replay seam, not Herald ingest or real Twitch authorization.
let server, browser;
try {
  const { server: owned, base } = await startCapturePreview(); server = owned;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.EventSource = class {
      constructor() { window.__integrationSSE = this; }
      close() {}
    };
  });
  await page.goto(`${base}/?seed=lanternmere&tier=hamlet&hour=19.5&time=30&camera=window&source=herald&presenceOrigin=simulated`);
  const settled = () => page.waitForFunction(() => (window.__chatdomReady && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldSettled) || !!document.querySelector('.kingdom-gate button'), null, { timeout: 240_000 });
  await settled();
  assert.equal(await page.locator('.kingdom-gate button').count(), 0, errors.join('\n'));
  let sequence = 0;
  const emit = async (origin = 'simulated') => page.evaluate(({ origin, sequence }) => {
    const asOf = Date.now();
    window.__integrationSSE.onmessage({ data: JSON.stringify({
      version: 1, kingdomId: '900000000000000001', epoch: 'integration:replay', sequence, asOf,
      origin, streamLive: true, connection: 'fresh',
      windows: [{ slot: 1024, present: true, publicName: 'Juniper', since: asOf - 1000 }],
    }) });
  }, { origin, sequence: ++sequence });
  const snapshots = [];
  await mkdir('shots/kingdom/integration', { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await emit();
    await page.waitForFunction(() => window.__chatdomKingdom.stats.activeWindows === 1 && window.__chatdomKingdom.stats.windowFieldVisited > 0 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
    await page.getByText('Juniper', { exact: false }).waitFor();
    assert.equal(await page.locator('.source-ribbon').innerText(), 'SIMULATED');
    assert.equal(errors.length, 0, errors.join('\n'));
    const file = `hearth-replay@${width}x${height}.png`;
    await page.screenshot({ path: `shots/kingdom/integration/${file}`, timeout: 120_000 });
    snapshots.push({ file, stats: await page.evaluate(() => ({ ...window.__chatdomKingdom.stats })) });
  }
  await emit('live');
  await page.waitForFunction(() => window.__chatdomKingdom.stats.activeWindows === 0 && window.__chatdomKingdom.stats.windowFieldVisited === 0 && window.__chatdomKingdom.stats.beaconFieldVisited === 0 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
  assert.equal(await page.locator('.source-ribbon').innerText(), 'CONNECTION LOST');
  await emit();
  await page.waitForFunction(() => window.__chatdomKingdom.stats.activeWindows === 1 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
  assert.equal(await page.locator('.source-ribbon').innerText(), 'SIMULATED');
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile('shots/kingdom/integration/report.json', `${JSON.stringify({
    source: 'synthetic public SSE frames; no real Twitch or Herald producer claim',
    checks: ['explicit simulated origin accepted and labelled', 'Juniper and one warm window visible at both sizes', 'live origin rejected and all light fields cleared', 'same-origin recovery accepted'], snapshots,
  }, null, 2)}\n`);
  console.log('Replay adapter, withdrawal/recovery and two Hearth street captures passed.');
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
}
