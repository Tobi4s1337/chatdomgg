// Deterministic stills of the effects bench, through the production renderer pieces and the effects library.
// Run from the repository root:
//   node packages/render/src/effects/bench/capture.mjs [--views street,wide,stream] [--sizes 1920x1080] [--time 12]
//     [--hour 20] [--quality balanced] [--effects on|off] [--seed 7] [--name <suffix>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on the first
// free safe capture port, opens headless Chrome on SwiftShader, waits for the bench's first full frame, fails on any
// page, console or shader error, and stops only what it started. SwiftShader timing is not performance evidence.
// Outputs: shots/effects/<view>-t<time>-<quality>[-<name>]@<w>x<h>.png
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const views = (option('--views') ?? 'street,wide,stream').split(',');
if (views.some(view => !['street', 'wide', 'stream'].includes(view))) throw new Error('Expected --views from street,wide,stream');
const sizes = (option('--sizes') ?? '1920x1080').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const time = Number(option('--time') ?? 12), hour = Number(option('--hour') ?? 20), seed = Number(option('--seed') ?? 7);
if (![time, hour, seed].every(Number.isFinite)) throw new Error('Expected finite --time, --hour and --seed');
const quality = option('--quality') ?? 'balanced';
if (!['low', 'balanced', 'high'].includes(quality)) throw new Error('Expected --quality low|balanced|high');
const effects = option('--effects') ?? 'on';
if (effects !== 'on' && effects !== 'off') throw new Error('Expected --effects on|off');
const name = option('--name');
if (name !== undefined && !/^[a-z0-9-]+$/i.test(name)) throw new Error('Expected --name of letters, digits and dashes');
const out = resolve(repo, 'shots/effects');

async function startBenchServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({
      root: here, configFile: false, logLevel: 'error', appType: 'mpa',
      // The bench reads content and world sources relatively, outside its own root.
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [repo] } },
      optimizeDeps: { entries: ['bench.html'] },
      build: { target: 'es2022' }, esbuild: { target: 'es2022' },
    });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  ({ server } = await startBenchServer());
  const base = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ?? `http://127.0.0.1:${server.config.server.port}`;
  console.log(`Effects bench: ${base} (started here)`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const { url, lineNumber } = message.location();
      const text = `${message.text() || 'console error'}${url ? ` (${url}:${lineNumber})` : ''}`;
      errors.push(text);
      console.error(text);
    });
    const url = `${base}/bench.html?view=${views[0]}&hour=${hour}&time=${time}&quality=${quality}&effects=${effects}&seed=${seed}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await page.evaluate(() => document.body.dataset.error);
    if (failure) throw new Error(`Bench failed: ${failure}\n${errors.join('\n')}`);
    for (const view of views) {
      await page.evaluate(next => window.__chatdomEffects.setView(next), view);
      // Two complete frames at the fixed time: the view change lands, then the still is settled.
      await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
      if (errors.length) throw new Error(errors.join('\n'));
      const path = `${out}/${view}-t${time}-${quality}${name ? `-${name}` : ''}@${width}x${height}.png`;
      await page.screenshot({ path, timeout: 180_000 });
      const stats = await page.evaluate(() => window.__chatdomEffects.stats());
      const d = stats.diagnostics;
      console.log(`Captured ${path} (draws ${stats.drawCalls}, triangles ${stats.triangles}, effects ${stats.effects ? 'on' : 'off'}${d ? `, glints ${d.glow.count}/${d.glow.capacity}, smoke ${d.smoke.count}/${d.smoke.capacity}, smoke sources ${d.smoke.sources}, shafts ${d.glow.dustShafts}, bursts ${d.glow.sparkBursts}, flight ${d.glow.flightGlints}` : ''})`);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
