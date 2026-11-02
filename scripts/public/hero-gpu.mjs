// The living hero on Tobias's real GPU: fresh captures of the land at the hero's hour (the pictures the live land
// fades in over), the live hero's frame timing, and the front page's first and largest paint, measured in his Chrome.
// Run it inside one GPU lease, after building the web app and the site (`node scripts/public/build.mjs --no-panel`):
//
//   chatdom-pc-lease -- node scripts/public/hero-gpu.mjs --out work/evidence/front-door/fd13/gpu [--posters] [--timing] [--sizes 1440x900]
//
// It serves apps/web/dist on 127.0.0.1:5192 (the story at /site/, the grand land at /-/grand, or /-/grand-bench once grand-world moves it), which his tunnel
// forwards to localhost:5192 on his PC, and drives his Chrome over the tunnel's DevTools port in a fresh browser
// context (a clean cache, nothing of his own profile). Pictures: hero-a/b/c.png at 1920x1080 and portrait.png at
// 780x1688, from the orbit camera the live land uses (apps/web/src/site/hero/frame.ts). Timing: for 1440x900 and
// 1920x1080, first contentful paint and largest contentful paint on a cold load, how long the live land took, ten
// seconds of frame times while it orbits, and a still of it. Everything is written to <out>/hero-gpu.json.
/* global performance, requestAnimationFrame, PerformanceObserver, innerHeight, scrollY, scrollTo -- the timing functions run in the page */
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = resolve(option('--out', 'work/evidence/front-door/fd13/gpu'));
const all = !args.includes('--posters') && !args.includes('--timing');
const doPosters = all || args.includes('--posters');
const doTiming = all || args.includes('--timing');
// Timing sizes, e.g. `--sizes 1440x900`; a timing-only run merges its rows into an existing hero-gpu.json.
const SIZES = (option('--sizes', '1440x900,1920x1080')).split(',').map(size => size.split('x').map(Number));
const CDP = process.env.PC_CDP || 'http://127.0.0.1:9333';
// 5192 is the lease's port; a rehearsal off the lease (scripts/public/hero-gpu-rehearse.mjs) passes a capture port.
const PORT = Number(process.env.HERO_GPU_PORT || 5192);
// The pictures are drawn at the high tier on his GPU; the rehearsal asks for the software tier, which SwiftShader can draw.
const POSTER_TIER = process.env.HERO_GPU_TIER || 'high';
const APP = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, '../..');
// The hero's camera: keep in step with apps/web/src/site/hero/frame.ts.
const HOUR = 18.2, TIME = 0;
const FRAMES = [['hero-a', 120], ['hero-b', 90], ['hero-c', 150]];
// The phone picture has a camera of its own: phones always get pictures, never the live land, so nothing has to match
// it. The orbit view's portrait fit widens the lens to 62° and drops to ~10° under the clouds, which sets the sea's
// hard far edge a quarter of the way down a phone. The cloud deck sits ~235 m up (the target is at 30 m), so the camera
// must stay under ~200 m: higher, the coarse cloud slabs fill the frame (tried 24°/560 m and 19°/720 m, inside the
// deck; 44°/900 m and 36°/800 m, above it, half the phone is cloud). Steep and close (32°, 320 m: 200 m up) looks
// down over the mere, the falls and the fields with the sea fading into haze above the page's crop
// (work/evidence/front-door/fd13/phone/). `--portrait-camera yaw,pitch,dist` (repeatable) tries other framings: the
// first is portrait.webp, the others portrait-<yaw>-<pitch>-<dist>.webp beside it.
const asked = args.flatMap((value, i) => (value === '--portrait-camera' ? [args[i + 1]] : []));
const PORTRAITS = (asked.length ? asked : ['120,32,320']).map(text => String(text).split(',').map(Number));
if (PORTRAITS.some(camera => camera.length !== 3 || camera.some(value => !Number.isFinite(value)))) throw new Error('--portrait-camera takes yaw,pitch,dist');
const portraitOnly = args.includes('--portrait-only');
// The grand land's own engine view. grand-world is moving it to /-/grand-bench (and /-/grand becomes the live kingdom
// view), so the built router decides; --poster-path overrides both.
async function benchPath() {
  const assets = join(root, 'apps/web/dist/assets');
  const files = await readdir(assets).catch(() => []);
  for (const file of files.filter(name => name.endsWith('.js'))) {
    if ((await readFile(join(assets, file), 'utf8')).includes('/-/grand-bench')) return '/-/grand-bench';
  }
  return '/-/grand';
}
const POSTER_PATH = option('--poster-path', null) ?? await benchPath();
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
  let inView = 0;
  let last = performance.now();
  const end = last + seconds * 1000;
  const frame = now => {
    times.push(now - last); last = now;
    // The hero rests out of view (its camera stops and nothing is drawn), so a frame only counts as the live land's
    // when the hero is on screen; his Chrome is a real window and can be scrolled while the lease runs.
    const box = document.querySelector('.story-hero')?.getBoundingClientRect();
    if (box && box.bottom > innerHeight * 0.5 && box.top < innerHeight * 0.5) inView += 1;
    if (now < end) { requestAnimationFrame(frame); return; }
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    done({ frames: times.length, fps: 1000 / mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: sorted.at(-1), over33: times.filter(t => t > 33.4).length, visible: document.visibilityState, heroInView: inView / (times.length + 1), scrollY: scrollY });
  };
  requestAnimationFrame(frame);
});

