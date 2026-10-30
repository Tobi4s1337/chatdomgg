// Captures the MagicaVoxel import on the real build surface with the authored lantern-cottage fixture.
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

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_VOX_IMPORT_PORT'));
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [width, height] of SIZES) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${base}/?tier=hamlet&hour=19.5&build=1&source=simulated`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true && !!document.querySelector('[data-chatdom-build]'), {}, { timeout: 240_000 });
    await page.evaluate(() => window.localStorage.clear());
    await page.locator('.vox-import-tab').click();

    // A malformed file first: it must be refused while the picker stays usable.
    await page.locator('[data-vox-file]').setInputFiles({ name: 'broken-cottage.vox', mimeType: 'application/octet-stream', buffer: fixture.subarray(0, fixture.length - 100) });
    await page.locator('[data-vox-error]').waitFor();
    const refusal = await page.locator('[data-vox-error]').innerText();
    await page.screenshot({ path: `${output}/malformed@${width}x${height}.png` });

    await page.locator('[data-vox-file]').setInputFiles({ name: 'lantern-cottage.vox', mimeType: 'application/octet-stream', buffer: fixture });
    await page.locator('.vox-import-models label').first().click();
    await page.locator('[data-vox-summary]').waitFor();
    // The preview mesh comes from main's worker pool, which exposes no completion flag: let SwiftShader settle.
    await page.waitForTimeout(5000);
    if (errors.length) throw new Error(errors.join('\n'));
    const path = `${output}/preview@${width}x${height}.png`;
    await page.screenshot({ path });
    console.log(`${width}×${height}: refused malformed bytes (${refusal.replaceAll('\n', ' / ')}); preview → ${path}`);
    await page.close();
  }
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release?.();
}
