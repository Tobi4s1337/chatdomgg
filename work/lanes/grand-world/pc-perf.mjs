// Frame time and per-pass cost of the stream on Tobias's real-GPU Chrome, through the pc tunnel's DevTools port.
// Run only inside chatdom-pc-lease, after this lane's own preview serves on 127.0.0.1:5192 (and its land server
// on 5191). The page is opened warm (his cache is never cleared here; pc-cold-load.mjs owns cold loads).
//
//   node work/lanes/grand-world/pc-perf.mjs <url> <out.json> [--size 1920x1080] [--seconds 60] [--probe 240]
//        [--quality high|balanced|low] [--label text]
//
// 1. A frame-interval record of --seconds with no instrumentation running, tagged with the director's shot.
// 2. A probe of --probe drawn frames (frame-probe.mjs): draws and triangles per pass and per shader program, and
//    GPU milliseconds per pass from EXT_disjoint_timer_query_webgl2 where his browser offers it.
// 3. For every frame of the record over 33 ms: what that frame did on the GL context (programs linked, shaders
//    compiled, buffer and texture bytes uploaded, and the milliseconds those calls took), the JS heap drop that
//    marks a collection, and the shot. A hitch is attributed, never only counted.
// Frame intervals are browser frame times, not GPU times; his display refreshes faster than 60 Hz, so an
// unloaded page shows its own refresh interval as p50.
/* global AbortSignal, performance, requestAnimationFrame -- Node 22 and page globals */
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { FRAME_PROBE_SOURCE, summariseProbe } from './frame-probe.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const [url, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!/^http:\/\/(localhost|127\.0\.0\.1):519[02]\//.test(url ?? '') || !out) throw new Error('usage: <http://localhost:5192/...> <out.json>');
const [width, height] = (flag('size') ?? '1920x1080').split('x').map(Number);
const seconds = Number(flag('seconds') ?? 60), probeFrames = Number(flag('probe') ?? 240);
const quality = flag('quality') ?? null;
/** Per-frame counters of the GL calls that can stall a frame; read and reset by the record's frame loop. */
const HITCH_SOURCE = `(() => {
  const c = window.__hitch = { link: 0, compile: 0, buffer: 0, texture: 0, ms: 0 };
  const wrap = (proto, name, count) => { const raw = proto[name]; if (!raw) return;
    proto[name] = function (...a) { const t = performance.now(); try { return raw.apply(this, a); } finally { c.ms += performance.now() - t; count(a); } }; };
  const bytes = v => v && typeof v === 'object' && 'byteLength' in v ? v.byteLength : typeof v === 'number' ? v : 0;
  for (const proto of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype].filter(Boolean)) {
    wrap(proto, 'linkProgram', () => c.link++); wrap(proto, 'compileShader', () => c.compile++);
    wrap(proto, 'bufferData', a => c.buffer += bytes(a[1])); wrap(proto, 'bufferSubData', a => c.buffer += bytes(a[2]));
    for (const n of ['texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D', 'texStorage2D', 'texStorage3D']) wrap(proto, n, a => { const v = a.find(x => x && typeof x === 'object' && 'byteLength' in x); c.texture += v ? v.byteLength : 0; });
  }
})();`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { url, label: flag('label') ?? null, viewport: { width, height }, quality, at: new Date().toISOString(), passed: false };
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 15_000 });
const context = browser.contexts()[0];
const page = await context.newPage();
try {
  await page.setViewportSize({ width, height });
  await page.bringToFront();
  await page.addInitScript(FRAME_PROBE_SOURCE);
  await page.addInitScript(HITCH_SOURCE);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const started = Date.now();
  await page.goto(url, { timeout: 30_000 });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 150_000, polling: 250 });
  report.readyMs = Date.now() - started;
  report.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  if (quality) report.qualityApplied = await page.evaluate(q => { const k = window.__chatdomKingdom; if (!k?.setQuality) return false; k.setQuality(q); return k.quality?.() ?? true; }, quality);
  // Let the far land finish refining before timing (streaming has its own measurements).
  await page.waitForFunction(() => window.__chatdomKingdom?.inspect?.().land?.startupPhase === 'settled', null, { timeout: 60_000, polling: 500 }).catch(() => { report.notSettled = true; });
  await sleep(2000);
  report.frames = await page.evaluate(seconds => new Promise(resolve => {
    const t = [], shots = [], hitches = [], h = window.__hitch, heap = () => performance.memory?.usedJSHeapSize ?? 0;
    let last = performance.now(), sampled = 0, heapBefore = heap(); const end = last + seconds * 1000;
    function frame(now) {
      t.push(now - last);
      const heapNow = heap();
      if (now - last > 33.4 && t.length > 1) hitches.push({ at: +((now - end) / 1000 + seconds).toFixed(2), ms: +(now - last).toFixed(1),
        shot: window.__chatdomStream?.director?.shot ?? null, linked: h?.link ?? null, compiled: h?.compile ?? null,
        bufferBytes: h?.buffer ?? null, textureBytes: h?.texture ?? null, glMs: h ? +h.ms.toFixed(1) : null,
        heapDropBytes: Math.max(0, heapBefore - heapNow) });
      if (h) { h.link = h.compile = h.buffer = h.texture = h.ms = 0; }
      heapBefore = heapNow; last = now;
      if (now - sampled > 250) { sampled = now; shots.push([t.length, window.__chatdomStream?.director?.shot ?? null]); }
      if (now < end) return requestAnimationFrame(frame);
      t.shift();
      const stats = list => { const s = [...list].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        return { frames: s.length, p50: q(.5), p95: q(.95), p99: q(.99), worst: s.at(-1), over33: s.filter(x => x > 33.4).length, over16: s.filter(x => x > 16.7).length }; };
      const byShot = {};
      for (let i = 0; i < shots.length; i++) {
        const [from, shot] = shots[i], to = shots[i + 1]?.[0] ?? t.length;
        (byShot[shot] ??= []).push(...t.slice(Math.max(0, from - 1), to - 1));
      }
      resolve({ ...stats(t), visible: document.visibilityState, byShot: Object.fromEntries(Object.entries(byShot).map(([k, v]) => [k, stats(v)])),
        hitches, intervals: t.map(x => +x.toFixed(2)) });
    }
    requestAnimationFrame(frame);
  }), seconds);
  await page.evaluate(n => window.__frameProbe.start(n), probeFrames);
  const deadline = Date.now() + 60_000;
  while (!(await page.evaluate(() => { window.__frameProbe.flush(); return window.__frameProbe.done(); })) && Date.now() < deadline) await sleep(250);
  const raw = await page.evaluate(() => window.__frameProbe.report());
  report.probe = { ...summariseProbe(raw), timer: raw.timer, disjoint: raw.disjoint };
  report.scene = await page.evaluate(() => { const k = window.__chatdomKingdom, s = k?.inspect?.();
    return { stats: k?.stats ? { drawCalls: k.stats.drawCalls, triangles: k.stats.triangles, shadowDrawCalls: k.stats.shadowDrawCalls, shadowTriangles: k.stats.shadowTriangles, shadowUpdates: k.stats.shadowUpdates, post: k.stats.post } : null,
      water: s?.water?.reflection ?? null, land: s?.land ? { regions: s.land.regions, covered: s.land.covered, startupPhase: s.land.startupPhase, residentBytes: s.land.residentBytes } : null,
      frame: s?.frame ?? null, quality: s?.quality ?? null }; });
  report.errors = errors;
  report.passed = true;
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  await page.close().catch(() => {});
  // His Chrome is never closed; only the page this run opened.
}
const f = report.frames, p = report.probe;
console.log(`${out} · ${report.renderer} · ready ${report.readyMs} ms` + (f ? ` · p50 ${f.p50.toFixed(1)} p95 ${f.p95.toFixed(1)} p99 ${f.p99.toFixed(1)} worst ${f.worst.toFixed(1)} over16 ${f.over16}/${f.frames}` + f.hitches.map(x => ` · hitch ${x.ms} ms @${x.at}s ${x.shot} link ${x.linked} buf ${x.bufferBytes} tex ${x.textureBytes} gl ${x.glMs} ms heap-${x.heapDropBytes}`).join('') : ` · ${report.error}`)
  + (p ? ` · draws ${p.draws.median}/${p.draws.max} tris ${p.triangles.median}/${p.triangles.max} gpu ${p.gpuMs.median}/${p.gpuMs.max} ms cpu ${p.cpuMs.median?.toFixed(2)}/${p.cpuMs.max?.toFixed(2)} ms` : ""));
process.exit(report.passed ? 0 : 1);
