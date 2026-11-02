// Stills of the door between two rooms (the curtain going in, the stranded way back, the refused note), at the web
// sizes, under the shared capture lock. Serves this checkout's web app for its own run only.
// node apps/web/src/play/bench/portal-capture.mjs [--out <dir>]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const web = `${repo}apps/web`;
const out = option('--out') ?? `${repo}work/evidence/play/portal`;
const PORTS = [5178, 5179];
await mkdir(out, { recursive: true });
const release = await acquireCaptureLock();
let server, browser;
try {
  for (const port of PORTS) {
    const next = await createServer({ configFile: `${web}/vite.config.ts`, root: web, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true } });
    try { await next.listen(); server = { next, port }; break; } catch (error) { await next.close(); if (!/already in use/.test(error?.message ?? '')) throw error; }
  }
  if (!server) throw new Error('Every bench port is in use');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const shots = [['closed', 1440, 900], ['closed', 390, 844], ['stranded', 1440, 900], ['refused', 1440, 900]];
  for (const [state, width, height] of shots) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', error => console.error('page error', error.message));
    await page.goto(`http://127.0.0.1:${server.port}/src/play/bench/portal.html?state=${state}`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await page.waitForTimeout(state === 'closed' ? 900 : 400);
    const path = `${out}/${state}@${width}x${height}.png`;
    await page.screenshot({ path });
    console.log(path);
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.next.close();
  await release();
}
