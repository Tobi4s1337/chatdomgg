/* global AbortSignal, performance */
// Main-thread cost of the Atlas frame loop once the map has settled: what each animation frame's callbacks take,
// and where the sampled time goes. Run against an already running built preview and Atlas service. SwiftShader frame
// rates mean nothing here; the callbacks' own JavaScript time is the evidence (GPU work happens outside it).
//   ATLAS_CHECK_URL=http://127.0.0.2:5175 node src/atlas/checks/hero-frame-profile.mjs [path] [WxH] [label]
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175';
const path = process.argv[2] ?? '/-/atlas-embed?mode=hero';
const [width, height] = (process.argv[3] ?? '1920x1080').split('x').map(Number);
const label = process.argv[4] ?? 'hero-1920';
const settleMs = Number(process.env.ATLAS_SETTLE_MS ?? 3_000);
const pan = process.env.ATLAS_PAN === '1';
const sampleMs = Number(process.env.ATLAS_SAMPLE_MS ?? 6_000);

const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2);
};

const release = await acquireCaptureLock({ signal: AbortSignal.timeout(Number(process.env.ATLAS_LOCK_WAIT_MS ?? 1_200_000)) });
let browser;
const report = { path, pan, width, height, settleMs, sampleMs, errors: [] };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(() => {
    // Each animation frame's callbacks, timed as one block: the loop's whole JavaScript cost for that frame.
    const raf = window.requestAnimationFrame.bind(window);
    const record = window.__frameCost = { on: false, frames: [] };
    let pending = 0;
    let frameStart = 0;
    let frameTotal = 0;
    window.requestAnimationFrame = callback => raf(time => {
      if (!pending++) { frameStart = performance.now(); frameTotal = 0; }
      const t0 = performance.now();
      try { callback(time); } finally {
        frameTotal += performance.now() - t0;
        if (!--pending && record.on) record.frames.push({ at: frameStart, cost: frameTotal });
      }
    });
  });
  const t0 = Date.now();
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-atlas-ready="map"]', { timeout: 120_000 });
  report.readyMapMs = Date.now() - t0;
  // Settled means the pencil places of the live frame are all found; until then each frame changes the wash.
  await page.waitForSelector('[data-atlas-live-work="done"]', { timeout: Number(process.env.ATLAS_WORK_WAIT_MS ?? 420_000) });
  report.liveWorkDoneMs = Date.now() - t0;
  await page.waitForTimeout(settleMs);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await page.evaluate(() => { window.__frameCost.frames = []; window.__frameCost.on = true; });
  await cdp.send('Profiler.start');
  if (pan) {
    // A slow hand pan back and forth across the middle of the map, the way someone reads it.
    const cx = width / 2;
    const cy = height / 2;
    const end = Date.now() + sampleMs;
    let leg = 0;
    while (Date.now() < end) {
      const dir = leg++ % 2 ? -1 : 1;
      await page.mouse.move(cx - dir * 160, cy - dir * 60);
      await page.mouse.down();
      for (let i = 1; i <= 30 && Date.now() < end; i++) await page.mouse.move(cx - dir * 160 + dir * i * 320 / 30, cy - dir * 60 + dir * i * 120 / 30);
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
  } else await page.waitForTimeout(sampleMs);
  const { profile } = await cdp.send('Profiler.stop');
  const frames = await page.evaluate(() => { window.__frameCost.on = false; return window.__frameCost.frames; });
  const costs = frames.map(f => f.cost);
  report.frames = {
    count: frames.length,
    p50: quantile(costs, 0.5),
    p95: quantile(costs, 0.95),
    max: quantile(costs, 1),
    totalMs: +costs.reduce((a, b) => a + b, 0).toFixed(1),
    over4ms: costs.filter(c => c > 4).length,
  };
  // Self time by function, then the inclusive cost of a few named stages of the loop.
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas;
  const selfMs = new Map();
  profile.samples.forEach((id, i) => selfMs.set(id, (selfMs.get(id) ?? 0) + (dt[i] ?? 0) / 1000));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  const inclusive = new Map();
  for (const [id, ms] of selfMs) {
    const node = byId.get(id);
    const name = `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + ms);
    const seen = new Set();
    for (let at = id; at !== undefined; at = parent.get(at)) {
      const n = byId.get(at);
      const fn = n.callFrame.functionName || '(anonymous)';
      if (seen.has(fn)) continue;
      seen.add(fn);
      inclusive.set(fn, (inclusive.get(fn) ?? 0) + ms);
    }
  }
  const top = (map, n) => [...map].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +v.toFixed(1)]);
  report.selfTop = top(self, 25);
  report.inclusiveTop = top(inclusive, 40);
  report.idleMs = +(self.get([...self.keys()].find(k => k.startsWith('(idle)')) ?? 0)).toFixed(1);
  // The picture the measured frames drew, after a moment's rest, to hold beside earlier stills.
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: new URL(`../../../../../work/evidence/atlas-map/am10-frame-${label}.png`, import.meta.url).pathname });
  report.stats = await page.evaluate(() => document.querySelector('.atlas')?.dataset ?? null).catch(() => null);
} catch (e) {
  report.failure = String(e?.stack ?? e);
} finally {
  await browser?.close();
  await release();
}
const out = `../../../../../work/evidence/atlas-map/am10-frame-profile-${label}.json`;
await writeFile(new URL(out, import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ label, readyMapMs: report.readyMapMs, liveWorkDoneMs: report.liveWorkDoneMs, frames: report.frames, errors: report.errors, failure: report.failure }));
console.log('self', JSON.stringify(report.selfTop?.slice(0, 12)));
console.log('inclusive', JSON.stringify(report.inclusiveTop?.slice(0, 25)));
process.exit(report.failure ? 1 : 0);
