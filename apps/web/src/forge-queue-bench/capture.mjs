import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

// DOM-only review of the anvil's line with staged fixture replies: no kingdom, no WebGL, no network, no port.
// The page is built once into a temporary folder and served to the browser through request interception.
const here = fileURLToPath(new URL('.', import.meta.url));
const web = resolve(here, '../..'), repo = resolve(web, '../..');
const output = join(repo, 'work/evidence/forge-wish/fw11-queue'), built = '/tmp/chatdom-forge-wish/queue-bench';
const origin = 'http://forge-queue.bench';
await build({ configFile: false, root: web, logLevel: 'warn', plugins: [solid()],
  build: { outDir: built, emptyOutDir: true, target: 'es2022', rollupOptions: { input: join(here, 'index.html') } } });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };

await mkdir(output, { recursive: true });
const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(120_000) });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const shots = (process.argv[2] ?? 'broadcaster:1440x900,broadcaster:390x844,maker:1440x900,maker:390x844,anvil:1440x900,anvil:390x844').split(',');
  for (const shot of shots) {
    const [view, size] = shot.split(':'); const [width, height] = size.split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const file = join(built, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!file.startsWith(built)) return route.abort();
      try { return route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(file) }); }
      catch { return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }); }
    });
    await page.goto(`${origin}/src/forge-queue-bench/index.html?view=${view}`);
    await page.waitForFunction(() => window.__chatdomReady === true, undefined, { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600); // let the veil's fade settle
    assert.deepEqual(errors, [], 'Queue fixture must have no browser exceptions');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Must fit the viewport');
    await page.screenshot({ path: `${output}/${view}@${width}x${height}.png` });
    console.log(`${view}@${width}x${height}:`, await page.evaluate(() => document.querySelector('.forge-queue-line span, .forge-queue-anvil')?.textContent));
    await page.close();
  }
} finally { await browser?.close(); await release(); }
