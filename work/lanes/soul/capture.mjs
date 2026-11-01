import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';

async function bounded(job, milliseconds, label) {
  let timer;
  try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const queueMs = Number(process.env.SOUL_CAPTURE_QUEUE_MS ?? 600_000);
if (!Number.isInteger(queueMs) || queueMs < 1000 || queueMs > 1_800_000) throw new RangeError('SOUL_CAPTURE_QUEUE_MS must be 1000–1800000');
const requested = process.argv.slice(2);
if (requested.length > 1) throw new Error('Capture exactly one still per invocation. Choose dawn, noon, rain, lamplighter, dusk, night, snow, phone or stream.');
const cases = [
  ['dawn', 6.005, 'natural', '2026-06-20', 1440, 900],
  ['noon', 12, 'clear', '2026-06-20', 1440, 900],
  ['rain', 14, 'rain', '2026-06-20', 1440, 900],
  ['lamplighter', 18.755, 'clear', '2026-06-20', 1440, 900],
  ['dusk', 19.5, 'clear', '2026-06-20', 1440, 900],
  ['night', 23, 'clear', '2026-06-20', 1440, 900],
  ['snow', 12, 'snow', '2026-12-24', 1440, 900],
  ['phone', 18.755, 'clear', '2026-06-20', 390, 844],
  ['stream', 19.5, 'clear', '2026-06-20', 1920, 1080],
].filter(([name]) => name === (requested[0] ?? 'dawn'));
if (!cases.length) throw new Error('Unknown soul still');
await mkdir('shots/soul', { recursive: true });
await mkdir('work/evidence/soul', { recursive: true });
async function startPreview() {
  for (const port of CAPTURE_PORTS) {
    try {
      return await preview({ root: 'apps/web', configFile: false, preview: { host: '127.0.0.1', port, strictPort: true } });
    } catch (error) {
      if (!/already in use|EADDRINUSE/.test(String(error))) throw error;
    }
  }
  // The shared preview helper permits port zero for parallel lane checks;
  // all named capture ports can be occupied by other lanes on this host.
  return preview({ root: 'apps/web', configFile: false, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
}
  const log = [];
  for (const [name, hour, weather, date, width, height] of cases) {
    // Keep the FIFO ticket while other lanes finish; no browser/server exists while queued.
    // A still owns the capture lock only for its own browser's lifetime.
    const queued = globalThis.AbortSignal.timeout(queueMs);
    const release = await acquireCaptureLock({ signal: queued }).catch(error => {
      if (!queued.aborted) throw error;
      console.log(`${new Date().toISOString()} queue timeout; no browser launched`);
      process.exitCode = 75;
      return undefined;
    });
    if (!release) continue;
    const acquired = Date.now();
    let browser, server;
    try {
      server = await startPreview();
      const address = server.httpServer.address();
      console.log(`Soul preview: http://127.0.0.1:${address.port}`);
      console.log(`${new Date().toISOString()} starting Chrome for ${name}`);
      browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
      console.log(`${new Date().toISOString()} Chrome launched`);
      const page = await bounded(browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 }), 10_000, 'Page creation');
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const path = `/-/soul?seed=42&hour=${hour}&weather=${weather}&date=${date}&biome=${name === 'snow' ? 'highland' : 'coastal'}${name === 'stream' ? '&view=stream' : ''}`;
      await page.goto(`http://127.0.0.1:${address.port}${path}`, { timeout: 15_000 });
      await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
      await bounded(page.evaluate(() => document.fonts.ready), 5000, 'Fonts');
      await bounded(page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))), 10_000, 'First frames');
      const status = await bounded(page.evaluate(() => ({ frame: window.__soulFrame, scene: window.__soulStats, overflow: document.documentElement.scrollWidth > innerWidth })), 5000, 'Scene inspection');
      if (!status.frame || status.overflow || errors.length) throw new Error(`${name}: ${JSON.stringify({ errors, ...status })}`);
      const file = `${name}@${width}x${height}.png`;
      await page.screenshot({ path: `shots/soul/${file}`, timeout: 15_000 });
      await copyFile(`shots/soul/${file}`, `work/evidence/soul/${file}`);
      const buildFingerprint = createHash('sha256').update(await readFile('apps/web/dist/index.html')).digest('hex');
      log.push({ name, path, file, width, height, buildFingerprint, leaseMs: Date.now() - acquired, ...status });
      await writeFile(`work/evidence/soul/capture-${name}.json`, JSON.stringify(log.at(-1), null, 2));
      console.log(`Captured ${file}`);
    } finally {
      try { await browser?.close(); }
      finally { try { if (server) await new Promise(resolve => server.httpServer.close(resolve)); } finally { await release(); console.log(`${new Date().toISOString()} released after ${Date.now() - acquired}ms`); } }
    }
  }
  if (log.length) await writeFile(`work/evidence/soul/captures${requested.length ? '-' + requested.join('-') : ''}.json`, JSON.stringify(log, null, 2));
