// One still through the actual kingdom scene. GPU runs use this page through pc-lease instead.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';
import { superviseCapture } from '../../../apps/web/src/twitch-moments-bench/capture-supervisor.mjs';

if (!process.argv.includes('--worker')) {
  await superviseCapture(process.execPath, [fileURLToPath(import.meta.url), '--worker'], { deadlineMs: 1_200_000 });
} else {
  const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(900_000) });
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Short still exceeded four minutes')), 240_000);
  let server, browser;
  controller.signal.addEventListener('abort', () => { void browser?.close().catch(() => {}); }, { once: true });
  try {
    let base;
    for (let port = 5170; port <= 5186; port++) {
      controller.signal.throwIfAborted();
      process.env.CHATDOM_RAID_SHOW_PORT = String(port);
      try { ({ server, base } = await startCapturePreview('CHATDOM_RAID_SHOW_PORT')); break; }
      catch (error) { if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
    }
    if (!base) throw new Error('No free lane preview port in 5170–5186');
    console.log(`[capture] own preview ${base}`);
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/-/raid-gate?incoming=1&viewers=140&at=12000`);
    console.log('[capture] incoming page opened');
    try {
      await page.waitForFunction(() => window.__chatdomReady === true || document.querySelector('.raid-show-error'), null, { timeout: 210_000 });
    } catch (error) {
      console.error(await page.evaluate(() => ({ ready: window.__chatdomReady, state: window.__chatdomRaidShow?.inspect() })));
      throw error;
    }
    const failure = await page.locator('.raid-show-error').count() ? await page.locator('.raid-show-error').textContent() : null;
    if (failure) throw new Error(failure);
    if (errors.length) throw new Error(errors.join('\n'));
    await page.evaluate(() => document.fonts.ready);
    const out = 'work/evidence/raid-show/caravan-140@1920x1080.png';
    await mkdir('work/evidence/raid-show', { recursive: true });
    await page.screenshot({ path: out });
    await writeFile(out.replace('.png', '.json'), JSON.stringify({ renderer: 'SwiftShader', performanceEvidence: false,
      route: '/-/raid-gate?incoming=1&viewers=140&at=12000', size: [1920, 1080], errors,
      state: await page.evaluate(() => window.__chatdomRaidShow?.inspect()),
    }, null, 2));
    console.log(`Look at ${out}`);
  } finally {
    clearTimeout(timer); await browser?.close(); if (server) await closeCapturePreview(server); await release();
  }
}
