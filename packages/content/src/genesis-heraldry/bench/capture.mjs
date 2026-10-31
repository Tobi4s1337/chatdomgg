/* global URLSearchParams:readonly */
// Captures the lane-local heraldry bench: one 1920×1080 stream-first frame per requested recipe.
//   node packages/content/src/genesis-heraldry/bench/capture.mjs --recipe 0 --land 2 [--targets profile] [--hour 19.1] [--size 1920x1080]
// Writes shots/genesis-heraldry/<style>-<landscape>-<shape>-<charge>-<cut>[-snapped]@<w>x<h>.png. The server is an OS-assigned port, closed after.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const recipe = option('--recipe', '0'), land = option('--land', '2'), hour = option('--hour', '19.1'), targets = option('--targets', 'none');
const [width, height] = option('--size', '1920x1080').split('x').map(Number);
if (!/^[012]$/.test(recipe) || !/^[012]$/.test(land)) throw new Error('--recipe and --land are 0, 1 or 2.');
if (!/^(none|profile)$/.test(targets)) throw new Error('--targets is none or profile.');
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const bench = fileURLToPath(new URL('.', import.meta.url));

let server, browser, release;
try {
  release = await acquireCaptureLock();
  server = await createServer({
    root: bench, configFile: false, logLevel: 'warn', appType: 'mpa',
    server: { host: '127.0.0.1', port: assertCapturePort(0, { allowZero: true }), strictPort: true, hmr: false, fs: { allow: [repo] } },
    resolve: {
      alias: [
        { find: /^three$/, replacement: `${repo}packages/render/node_modules/three/build/three.module.js` },
        { find: /^@chatdom\/render$/, replacement: `${repo}packages/render/src/index.ts` },
        { find: /^@chatdom\/voxel$/, replacement: `${repo}packages/voxel/src/index.ts` },
      ],
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/index.html?${new URLSearchParams({ recipe, land, hour, targets })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomBenchError === 'string', {}, { timeout: 300_000 });
  const failure = await page.evaluate(() => window.__chatdomBenchError);
  if (failure) throw new Error(failure);
  if (errors.length) throw new Error(errors.join('\n'));
  const info = await page.evaluate(() => window.__chatdomBench);
  const output = `${repo}shots/genesis-heraldry`;
  await mkdir(output, { recursive: true });
  const { shape, charge, cut } = info.device;
  const path = `${output}/${info.style}-${info.land}-${shape}-${charge}-${cut}${info.treatment === 'snapped' ? '-snapped' : ''}@${width}x${height}.png`;
  await page.screenshot({ path });
  console.log(JSON.stringify({ ...info, path: path.replace(repo, '') }));
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
