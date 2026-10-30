// Captures the MagicaVoxel import on the real build surface with the authored lantern-cottage fixture:
// a malformed file, the fitted 2× preview and the same box raised past the plot's height.
//   node apps/web/src/vox-import/capture.mjs --base-url http://127.0.0.1:<port>
// Without --base-url it serves the built web app itself. Shots go to shots/vox-import/.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/vox-import`;
const fixture = await readFile(`${root}packages/vox-import/fixtures/lantern-cottage.vox`);
const SIZES = [[1440, 900], [390, 844]];

const setAxis = async (page, axis, value) => { const field = page.locator(`[data-vox-axis="${axis}"] input`); await field.fill(String(value)); await field.press('Enter'); };
const summary = page => page.locator('[data-vox-summary]').evaluate(element => ({
  placement: element.dataset.voxPlacement, text: element.querySelector('dl').innerText.replaceAll('\n', ' '),
  replace: element.querySelector('[data-vox-replace]').innerText, error: document.querySelector('.vox-import-error')?.innerText.replaceAll('\n', ' / ') ?? null,
}));
// The preview mesh comes from main's worker pool, which exposes no completion flag: wait for the settled summary, then let SwiftShader draw.
const settle = async page => { await page.waitForFunction(() => !document.querySelector('[data-vox-summary].settling')); await page.waitForTimeout(4500); };

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_VOX_IMPORT_PORT'));
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [width, height] of SIZES) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(180_000);
    const step = text => console.error(`[vox-import ${width}×${height}] ${new Date().toISOString().slice(11, 19)} ${text}`);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${base}/?tier=hamlet&hour=19.5&build=1&source=simulated`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true && !!document.querySelector('[data-chatdom-build]'), {}, { timeout: 240_000 });
    await page.evaluate(() => window.localStorage.clear());
    step('ready');
    await page.locator('.vox-import-tab').click();

    // A malformed file first: it must be refused while the picker stays usable.
    await page.locator('[data-vox-file]').setInputFiles({ name: 'broken-cottage.vox', mimeType: 'application/octet-stream', buffer: fixture.subarray(0, fixture.length - 100) });
    await page.locator('[data-vox-error]').waitFor();
    const refusal = await page.locator('[data-vox-error]').innerText();
    await page.screenshot({ path: `${output}/malformed@${width}x${height}.png` });

    await page.locator('[data-vox-file]').setInputFiles({ name: 'lantern-cottage.vox', mimeType: 'application/octet-stream', buffer: fixture });
    await page.locator('.vox-import-models label').first().click();
    await page.locator('[data-vox-summary]').waitFor();
    // Fit it: double size, slide it across and set it down. Every value comes from the real controls.
    await page.locator('[data-vox-scale="2"]').click();
    await setAxis(page, 'X', 6);
    await page.locator('[data-vox-axis="Z"] button').last().click();
    await settle(page);
    const fitted = await summary(page);
    if (fitted.placement !== 'inside') throw new Error(`Expected an accepted placement, got ${JSON.stringify(fitted)}`);
    await page.screenshot({ path: `${output}/fit@${width}x${height}.png` });
    step('fit captured');

    // Raise it past the plot's height: the same box is outlined as refused, and the summary says why.
    await setAxis(page, 'Y', 60);
    step('raised');
    await settle(page);
    step('raised and settled');
    const outside = await summary(page);
    if (outside.placement !== 'outside') throw new Error(`Expected a refused placement, got ${JSON.stringify(outside)}`);
    await page.screenshot({ path: `${output}/outside@${width}x${height}.png` });
    step('outside captured');
    await page.locator('[data-vox-ground]').click();
    await settle(page);
    if ((await summary(page)).placement !== 'inside') throw new Error('Ground did not bring the carving back onto the plot');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${width}×${height}: refused malformed bytes (${refusal.replaceAll('\n', ' / ')})`);
    console.log(`  fit: ${JSON.stringify(fitted)}`);
    console.log(`  outside: ${JSON.stringify(outside)}`);
    await page.close();
  }
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release?.();
}
