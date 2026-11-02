import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';

// Run from the repository root after building web. This checks a refusal, not a loaded-world frame.
process.env.GRAND_GATE_CAPTURE_PORT ??= '5172';
await mkdir('work/evidence/grand-world', { recursive: true });
const sizes = process.env.GRAND_GATE_CAPTURE_ONCE === '1' ? [[1920, 1080]] : [[1920, 1080], [1280, 720]];
for (const [width, height] of sizes) {
  const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60_000) });
  let preview, browser;
  try {
    preview = await startCapturePreview('GRAND_GATE_CAPTURE_PORT');
    browser = await chromium.launch({ channel: 'chrome', headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`${preview.base}/stream?source=simulated&seed=invented&dockFixture=1&forgeFixture=1`);
    await page.waitForFunction(() => window.__chatdomStream?.phase === 'failed');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.stream-gate h2').textContent(), 'Choose a kingdom');
    assert.equal(await page.locator('.stream-gate p').textContent(), 'Choose a founded kingdom to watch.');
    assert.equal(await page.locator('.stream-gate a').getAttribute('href'), '/map');
    assert.equal(await page.locator('.source-ribbon').count(), 0);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => !!window.__chatdomKingdom || !!window.__chatdomReady), false);
    assert.doesNotMatch(await page.locator('body').innerText(), /SIMULATED/);
    const output = `work/evidence/grand-world/gw10-stream-unavailable@${width}x${height}.png`;
    await page.screenshot({ path: output });
    console.log(JSON.stringify({ output, phase: 'failed', mountedWorld: false, fabricatedReady: false }));
  } finally {
    await browser?.close();
    if (preview) await closeCapturePreview(preview.server);
    await release();
  }
}
