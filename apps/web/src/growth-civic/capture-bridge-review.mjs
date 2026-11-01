import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { captureEach } from './capture-lifecycle.mjs';

const views = ['hearth', 'tide'].flatMap(style => ['front', 'side', 'back'].map(angle => ({ style, angle })));
await mkdir('shots/growth-civic/bridge-review', { recursive: true });
await captureEach([...views, { sheet: true }], {
  acquire: acquireCaptureLock,
  async capture(item) {
    let server, browser;
    try {
      if (!('sheet' in item)) {
        for (const port of CAPTURE_PORTS) {
          try {
            server = await createServer({ root: process.cwd(), configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, ws: false } });
            await server.listen(); break;
          } catch (error) { await server?.close(); server = undefined; if (error.code !== 'EADDRINUSE' && !/already in use/.test(error.message)) throw error; }
        }
        if (!server) throw new Error('No capture port available');
      }
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
      if ('sheet' in item) {
        const panels = [];
        for (const { style, angle } of views) {
          const png = await readFile(`shots/growth-civic/bridge-review/${style}-${angle}@1920x1080.png`);
          panels.push(`<figure><figcaption>${style} · ${angle}</figcaption><img alt="${style} ${angle}" src="data:image/png;base64,${png.toString('base64')}"></figure>`);
        }
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.setContent(`<!doctype html><html><head><style>body{margin:0;padding:24px;background:#222d2d;color:#f2dfb6;font:20px Georgia,serif}h1{font-size:25px;margin:0 0 18px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}figcaption{text-transform:capitalize;margin-bottom:6px}img{display:block;width:100%}</style></head><body><h1>SIMULATED · Bridge level 4 · three angles</h1><main>${panels.join('')}</main></body></html>`);
        await page.screenshot({ path: 'shots/growth-civic/bridge-review/contact@1440x900.png' });
      } else {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/apps/web/src/growth-civic/bridge-review.html?style=${item.style}&angle=${item.angle}`);
        await page.waitForFunction(() => window.__chatdomReady === true || document.querySelector('.status')?.textContent?.startsWith('Fixture failed:'), null, { timeout: 240000 });
        const status = await page.locator('.status').innerText();
        if (errors.length || status.startsWith('Fixture failed:')) throw new Error([...errors, status].join('\n'));
        await page.screenshot({ path: `shots/growth-civic/bridge-review/${item.style}-${item.angle}@1920x1080.png` });
      }
    } finally { try { await browser?.close(); } finally { await server?.close(); } }
  },
});
