import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';

let release, server, browser;
try {
  release = await acquireCaptureLock();
  for (let attempt = 0; attempt < 15 && !server; attempt++) {
    for (const port of CAPTURE_PORTS) {
      try {
        server = await createServer({ root: process.cwd(), configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, ws: false } });
        await server.listen(); break;
      } catch (error) { await server?.close(); server = undefined; if (error.code !== 'EADDRINUSE' && !/already in use/.test(error.message)) throw error; }
    }
    if (!server && attempt < 14) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!server) throw new Error('No capture port available');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/apps/web/src/growth-civic/mounted-fixture.html`);
  await page.waitForFunction(() => window.__chatdomReady === true || document.querySelector('.status')?.textContent?.startsWith('Fixture failed:'), null, { timeout: 240000 });
  const status = await page.locator('.status').innerText();
  if (errors.length || status.startsWith('Fixture failed:')) throw new Error([...errors, status].join('\n'));
  await mkdir('shots/growth-civic', { recursive: true });
  await page.screenshot({ path: 'shots/growth-civic/mounted@1440x900.png' });
} finally { try { await browser?.close(); } finally { try { await server?.close(); } finally { await release?.(); } } }
