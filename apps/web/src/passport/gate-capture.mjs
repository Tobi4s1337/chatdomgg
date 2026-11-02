/* global URLSearchParams:readonly */
// Captures the citizen card page's passport filled from the Raid Gate's stamps (`/-/passport?surface=card&source=gate`)
// under the shared capture lock: the book open on its stamps, then the holder's clasp pressed and acknowledged.
//   node apps/web/src/passport/gate-capture.mjs [--port 5182] [--view 2]
// Shots land in shots/passport/gate-card@1440x900.png and gate-card-private@1440x900.png.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5182);
assertCapturePort(port, { name: '--port' });
const view = option('--view') ?? '2';
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/passport`;

let server, browser, release;
const errors = [];
try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: ['solid-js', 'solid-js/web', 'zod'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/-/passport?${new URLSearchParams({ surface: 'card', source: 'gate', chrome: '0', owner: '1', view })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 180_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/gate-card@1440x900.png` });
  await page.click('.cpc-clasp');
  await page.waitForSelector('.cpc[data-state="hidden"]', { timeout: 30_000 });
  await page.waitForSelector('.cpc-owner[data-ask="done"]', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${output}/gate-card-private@1440x900.png` });
  console.log(JSON.stringify({ port, shots: ['gate-card@1440x900.png', 'gate-card-private@1440x900.png'], errors }, null, 1));
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await release?.();
}