// First and largest paint, from buffered observers: the entries can land after the load event (the page is drawn
// after it in a fresh tab), so wait for the first paint, then let the largest settle for 2.5 s (8 s at most).
const PAINTS = () => new Promise(done => {
  const result = { fcp: null, lcp: null, lcpElement: null };
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) if (entry.name === 'first-contentful-paint') result.fcp = entry.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) { result.lcp = entry.startTime; result.lcpElement = `${entry.element?.tagName ?? '?'} ${entry.url ? entry.url.split('/').pop() : ''}`.trim(); }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  const started = performance.now();
  let painted = null;
  const check = () => {
    const now = performance.now();
    if (result.fcp !== null && painted === null) painted = now;
    if ((painted !== null && now - painted > 2_500) || now - started > 8_000) {
      const nav = performance.getEntriesByType('navigation')[0];
      done({ ...result, ttfb: nav?.responseStart ?? null, domContentLoaded: nav?.domContentLoadedEventEnd ?? null, load: nav?.loadEventEnd ?? null });
      return;
    }
    setTimeout(check, 100);
  };
  check();
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
    const shots = [...(portraitOnly ? [] : FRAMES.map(([id, yaw]) => [id, yaw, 1920, 1080, null])),
      ...PORTRAITS.map(([yaw, pitch, dist], i) => [i ? `portrait-${yaw}-${pitch}-${dist}` : 'portrait', yaw, 780, 1688, { pitch, dist }])];
    for (const [id, yaw, width, height, camera] of shots) {
      const { context, tab } = await page(browser, width, height);
      const started = Date.now();
      await tab.goto(`${APP}${POSTER_PATH}?channel=tobi4s_&still=1&view=orbit&hour=${HOUR}&t=${TIME}&yaw=${yaw}${camera ? `&pitch=${camera.pitch}&dist=${camera.dist}` : ''}&tier=${POSTER_TIER}`, { waitUntil: 'domcontentloaded' });
      await tab.waitForFunction(() => window.__chatdomReady === true, null, { timeout: POSTER_TIER === 'software' ? 240_000 : 120_000 });
      await sleep(2_500);
      // Kept as near-lossless WebP (the evidence stays small); scripts/public/site-pictures.mjs crops it for the page.
      const png = join(out, `${id}.png`), file = join(out, `${id}.webp`);
      await tab.screenshot({ path: png, timeout: 120_000 });
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '94', '-compression_level', '6', file]);
      await rm(png);
      report.posters.push({ id, yaw, ...camera, width, height, seconds: (Date.now() - started) / 1000, file });
      console.log(`${file} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
      await context.close();
    }
  }

  if (doTiming) {
    for (const [width, height] of SIZES) {
      const { context, tab } = await page(browser, width, height);
      const started = Date.now();
      await tab.goto(`${APP}/site/`, { waitUntil: 'load' });
      const paints = await tab.evaluate(PAINTS);
      // Settled when the live land is up or has stepped back, or when the plan kept the pictures from the start (then
      // no hero state is ever said, and waiting for one would spend the lease).
      await tab.waitForFunction(() => {
        const hero = document.querySelector('.story-hero');
        return ['live', 'still'].includes(hero?.dataset.heroState ?? '') || (hero?.dataset.heroPlan ?? '').startsWith('still:');
      }, null, { timeout: 150_000 })
        .catch(() => undefined);
      const hero = await tab.evaluate(() => ({ state: document.querySelector('.story-hero')?.dataset.heroState ?? 'none', plan: document.querySelector('.story-hero')?.dataset.heroPlan ?? 'none' }));
      const liveAfter = (Date.now() - started) / 1000;
      await tab.evaluate(() => scrollTo(0, 0));
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
  if (!doPosters) {
    // Keep the pictures and the other sizes from an earlier run; replace only the rows measured now.
    const earlier = await readFile(join(out, 'hero-gpu.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (earlier) {
      const sizes = new Set(report.timing.map(row => row.size));
      report.posters = earlier.posters ?? [];
      report.timing = [...(earlier.timing ?? []).filter(row => !sizes.has(row.size)), ...report.timing];
    }
  }
  await writeFile(join(out, 'hero-gpu.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${join(out, 'hero-gpu.json')}`);
} finally {
  // Only our own contexts were closed above; his Chrome stays open, and the connection drops when this process ends.
  server?.kill();
}
process.exit(0);
