// A short software look at raised channel worlds (the lane's sketch store), under the shared capture lock.
// usage: node work/lanes/grand-world/look-gw13.mjs <login…>   (stills at 960x600 in shots/grand-world/gw13-look)
// Serves the store as the realm's land routes on capture port 5171 and the built apps/web on 5172 (GW13_LAND_PORT, GW13_WEB_PORT).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview as createPreview } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const logins = process.argv.slice(2), landPort = assertCapturePort(Number(process.env.GW13_LAND_PORT ?? 5171)), webPort = assertCapturePort(Number(process.env.GW13_WEB_PORT ?? 5172)), out = 'shots/grand-world/gw13-look';
await mkdir(out, { recursive: true });
const land = spawn('node', ['work/lanes/grand-world/sheet-gw13.mjs', 'serve', String(landPort)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((done, fail) => { land.stdout.on('data', d => { if (String(d).includes('serving')) done(); }); land.once('exit', c => fail(new Error(`land ${c}`))); });
process.env.CHATDOM_LAND_TARGET = process.env.CHATDOM_REALM_TARGET = `http://127.0.0.1:${landPort}`;
const server = await createPreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', preview: { host: '127.0.0.1', port: webPort, strictPort: true } });
let release, browser;
try {
  release = await acquireCaptureLock({ priority: 'lane' });
  const started = Date.now();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const login of logins) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    page.on('pageerror', e => console.error('[page]', e.message));
    await page.goto(`http://127.0.0.1:${webPort}/-/grand?channel=${login}&capture=1&tier=software&hour=17.6`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 150_000, polling: 1000 });
    await page.screenshot({ path: `${out}/${login}@960x600.png`, timeout: 120_000 });
    console.log(login, JSON.stringify(await page.evaluate(() => window.__chatdomGrand?.stats()?.sketch)), `${Math.round((Date.now() - started) / 1000)} s`);
    await page.close();
  }
} finally { await browser?.close(); await release?.(); await new Promise(d => server.httpServer.close(() => d())); land.kill('SIGTERM'); }
