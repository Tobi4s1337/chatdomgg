/* global URLSearchParams:readonly */
// Captures the lane-local emote art bench: one 1920×1080 stream-first frame per run.
//   node packages/content/src/genesis-emotes/bench/capture.mjs                       # SIMULATED channel, every use approved
//   node packages/content/src/genesis-emotes/bench/capture.mjs --uses stained-glass  # only glass approved
//   node packages/content/src/genesis-emotes/bench/capture.mjs --channel observed-1  # PinkKittyRose: no approved emotes
//   options: --frame <n> (statue frame), --heading <deg> (vane), --hour <h>, --land <character>, --view statue|glass, --size WxH
// Writes shots/genesis-emotes/<channel>[-<uses>][-f<frame>]@<w>x<h>.png. The server takes an OS-assigned port, closed after.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const channel = option('--channel', 'simulated'), uses = option('--uses', null), frame = option('--frame', null);
const hour = option('--hour', '19.1'), heading = option('--heading', null), land = option('--land', null), view = option('--view', null);
const [width, height] = option('--size', '1920x1080').split('x').map(Number);
if (!/^(simulated|observed-[012])$/.test(channel)) throw new Error('--channel is simulated or observed-0|1|2.');
if (uses !== null && !/^((statue|weathervane|stained-glass)(,(statue|weathervane|stained-glass))*|none)$/.test(uses)) throw new Error('--uses is a comma list of statue, weathervane, stained-glass, or none.');
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
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const query = { channel, hour };
  if (uses !== null) query.uses = uses === 'none' ? '' : uses;
  if (frame !== null) query.frame = frame;
  if (heading !== null) query.heading = heading;
  if (land !== null) query.land = land;
  if (view !== null) query.view = view;
  await page.goto(`${base}/index.html?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomBenchError === 'string', {}, { timeout: 300_000 });
  const failure = await page.evaluate(() => window.__chatdomBenchError);
  if (failure) throw new Error(failure);
  if (errors.length) throw new Error(errors.join('\n'));
  const info = await page.evaluate(() => window.__chatdomBench);
  const output = `${repo}shots/genesis-emotes`;
  await mkdir(output, { recursive: true });
  const suffix = `${uses !== null ? `-${uses.replaceAll(',', '+')}` : ''}${frame !== null ? `-f${frame}` : ''}${land !== null ? `-${land}` : ''}${hour !== '19.1' ? `-h${hour}` : ''}${view !== null ? `-${view}` : ''}`;
  const path = `${output}/${channel}${suffix}@${width}x${height}.png`;
  await page.screenshot({ path });
  console.log(JSON.stringify({ ...info, path: path.replace(repo, '') }));
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
