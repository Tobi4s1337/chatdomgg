/* global requestAnimationFrame:readonly */
// Captures the Twitch moments bench (SIMULATED source) under the shared host capture lock: one owned Vite server
// and one Chromium, both closed before the lock is released. Each scenario opens frozen at kingdom time START and
// is seeked through its anticipation, action and settle, then tiled into one contact sheet.
//   node apps/web/src/twitch-moments-bench/capture.mjs [--port 5198] [--set support|spectacle] [--only gift,cart] [--sheet-only]
// --sheet-only tiles the frames already on disk for every run, after partial re-captures with --only.
// Frames land in shots/twitch-moments/<scenario>-<beat>@<w>x<h>.png; the sheet in shots/twitch-moments/sheet-<set>.png.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5198);
assertCapturePort(port, { name: '--port' });
const only = option('--only')?.split(','), sheetOnly = args.includes('--sheet-only'), set = option('--set') ?? 'support';
if (set !== 'support' && set !== 'spectacle') throw new Error('--set must be support or spectacle.');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/twitch-moments`;

const DESKTOP = [1440, 900], PHONE = [390, 844], STREAM = [1920, 1080];
/** scenario, viewport and the offsets (ms after START) of anticipation, action and settle. */
const SUPPORT = [
  ['gift', DESKTOP, [['anticipation', 2500], ['action', 3900], ['settle', 6900]]],
  ['cart', DESKTOP, [['anticipation', 3800], ['action', 7000], ['settle', 11800]]],
  ['resub', DESKTOP, [['anticipation', 500], ['action', 1500], ['settle', 5200]]],
  ['forward', PHONE, [['anticipation', 2500], ['action', 4200], ['settle', 6900]]],
  ['cart', PHONE, [['anticipation', 3800], ['action', 7000], ['settle', 11800]]],
  ['cart', STREAM, [['anticipation', 3800], ['action', 7000], ['settle', 11800]]],
  ['tiers', STREAM, [['anticipation', 500], ['action', 1500], ['settle', 5200]]],
  ['neighbours', DESKTOP, [['anticipation', 600], ['action', 2200], ['settle', 6000]]],
  ['cloak', PHONE, [['anticipation', 500], ['action', 1500], ['settle', 5200]]],
  ['lapse', PHONE, [['anticipation', 400], ['action', 1300], ['settle', 3400]]],
  ['rejoin', STREAM, [['anticipation', 600], ['action', 2200], ['settle', 6000]]],
  ['friend', DESKTOP, [['anticipation', 3800], ['action', 7000], ['settle', 11800]]],
  ['ward', STREAM, [['anticipation', 3800], ['action', 6800], ['settle', 14000]]],
];
/** The sky, the train and the dragon. Battle scenarios run the SIMULATED realm in setup, so their beats sit later. */
const SPECTACLE = [
  ['skyfire', STREAM, [['aurora', 3400], ['name', 7600], ['procession', 11200]]],
  ['volley', STREAM, [['launch', 1700], ['burst', 4300], ['fade', 8200]]],
  ['spark', PHONE, [['rise', 1200], ['peak', 2300], ['fade', 3600]]],
  ['street', DESKTOP, [['launch', 1500], ['burst', 3500], ['willow', 5600]]],
  ['beast', DESKTOP, [['enter', 2600], ['overhead', 4800], ['exit', 8400]]],
  ['kites', PHONE, [['rise', 3000], ['sway', 9000], ['drift', 15500]]],
  ['volleys', STREAM, [['first', 3500], ['second', 13800], ['ribbon', 16500]]],
  ['balloon', DESKTOP, [['rise', 1200], ['float', 6000], ['drift', 14000]]],
  ['confetti', PHONE, [['burst', 1200], ['fall', 3600], ['settle', 6800]]],
  ['train', STREAM, [['arrive', 1500], ['bunting', 3400], ['running', 7000]]],
  ['closing', DESKTOP, [['fireworks', 2600], ['stir', 5200], ['home', 9000]]],
  ['dragon', STREAM, [['eyes', 800], ['roar', 3200], ['climb', 6400]]],
  ['battle', DESKTOP, [['orbit', 22700], ['swoop', 26800], ['breath', 31500]]],
  ['victory', STREAM, [['reel', 31200], ['spiral', 34600], ['bow', 38000]]],
  ['retreat', PHONE, [['turn', 31000], ['away', 34200], ['settle', 39000]]],
  ['bell', DESKTOP, [['strokes', 1400], ['wake', 5800], ['rise', 9400]]],
  ['unbound', STREAM, [['earned', 800], ['stir', 2400], ['honest', 5200]]],
];
const RUNS = (set === 'spectacle' ? SPECTACLE : SUPPORT).filter(([scenario]) => !only || only.includes(scenario));

let server, browser, release;
const problems = [], rows = [];
const framePath = (scenario, beat, [width, height]) => `${output}/${scenario}-${beat}@${width}x${height}.png`;
if (sheetOnly) {
  for (const [scenario, [width, height], beats] of RUNS) rows.push({ scenario, width, height, row: beats.map(([beat]) => framePath(scenario, beat, [width, height])) });
} else try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const disconnected = new Promise((_, reject) => browser.once('disconnected', () => reject(new Error('Chromium disconnected during capture'))));
  await Promise.race([disconnected, (async () => {
  await mkdir(output, { recursive: true });

  for (const [scenario, [width, height], beats] of RUNS) {
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await scope.newPage();
    page.on('console', message => { if (message.type() === 'error') problems.push(`${scenario}@${width}: ${message.text()}`); });
    page.on('pageerror', error => problems.push(`${scenario}@${width}: ${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/-/twitch-moments?scenario=${scenario}&clean=1&at=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 300_000 });
    const row = [];
    let reached = 0;
    for (const [beat, offset] of beats) {
      // Step on to the beat in 250 ms frames, so the director's cuts and eases see the beat as a viewer would.
      await page.evaluate(async ([from, target]) => {
        for (let t = from; t < target; t += 250) { window.__chatdomMoments.seek(t); await new Promise(r => requestAnimationFrame(r)); }
        window.__chatdomMoments.seek(target);
      }, [reached, offset]);
      reached = offset;
      await page.waitForTimeout(400);
      const path = framePath(scenario, beat, [width, height]);
      await page.screenshot({ path, timeout: 180_000 });
      row.push(path);
    }
    const stats = await page.evaluate(() => window.__chatdomMoments.view());
    console.log(`Captured ${scenario}@${width}x${height} · ${JSON.stringify(stats)}`);
    rows.push({ scenario, width, height, row });
    await scope.close();
  }
  })()]);
} finally {
  try { await browser?.close(); } finally {
    try { await server?.close(); } finally { await release?.(); }
  }
}

