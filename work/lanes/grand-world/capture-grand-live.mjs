import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';

process.env.GRAND_LIVE_CAPTURE_PORT ??= '5172';
await mkdir('work/evidence/grand-world', { recursive: true });
const sizes = process.env.GRAND_LIVE_CAPTURE_WIDTH === '390' ? [[390, 844]] : [[1440, 900]];
for (const [width, height] of sizes) {
  const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60_000) });
  let preview, browser;
  try {
    preview = await startCapturePreview('GRAND_LIVE_CAPTURE_PORT');
    browser = await chromium.launch({ channel: 'chrome', headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [], api = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/\/(api|realm)\//.test(new URL(request.url()).pathname)) api.push(request.url()); });
    await page.goto(`${preview.base}/-/grand?channel=unfounded-unknown&source=simulated&seed=willowmere&still=1`, { timeout: 20_000 });
    await page.locator('[data-grand-phase="unavailable"]').waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => window.__chatdomReady), false);
    assert.equal(await page.locator('.grand-live__map').getAttribute('href'), '/map');
    assert.doesNotMatch(await page.locator('body').innerText(), /SIMULATED|Growing the forests|Raising the land/);
    assert.equal(await page.locator('input[type="range"]').isDisabled(), true);
    assert.deepEqual(errors, []); assert.deepEqual(api, []);
    assert.deepEqual(await page.locator('.grand-live').boundingBox(), { x: 0, y: 0, width, height });
    const box = await page.locator('.grand-live__paper').boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    const output = `work/evidence/grand-world/gw10-grand-unavailable@${width}x${height}.png`;
    await page.screenshot({ path: output, timeout: 15_000 });
    console.log(JSON.stringify({ output, phase: 'unavailable', noFixtureFallback: true, noApi: true, errors }));
  } finally { await browser?.close(); if (preview) await closeCapturePreview(preview.server); await release(); }
}
