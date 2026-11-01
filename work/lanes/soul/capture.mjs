import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';

const requested = process.argv.slice(2);
const cases = [
  ['dawn', 6.005, 'natural', '2026-06-20', 1440, 900],
  ['noon', 12, 'clear', '2026-06-20', 1440, 900],
  ['rain', 14, 'rain', '2026-06-20', 1440, 900],
  ['lamplighter', 17.005, 'clear', '2026-06-20', 1440, 900],
  ['dusk', 19.5, 'clear', '2026-06-20', 1440, 900],
  ['night', 23, 'clear', '2026-06-20', 1440, 900],
  ['snow', 12, 'snow', '2026-12-24', 1440, 900],
  ['phone', 17.005, 'clear', '2026-06-20', 390, 844],
  ['stream', 19.5, 'clear', '2026-06-20', 1920, 1080],
].filter(([name]) => !requested.length || requested.includes(name));
await mkdir('shots/soul', { recursive: true });
await mkdir('work/evidence/soul', { recursive: true });
async function startPreview() {
  for (const port of CAPTURE_PORTS) {
    try {
      return await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', preview: { host: '127.0.0.1', port, strictPort: true } });
    } catch (error) {
      if (!/already in use|EADDRINUSE/.test(String(error))) throw error;
    }
  }
  // The shared preview helper permits port zero for parallel lane checks;
  // all named capture ports can be occupied by other lanes on this host.
  return preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', preview: { host: '127.0.0.1', port: 0, strictPort: true } });
}
  const log = [];
  for (const [name, hour, weather, date, width, height] of cases) {
    // A still owns the capture lock only for its own browser's lifetime.
    const release = await acquireCaptureLock();
    let browser, server;
    try {
      server = await startPreview();
      const address = server.httpServer.address();
      console.log(`Soul preview: http://127.0.0.1:${address.port}`);
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const path = `/-/soul?seed=42&hour=${hour}&weather=${weather}&date=${date}&biome=${name === 'snow' ? 'highland' : 'coastal'}${name === 'stream' ? '&view=stream' : ''}`;
      await page.goto(`http://127.0.0.1:${address.port}${path}`);
      await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const status = await page.evaluate(() => ({ frame: window.__soulFrame, overflow: document.documentElement.scrollWidth > innerWidth }));
      if (!status.frame || status.overflow || errors.length) throw new Error(`${name}: ${JSON.stringify({ errors, ...status })}`);
      const file = `${name}@${width}x${height}.png`;
      await page.screenshot({ path: `shots/soul/${file}`, timeout: 60_000 });
      await page.screenshot({ path: `work/evidence/soul/${file}`, timeout: 60_000 });
      log.push({ name, path, file, width, height, ...status });
      await writeFile(`work/evidence/soul/capture-${name}.json`, JSON.stringify(log.at(-1), null, 2));
      console.log(`Captured ${file}`);
    } finally {
      try { await browser?.close(); }
      finally { try { if (server) await new Promise(resolve => server.httpServer.close(resolve)); } finally { await release(); } }
    }
  }
  await writeFile(`work/evidence/soul/captures${requested.length ? '-' + requested.join('-') : ''}.json`, JSON.stringify(log, null, 2));