// The sheet: each run is one row of three frames scaled to a common height, labelled by scenario and size.
const tall = (width, height) => (height > width ? 640 : 300), across = ({ width, height, row }) => Math.round(width * tall(width, height) / height / 2) * 2 * row.length;
const sheetWidth = Math.max(0, ...rows.map(across)), tiles = [];
for (const { scenario, width, height, row } of rows) {
  const H = tall(width, height), w = Math.round(width * H / height / 2) * 2;
  const rowPath = `${output}/row-${scenario}@${width}x${height}.png`;
  const inputs = row.flatMap(p => ['-i', p]);
  const label = `drawtext=text='${scenario} ${width}x${height}':x=10:y=10:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6`;
  const filter = row.map((_, i) => `[${i}:v]scale=${w}:${H}${i === 0 ? `,${label}` : ''}[t${i}]`).join(';') + `;${row.map((_, i) => `[t${i}]`).join('')}hstack=inputs=${row.length},pad=${sheetWidth}:${H}:0:0:color=0x15121a[out]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', rowPath]);
  tiles.push(rowPath);
}
if (tiles.length) {
  const sheet = `${output}/sheet-${set}.png`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...tiles.flatMap(p => ['-i', p]), ...(tiles.length > 1 ? ['-filter_complex', `vstack=inputs=${tiles.length}`] : []), sheet]);
  console.log(`Sheet ${sheet.slice(root.length)}`);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
