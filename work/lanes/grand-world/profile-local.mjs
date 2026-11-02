// Main-thread profile of one cold load on this host's software renderer, for finding the startup's critical path.
//   node work/lanes/grand-world/profile-local.mjs <path> <out-prefix> [--size 1920x1080] [--seconds 90] [--dist apps/web/dist]
// Serves apps/web/dist and the lane's g3 store through serve-capture.mjs on a free capture port, under the shared
// capture lock. Writes <out-prefix>.cpuprofile and <out-prefix>.json (marks, land requests, readiness). CPU shares
// are meaningful; absolute times on a loaded host and every GPU-side time are not.
/* global AbortSignal, performance -- Node 22 and page globals */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const [path, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!path || !out) throw new Error('usage: profile-local.mjs <path> <out-prefix>');
const [width, height] = (flag('size') ?? '1920x1080').split('x').map(Number);
const seconds = Number(flag('seconds') ?? 90);
const free = port => new Promise(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(300_000) });
let server;
try {
  let port;
  for (const candidate of CAPTURE_PORTS) if (await free(candidate)) { port = candidate; break; }
  if (!port) throw new Error('no free capture port');
  server = spawn(process.execPath, ['work/lanes/grand-world/serve-capture.mjs', flag('dist') ?? 'apps/web/dist', 'shots/grand-world/land-bake-g3', String(port)], { stdio: 'inherit' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
    const requests = [];
    page.on('requestfinished', request => { const t = request.timing(); if (request.url().includes('/api/')) requests.push({ path: new URL(request.url()).pathname.slice(0, 120), start: Math.round(t.startTime), end: Math.round(t.responseEnd) }); });
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'commit' });
    let ready = null;
    while (Date.now() - started < seconds * 1000) {
      ready = await page.evaluate(() => window.__chatdomReady === true ? Math.round(performance.now()) : null).catch(() => null);
      if (ready !== null) break;
      await page.waitForTimeout(500);
    }
    const { profile } = await cdp.send('Profiler.stop');
    const marks = await page.evaluate(() => performance.getEntriesByType('mark').map(m => `${m.name}@${Math.round(m.startTime)}`));
    writeFileSync(`${out}.cpuprofile`, JSON.stringify(profile));
    writeFileSync(`${out}.json`, JSON.stringify({ path, width, height, ready, marks, requests }, null, 2));
    console.log(JSON.stringify({ ready, marks }));
  } finally { await browser.close(); }
} finally { server?.kill(); await release(); }
