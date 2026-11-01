/* global setInterval:readonly, clearInterval:readonly */
// Captures the SIMULATED generated-pieces bench through the production renderer pieces, one still per run.
// Run from the repository root:
//   node apps/web/src/genesis/generated/pieces/bench/capture.mjs [--view overview|stage|stones|garden] [--hour 19.4]
//     [--size 1920x1080] [--name <file stem>] [--base-url http://127.0.0.1:<port>]
// It starts its own Vite dev server from the web app's config on a free capture port (never 5187 or 5190–5197),
// loads the page and waits for the scene to mesh, then takes the shared capture lock only for the still itself and
// releases it straight after. Any page, console or shader error fails the run; it stops only what it started.
// Output: shots/genesis-door/pieces/<name>@<w>x<h>.png and <name>.json.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const view = option('--view') ?? 'overview', hour = Number(option('--hour') ?? 19.4);
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
if (!['overview', 'stage', 'stones', 'garden'].includes(view)) throw new Error('Expected --view overview|stage|stones|garden');
if (!(hour >= 0 && hour < 24)) throw new Error('Expected --hour in [0,24)');
if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error('Expected --size WxH');
const name = option('--name') ?? `${view}-${hour}`;
const out = 'shots/genesis-door/pieces';
const page = `/@fs${fileURLToPath(new URL('./index.html', import.meta.url))}`;

async function startBenchServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      resolve: { dedupe: ['three', '@chatdom/render', '@chatdom/voxel', '@chatdom/shared', '@chatdom/content', '@chatdom/world'] },
      optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, ws: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

let server, browser, release;
try {
  let base = option('--base-url');
  if (!base) ({ server, base } = await startBenchServer());
  console.log(`Bench: ${base}${server ? ' (started here)' : ''}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  const tab = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  tab.on('pageerror', error => errors.push(error.message));
  tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
  await tab.goto(`${base}${page}?view=${view}&hour=${hour}`);
  if (args.includes('--probe')) tab.on('console', message => console.log(`[page] ${message.type()}: ${message.text()}`));
  const progress = setInterval(() => { void tab.evaluate(() => window.__chatdomStage ?? 'starting').then(stage => console.log(`[bench] ${stage}`), () => {}); }, 20_000);
  try {
    await tab.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 270_000 });
  } finally { clearInterval(progress); }
  const failure = await tab.evaluate(() => document.body.dataset.error);
  if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
  await tab.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
  release = await acquireCaptureLock();
  const held = Date.now();
  const path = `${out}/${name}@${width}x${height}.png`;
  await tab.screenshot({ path, timeout: 120_000 });
  const stats = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomPieces.stats)));
  await release(); release = undefined;
  console.log(`Captured ${path} (lock held ${Math.round((Date.now() - held) / 1000)} s)`);
  await writeFile(`${out}/${name}.json`, `${JSON.stringify(stats, null, 2)}\n`);
  await tab.close();
} finally {
  await release?.();
  await browser?.close();
  await server?.close();
}
