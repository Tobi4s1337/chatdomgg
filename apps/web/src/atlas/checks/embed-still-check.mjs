/* global AbortSignal */
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60000) });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.1:5175'}/-/atlas-embed?mode=explore`);
  await page.waitForFunction(() => document.querySelector('[data-atlas-ready="still"] [data-state="still"]'), null, { timeout: 45000 });
  const result = await page.evaluate(async () => ({ ready: await window.__atlasBench.handle.ready, dated: !!document.querySelector('[data-as-of]')?.getAttribute('data-as-of'), canvas: !!document.querySelector('.atlas-still-canvas'), search: !!document.querySelector('input[role="combobox"]') }));
  if (result.ready !== 'still' || !result.dated || !result.canvas || !result.search || errors.length) throw new Error(JSON.stringify({ result, errors }));
  await page.screenshot({ path: 'work/evidence/atlas-map/am10-embed-still-1440.png' });
  await page.evaluate(() => window.__atlasBench.dispose());
  if (await page.locator('canvas').count()) throw new Error('Still canvas survived disposal');
  console.log('PASS WebGL-free dated still, search, and disposal', JSON.stringify(result));
} finally { await browser?.close(); await release(); }
