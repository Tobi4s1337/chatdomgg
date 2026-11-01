// One still OR one short deterministic motion clip per shared capture-lock acquisition.
// Review benches are explicitly SIMULATED; these are not proof of the town/realm integration.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';

const { values } = parseArgs({ options: {
  view: { type: 'string', default: 'motion' }, width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' },
  gesture: { type: 'string', default: 'none' },
  clip: { type: 'boolean', default: false }, out: { type: 'string', default: 'shots/walking-together' },
} });
const width = Number(values.width), height = Number(values.height);
if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 1920)) throw new Error('Invalid review dimensions');
if (!['motion', 'wardrobe', 'selector'].includes(values.view)) throw new Error('Unknown review view');
if (!['none', 'wave', 'bow', 'cheer', 'dance', 'sit', 'point'].includes(values.gesture)) throw new Error('Unknown gesture');
if (values.clip && values.view !== 'motion') throw new Error('Only motion review has a deterministic frame barrier');
const release = await acquireCaptureLock();
let server, browser;
const errors = [];
await mkdir(values.out, { recursive: true });
const tag = values.view === 'motion' ? `motion-${values.gesture}${values.clip ? '-clip' : ''}` : values.view;
const stem = `${values.out}/${tag}@${width}x${height}`;
try {
  // Bind only an allowed free port; a busy port is never stopped or reused.
  for (const port of CAPTURE_PORTS) {
    const attempt = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await attempt.listen(); server = attempt; break; } catch (error) { await attempt.close(); if (!/already in use/.test(String(error))) throw error; }
  }
  if (!server) throw new Error('No free review port');
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  const path = values.view === 'wardrobe' ? '/src/avatar-builder/builder.html?still=1&who=lapsed&tab=earned'
    : values.view === 'selector' ? '/src/walk/gestures/review.html' : `/src/citizens/gestures.html?gesture=${values.gesture}`;
  await page.goto(new URL(path, server.resolvedUrls.local[0]).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 120_000 });
  if (values.clip) {
    // Three seconds, before the review pass loops. No browser-clock stepping or synthetic network evidence.
    const frames = `${values.out}/${tag}-frames-${width}x${height}`;
    await mkdir(frames, { recursive: true });
    for (let index = 0; index < 72; index++) {
      await page.evaluate(t => window.__chatdomGestureReview.seek(t), index / 24);
      await page.screenshot({ path: `${frames}/${String(index).padStart(4, '0')}.png` });
    }
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', `${frames}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', `${stem}.mp4`], { stdio: ['ignore', 'ignore', 'inherit'] });
      ffmpeg.once('error', reject); ffmpeg.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg: ${code}`)));
    });
  } else {
    if (values.view === 'motion') await page.evaluate(() => window.__chatdomGestureReview.seek(1));
    await page.screenshot({ path: `${stem}.png` });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(`${stem}.json`, JSON.stringify({ source: 'SIMULATED review bench', view: values.view, gesture: values.gesture, width, height, clip: values.clip,
    errors, limitation: 'Lane component review only. Production wardrobe and gesture bindings remain main-owned needs.' }, null, 2));
  console.log(`Reviewed capture written to ${stem}`);
} finally {
  await browser?.close(); await server?.close(); await release();
}
