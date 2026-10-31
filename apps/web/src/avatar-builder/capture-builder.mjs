// Avatar builder capture (spec 49 acceptance): the builder at page and panel size, SIMULATED people and records.
//
//   node apps/web/src/avatar-builder/capture-builder.mjs [--out shots/avatar-style/builder] [--only page-1920]
//
// Writes `<name>@<w>x<h>.png` for each view below. Every view is still (no idle spin, no blink) so runs compare.
// Owns a temporary Vite server on capture port 5189 under the shared capture lock.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = flag('--out', 'shots/avatar-style/builder');
const only = flag('--only', '').split(',').filter(Boolean);
const PORT = assertCapturePort(5189);
const LAUNCH = { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };

/** name, query, width, height */
const VIEWS = [
  ['page-hair', 'who=veteran&tab=hair', 1920, 1080],
  ['page-earned', 'who=veteran&tab=earned', 1920, 1080],
  ['page-newcomer-earned', 'who=newcomer&tab=earned', 1440, 900],
  ['page-face', 'who=regular&tab=face', 1440, 900],
  ['page-top', 'who=regular&tab=top', 1440, 900],
  ['page-below', 'who=lapsed&tab=below', 1440, 900],
  ['phone-hair', 'who=regular&tab=hair', 390, 844],
  ['panel-hair', 'who=veteran&tab=hair&layout=panel', 318, 496],
  ['panel-earned', 'who=regular&tab=earned&layout=panel', 318, 496],
  ['panel-face', 'who=newcomer&tab=face&layout=panel', 318, 496],
];

await mkdir(out, { recursive: true });
const release = await acquireCaptureLock({ priority: 'main' });
let server, browser;
try {
  server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', optimizeDeps: { entries: ['src/avatar-builder/builder.html'] }, server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await server.listen();
  browser = await chromium.launch(LAUNCH);
  for (const [name, query, width, height] of VIEWS) {
    if (only.length && !only.includes(name)) continue;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/src/avatar-builder/builder.html?still=1&${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 300000 });
    if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
    const path = join(out, `${name}@${width}x${height}.png`);
    await page.screenshot({ path });
    await page.close();
    console.log(`[builder] ${path} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
} finally {
  await browser?.close(); await server?.close(); await release();
}
