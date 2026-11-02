// The living hero on Tobias's real GPU: fresh captures of the land at the hero's hour (the pictures the live land
// fades in over), the live hero's frame timing, and the front page's first and largest paint, measured in his Chrome.
// Run it inside one GPU lease, after building the web app and the site (`node scripts/public/build.mjs --no-panel`):
//
//   chatdom-pc-lease -- node scripts/public/hero-gpu.mjs --out work/evidence/front-door/fd13/gpu [--posters] [--timing]
//
// It serves apps/web/dist on 127.0.0.1:5192 (the story at /site/, the grand land at /-/grand), which his tunnel
// forwards to localhost:5192 on his PC, and drives his Chrome over the tunnel's DevTools port in a fresh browser
// context (a clean cache, nothing of his own profile). Pictures: hero-a/b/c.png at 1920x1080 and portrait.png at
// 780x1688, from the orbit camera the live land uses (apps/web/src/site/hero/frame.ts). Timing: for 1440x900 and
// 1920x1080, first contentful paint and largest contentful paint on a cold load, how long the live land took, ten
// seconds of frame times while it orbits, and a still of it. Everything is written to <out>/hero-gpu.json.
/* global performance, requestAnimationFrame, PerformanceObserver -- the timing functions run in the page */
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = resolve(option('--out', 'work/evidence/front-door/fd13/gpu'));
const all = !args.includes('--posters') && !args.includes('--timing');
const doPosters = all || args.includes('--posters');
const doTiming = all || args.includes('--timing');
const CDP = process.env.PC_CDP || 'http://127.0.0.1:9333';
const PORT = 5192;
const APP = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, '../..');
// The hero's camera: keep in step with apps/web/src/site/hero/frame.ts.
const HOUR = 18.2, TIME = 0;
const FRAMES = [['hero-a', 120], ['hero-b', 90], ['hero-c', 150]];
const POSTER_PATH = option('--poster-path', '/-/grand');
const sleep = ms => new Promise(done => { setTimeout(done, ms); });

async function serve() {
  const server = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: join(root, 'apps/web'), stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ok = await fetch(`http://127.0.0.1:${PORT}/site/`).then(r => r.ok, () => false);
    if (ok) return server;
  }
  server.kill();
  throw new Error(`The build did not come up on ${PORT}`);
}

async function connect() {
  const version = await fetch(`${CDP}/json/version`, { signal: globalThis.AbortSignal.timeout(4000) }).then(r => r.json(), () => null);
  if (!version) { console.error('hero-gpu: Tobias\'s PC is not connected'); process.exit(3); }
  // Chrome names its own port; go through the tunnel's end instead.
  const ws = version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, CDP.replace(/^http/, 'ws'));
  return chromium.connectOverCDP(ws);
}

async function page(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const tab = await context.newPage();
  await tab.bringToFront();
  return { context, tab };
}

const FRAME_TIMES = seconds => new Promise(done => {
  const times = [];
  let last = performance.now();
  const end = last + seconds * 1000;
  const frame = now => {
    times.push(now - last); last = now;
    if (now < end) { requestAnimationFrame(frame); return; }
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    done({ frames: times.length, fps: 1000 / mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: sorted.at(-1), over33: times.filter(t => t > 33.4).length, visible: document.visibilityState });
  };
  requestAnimationFrame(frame);
});

const PAINTS = () => new Promise(done => {
  const result = { fcp: null, lcp: null, lcpElement: null };
  for (const entry of performance.getEntriesByType('paint')) if (entry.name === 'first-contentful-paint') result.fcp = entry.startTime;
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) { result.lcp = entry.startTime; result.lcpElement = `${entry.element?.tagName ?? '?'} ${entry.url ? entry.url.split('/').pop() : ''}`.trim(); }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  const nav = performance.getEntriesByType('navigation')[0];
  setTimeout(() => done({ ...result, ttfb: nav?.responseStart ?? null, domContentLoaded: nav?.domContentLoadedEventEnd ?? null, load: nav?.loadEventEnd ?? null }), 300);
});

const report = { measured: new Date().toISOString(), hour: HOUR, posters: [], timing: [] };
let server, browser;
try {
  await mkdir(out, { recursive: true });
  server = await serve();
  browser = await connect();
  report.renderer = await (async () => {
    const { context, tab } = await page(browser, 800, 600);
    await tab.goto(`${APP}/site/`, { waitUntil: 'domcontentloaded' });
    const name = await tab.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const i = gl?.getExtension('WEBGL_debug_renderer_info'); return gl ? String(gl.getParameter(i ? i.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no WebGL2'; });
    await context.close();
    return name;
  })();
  console.log(`renderer: ${report.renderer}`);

  if (doPosters) {
    const shots = [...FRAMES.map(([id, yaw]) => [id, yaw, 1920, 1080]), ['portrait', 120, 780, 1688]];
    for (const [id, yaw, width, height] of shots) {
      const { context, tab } = await page(browser, width, height);
      const started = Date.now();
      await tab.goto(`${APP}${POSTER_PATH}?channel=tobi4s_&still=1&view=orbit&hour=${HOUR}&t=${TIME}&yaw=${yaw}&tier=high`, { waitUntil: 'domcontentloaded' });
      await tab.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 120_000 });
      await sleep(2_500);
      // Kept as near-lossless WebP (the evidence stays small); scripts/public/site-pictures.mjs crops it for the page.
      const png = join(out, `${id}.png`), file = join(out, `${id}.webp`);
      await tab.screenshot({ path: png });
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '94', '-compression_level', '6', file]);
      await rm(png);
      report.posters.push({ id, yaw, width, height, seconds: (Date.now() - started) / 1000, file });
      console.log(`${file} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
      await context.close();
    }
  }

  if (doTiming) {
    for (const [width, height] of [[1440, 900], [1920, 1080]]) {
      const { context, tab } = await page(browser, width, height);
      const started = Date.now();
      await tab.goto(`${APP}/site/`, { waitUntil: 'load' });
      const paints = await tab.evaluate(PAINTS);
      await tab.waitForFunction(() => ['live', 'still'].includes(document.querySelector('.story-hero')?.dataset.heroState ?? ''), null, { timeout: 150_000 })
        .catch(() => undefined);
      const hero = await tab.evaluate(() => ({ state: document.querySelector('.story-hero')?.dataset.heroState ?? 'none', plan: document.querySelector('.story-hero')?.dataset.heroPlan ?? 'none' }));
      const liveAfter = (Date.now() - started) / 1000;
      await sleep(4_000);
      const frames = await tab.evaluate(FRAME_TIMES, 10);
      const file = join(out, `hero-live@${width}x${height}.png`);
      await tab.screenshot({ path: file });
      const row = { size: `${width}x${height}`, ...paints, hero, liveAfterSeconds: liveAfter, frames, still: file };
      report.timing.push(row);
      console.log(JSON.stringify(row));
      await context.close();
    }
  }
  await writeFile(join(out, 'hero-gpu.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${join(out, 'hero-gpu.json')}`);
} finally {
  // Only our own contexts were closed above; his Chrome stays open, and the connection drops when this process ends.
  server?.kill();
}
process.exit(0);
