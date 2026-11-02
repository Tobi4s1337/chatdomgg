/* global AbortSignal, performance, PerformanceObserver, MutationObserver, Response, WebGLRenderingContext, WebGL2RenderingContext */
// Cold-load cost of the Atlas: every request in order, the milestones to the first coherent frame, the main thread's
// long frames, and (once settled) the renderer's textures and draw calls. Each run is a new browser, so every cache is
// cold. Run against an already running built preview and Atlas service of your own:
//   ATLAS_CHECK_URL=http://127.0.0.2:5175 nice -n 10 taskset -c 0-8 node src/atlas/checks/cold-load.mjs [label]
// Env: COLD_RUNS (unthrottled runs per case, default 3), COLD_CASES (comma list of case ids), COLD_PROFILES
// (comma list of none,broadband,phone), COLD_TRACE=0 to skip the traced run, COLD_RENDERER=0 to skip renderer cost.
// SwiftShader on a shared host inflates CPU time; bytes, waterfalls and what waits on what are the evidence.
import { chromium } from '@playwright/test';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants as zlib } from 'node:zlib';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175';
const label = process.argv[2] ?? 'before';
const evidence = name => new URL(`../../../../../work/evidence/atlas-map/${name}`, import.meta.url).pathname;
const GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const RUNS = Number(process.env.COLD_RUNS ?? 3);
const READY_TIMEOUT = Number(process.env.COLD_READY_TIMEOUT_MS ?? 150_000);
/** After the map is ready the page keeps being watched this long, to see what it fetches after the first view. */
const TAIL_MS = Number(process.env.COLD_TAIL_MS ?? 4_000);

const CASES = [
  { id: 'map-1440', path: '/map', width: 1440, height: 900, mobile: false },
  { id: 'map-390', path: '/map', width: 390, height: 844, mobile: true },
  { id: 'hero-1440', path: '/-/atlas-embed?mode=hero', width: 1440, height: 900, mobile: false },
  { id: 'hero-390', path: '/-/atlas-embed?mode=hero', width: 390, height: 844, mobile: true },
].filter(c => !process.env.COLD_CASES || process.env.COLD_CASES.split(',').includes(c.id));

const PROFILES = {
  none: null,
  // A mid laptop on home broadband.
  broadband: { latency: 20, downloadThroughput: 40e6 / 8, uploadThroughput: 10e6 / 8, cpu: 1 },
  // A phone on a good mobile connection: 9 Mbps down, 170 ms RTT, a CPU four times slower.
  phone: { latency: 170, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8, cpu: 4 },
};
const profileIds = (process.env.COLD_PROFILES ?? 'none,broadband,phone').split(',');

// ── In-page instrumentation ───────────────────────────────────────────────────────────────────────────────────
function pageProbe() {
  const now = () => performance.now();
  const M = window.__cold = { marks: [], fetches: [], bodies: [], parses: [], digests: [], loaf: [], longtasks: [], paints: [], fonts: [], canvases: [] };
  const attrs = ['data-atlas-ready', 'data-atlas-live-work', 'data-state', 'data-names', 'data-live', 'data-still-tiles', 'data-live-dabs'];
  const observe = () => {
    new MutationObserver(list => {
      const t = now();
      for (const m of list) {
        if (m.type === 'attributes') {
          const el = m.target;
          M.marks.push({ t, attr: m.attributeName, value: el.getAttribute(m.attributeName), on: el.className || el.tagName });
        } else for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.hasAttribute?.('data-chatdom-atlas')) M.marks.push({ t, attr: 'mounted', value: node.dataset.atlasReady, on: 'data-chatdom-atlas' });
          const canvases = node.tagName === 'CANVAS' ? [node] : [...(node.querySelectorAll?.('canvas') ?? [])];
          for (const c of canvases) M.canvases.push({ t, cls: c.className || c.parentElement?.className || '' });
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: attrs, childList: true });
  };
  observe();
  const po = (type, sink, map) => {
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) sink.push(map(e)); }).observe({ type, buffered: true }); } catch { /* unsupported */ }
  };
  po('paint', M.paints, e => ({ name: e.name, t: e.startTime }));
  po('longtask', M.longtasks, e => ({ t: e.startTime, d: e.duration }));
  po('long-animation-frame', M.loaf, e => ({
    t: e.startTime, d: e.duration, blocking: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
    scripts: e.scripts.map(s => ({ d: s.duration, invoker: s.invoker, src: s.sourceURL?.split('/').pop(), fn: s.sourceFunctionName, char: s.sourceCharPosition, forced: s.forcedStyleAndLayoutDuration })),
  }));
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', e => M.fonts.push({ t: now(), faces: e.fontfaces.map(f => `${f.family} ${f.style} ${f.weight}`) }));
    document.fonts.ready.then(() => M.fonts.push({ t: now(), ready: true }));
  }
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const rec = { url, t0: now(), headers: null };
    M.fetches.push(rec);
    return nativeFetch.call(this, input, init).then(r => { rec.headers = now(); rec.status = r.status; return r; }, e => { rec.failed = now(); throw e; });
  };
  for (const method of ['arrayBuffer', 'text', 'json', 'blob']) {
    const native = Response.prototype[method];
    Response.prototype[method] = function () {
      const rec = { url: this.url, method, t0: now() };
      M.bodies.push(rec);
      return native.call(this).then(v => { rec.t1 = now(); rec.bytes = v?.byteLength ?? v?.size ?? v?.length; return v; });
    };
  }
  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const t0 = now();
    const value = parse.call(this, text, reviver);
    if (typeof text === 'string' && text.length > 20_000) M.parses.push({ t0, d: now() - t0, chars: text.length, kind: value?.kind ?? null, region: value?.region });
    return value;
  };
  if (crypto?.subtle?.digest) {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = (algo, data) => {
      const t0 = now();
      return digest(algo, data).then(v => { M.digests.push({ t0, t1: now(), bytes: data.byteLength }); return v; });
    };
  }
}

/** Counts textures (with estimated bytes), renderbuffers, buffers and draw calls per animation frame. */
function glProbe() {
  const G = window.__gl = { contexts: [], textures: { created: 0, deleted: 0 }, draws: [], frame: 0, live: new Map(), rbs: new Map(), buffers: new Map(), on: false };
  const BPP = {
    0x1908: 4, 0x8058: 4, 0x8C43: 4, // RGBA, RGBA8, SRGB8_ALPHA8
    0x1907: 3, 0x8051: 3, // RGB, RGB8
    0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1, 0x8229: 1, 0x822B: 2, 0x8227: 2, // ALPHA, LUMINANCE, LUMINANCE_ALPHA, RED, R8, RG8, RG
    0x881A: 8, 0x8814: 16, 0x822D: 2, 0x822E: 4, 0x8230: 8, // RGBA16F, RGBA32F, R16F, R32F, RG32F
    0x88F0: 4, 0x81A5: 2, 0x81A6: 3, 0x8CAC: 4, 0x84F9: 4, 0x1902: 4, // DEPTH24_STENCIL8, DEPTH_COMPONENT16, 24, 32F, DEPTH_STENCIL, DEPTH_COMPONENT
  };
  // Unsized formats are components times the size of the component type; sized formats carry their own size.
  const COMPONENTS = { 0x1908: 4, 0x1907: 3, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1, 0x8227: 2, 0x1902: 4 };
  const TYPE_BYTES = { 0x1401: 1, 0x1406: 4, 0x140B: 2, 0x8D61: 2, 0x1403: 2, 0x1405: 4 };
  const bpp = (internal, type) => (COMPONENTS[internal] ? COMPONENTS[internal] * (TYPE_BYTES[type] ?? 1) : BPP[internal] ?? 4);
  const wrap = proto => {
    if (!proto) return;
    const state = new WeakMap();
    const st = gl => { let s = state.get(gl); if (!s) { s = { unit: 0, bound: new Map(), rb: null }; state.set(gl, s); } return s; };
    const orig = name => proto[name];
    const hook = (name, fn) => { const o = orig(name); if (!o) return; proto[name] = function (...a) { fn.call(this, a); return o.apply(this, a); }; };
    const after = (name, fn) => { const o = orig(name); if (!o) return; proto[name] = function (...a) { const r = o.apply(this, a); fn.call(this, a, r); return r; }; };
    after('createTexture', (_a, t) => { G.textures.created++; G.live.set(t, { levels: new Map(), mips: false }); });
    hook('deleteTexture', ([t]) => { if (G.live.delete(t)) G.textures.deleted++; });
    hook('activeTexture', function ([u]) { st(this).unit = u; });
    hook('bindTexture', function ([target, t]) { st(this).bound.set(`${st(this).unit}:${target}`, t); });
    const bound = (gl, target) => G.live.get(st(gl).bound.get(`${st(gl).unit}:${target >= 0x8515 && target <= 0x851A ? 0x8513 : target}`));
    hook('texImage2D', function (a) {
      const [target, level, internal] = a;
      let w, h, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; type = a[7]; } else { const src = a[5]; w = src?.width ?? src?.videoWidth ?? 0; h = src?.height ?? src?.videoHeight ?? 0; type = a[4]; }
      const t = bound(this, target);
      if (t) t.levels.set(`${target}:${level}`, w * h * bpp(internal, type));
    });
    hook('texStorage2D', function ([target, levels, internal, w, h]) {
      const t = bound(this, target);
      if (!t) return;
      for (let l = 0; l < levels; l++) t.levels.set(`${target}:${l}`, Math.max(1, w >> l) * Math.max(1, h >> l) * (BPP[internal] ?? 4));
    });
    hook('generateMipmap', function ([target]) { const t = bound(this, target); if (t) t.mips = true; });
    after('createRenderbuffer', (_a, r) => G.rbs.set(r, 0));
    hook('deleteRenderbuffer', ([r]) => G.rbs.delete(r));
    hook('bindRenderbuffer', function ([, r]) { st(this).rb = r; });
    hook('renderbufferStorage', function ([, internal, w, h]) { G.rbs.set(st(this).rb, w * h * (BPP[internal] ?? 4)); });
    hook('renderbufferStorageMultisample', function ([, samples, internal, w, h]) { G.rbs.set(st(this).rb, w * h * (BPP[internal] ?? 4) * Math.max(1, samples)); });
    after('createBuffer', (_a, b) => G.buffers.set(b, 0));
    hook('deleteBuffer', ([b]) => G.buffers.delete(b));
    hook('bindBuffer', function ([target, b]) { st(this).bound.set(`buf:${target}`, b); });
    hook('bufferData', function ([target, data]) { const b = st(this).bound.get(`buf:${target}`); if (b) G.buffers.set(b, typeof data === 'number' ? data : data?.byteLength ?? 0); });
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) hook(name, () => { if (G.on) G.draws[G.frame] = (G.draws[G.frame] ?? 0) + 1; });
  };
  wrap(typeof WebGLRenderingContext !== 'undefined' && WebGLRenderingContext.prototype);
  wrap(typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype);
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = getContext.call(this, type, attrs);
    if (ctx && /webgl/.test(type)) G.contexts.push({ type, canvas: this, attrs: ctx.getContextAttributes?.() });
    return ctx;
  };
  const tick = () => { if (G.on) G.frame++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__glReport = () => {
    let tex = 0;
    let mipTex = 0;
    const sizes = [];
    for (const t of G.live.values()) {
      let b = 0;
      for (const v of t.levels.values()) b += v;
      if (t.mips) b = Math.round(b * 4 / 3);
      tex += b;
      if (t.mips) mipTex++;
      if (b) sizes.push(b);
    }
    sizes.sort((a, b) => b - a);
    const draws = G.draws.slice(0, G.frame);
    const drawing = draws.filter(Boolean);
    const sorted = [...drawing].sort((a, b) => a - b);
    return {
      contexts: G.contexts.map(c => ({ type: c.type, width: c.canvas.width, height: c.canvas.height, attrs: c.attrs })),
      textures: { live: G.live.size, created: G.textures.created, deleted: G.textures.deleted, withMips: mipTex, bytes: tex, largest: sizes.slice(0, 12) },
      renderbuffers: { live: G.rbs.size, bytes: [...G.rbs.values()].reduce((a, b) => a + b, 0) },
      buffers: { live: G.buffers.size, bytes: [...G.buffers.values()].reduce((a, b) => a + b, 0) },
      drawingBufferBytes: G.contexts.reduce((a, c) => a + c.canvas.width * c.canvas.height * 4 * 2, 0),
      frames: { sampled: G.frame, drawing: drawing.length, drawsTotal: drawing.reduce((a, b) => a + b, 0), perDrawingFrame: { p50: sorted[Math.floor(sorted.length / 2)] ?? 0, max: sorted.at(-1) ?? 0 } },
      canvas2d: [...document.querySelectorAll('canvas')].filter(c => !G.contexts.some(g => g.canvas === c)).map(c => ({ cls: c.className, w: c.width, h: c.height, bytes: c.width * c.height * 4 })),
    };
  };
}

// ── One cold run ──────────────────────────────────────────────────────────────────────────────────────────────
const groupOf = (url, type) => {
  const u = new URL(url);
  const p = u.pathname;
  if (p.startsWith('/map-data/')) {
    if (/\/v1\/preview$/.test(p)) return 'data:pointer';
    if (/\/world\.json$/.test(p)) return 'data:world';
    if (/\/region-\d+\.json$/.test(p) || /\/regions?\//.test(p)) return 'data:region';
    if (/\/names$/.test(p)) return 'data:names';
    if (/\/live\/[^/]+$/.test(p) || /\/live$/.test(p)) return 'data:live-pointer';
    if (/\/events$/.test(p)) return 'data:live-events';
    if (/\/live\//.test(p)) return 'data:live-file';
    if (/\/(search|card)/.test(p)) return 'data:directory';
    if (/\/roads?\/|\/gate\//.test(p)) return 'data:roads';
    return 'data:other';
  }
  if (type === 'document') return 'html';
  if (type === 'script' || /\.m?js$/.test(p)) return 'js';
  if (type === 'stylesheet' || /\.css$/.test(p)) return 'css';
  if (type === 'font' || /\.(woff2?|ttf|otf)$/.test(p)) return 'font';
  if (type === 'image' || /\.(webp|png|jpe?g|svg|avif)$/.test(p)) return 'image';
  return 'other';
};

async function coldRun(caseDef, profileId, { trace = false, renderer = false, shot = null } = {}) {
  const profile = PROFILES[profileId];
  const release = await acquireCaptureLock({ signal: AbortSignal.timeout(1_200_000) });
  let browser;
  let watchdog;
  const run = { case: caseDef.id, profile: profileId, trace, renderer, errors: [], console: [] };
  const tracePath = `/tmp/am13-cold-trace-${caseDef.id}-${process.pid}.json`;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
    const context = await browser.newContext({
      viewport: { width: caseDef.width, height: caseDef.height }, isMobile: caseDef.mobile, hasTouch: caseDef.mobile,
      deviceScaleFactor: caseDef.mobile ? 2 : 1,
    });
    const page = await context.newPage();
    page.on('pageerror', e => run.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') run.console.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
    await page.addInitScript(pageProbe);
    if (renderer) await page.addInitScript(glProbe);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    if (profile) {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.downloadThroughput, uploadThroughput: profile.uploadThroughput });
      if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    }
    // Never let the page reach a service that is not ours: only the bundle and /map-data may load.
    await cdp.send('Fetch.enable', { patterns: ['/presence-data/', '/forge-data/', '/realm-data/', '/live-realm-data/', '/api/'].map(p => ({ urlPattern: `*${p}*` })) });
    cdp.on('Fetch.requestPaused', e => { run.blocked = [...(run.blocked ?? []), e.request.url]; void cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => undefined); });
    // CDP: encoded and decoded bytes, encoding and initiator of each request the page target sees.
    const net = new Map();
    cdp.on('Network.requestWillBeSent', e => {
      const ini = e.initiator;
      const frame = ini?.stack?.callFrames?.[0] ?? ini?.stack?.parent?.callFrames?.[0];
      net.set(e.requestId, { id: e.requestId, url: e.request.url, type: e.type, ts: e.timestamp, wall: e.wallTime, initiator: ini?.type, by: (ini?.url ?? frame?.url ?? '').split('/').pop() || null, byFn: frame?.functionName || null, decoded: 0, priority: e.request.initialPriority });
    });
    cdp.on('Network.responseReceived', e => {
      const r = net.get(e.requestId);
      if (!r) return;
      const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
      Object.assign(r, { status: e.response.status, encoding: h['content-encoding'] ?? null, cacheControl: h['cache-control'] ?? null, mime: e.response.mimeType, protocol: e.response.protocol, tsResponse: e.timestamp, timing: e.response.timing });
    });
    cdp.on('Network.dataReceived', e => { const r = net.get(e.requestId); if (r) r.decoded += e.dataLength; });
    cdp.on('Network.loadingFinished', e => { const r = net.get(e.requestId); if (r) Object.assign(r, { tsEnd: e.timestamp, encoded: e.encodedDataLength }); });
    cdp.on('Network.loadingFailed', e => { const r = net.get(e.requestId); if (r) Object.assign(r, { tsEnd: e.timestamp, failed: e.errorText }); });
    // Playwright sees requests made by the still's and map's bake workers too.
    const pw = [];
    context.on('request', req => pw.push({ req, url: req.url(), type: req.resourceType(), worker: (() => { try { return !req.frame(); } catch { return true; } })(), done: false }));
    const finish = req => { const p = pw.find(x => x.req === req); if (p) p.done = true; };
    context.on('requestfinished', finish);
    context.on('requestfailed', finish);
    if (trace) await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing', 'loading', 'toplevel', 'disabled-by-default-devtools.timeline.frame'] });
    const wall0 = Date.now();
    // The lock is held only while a browser runs, and never beyond four minutes: the watchdog closes the browser.
    watchdog = setTimeout(() => { run.watchdog = true; log('watchdog: closing the browser'); void browser.close().catch(() => undefined); }, Number(process.env.COLD_WATCHDOG_MS ?? 240_000));
    log('goto', caseDef.id, profileId);
    await page.goto(`${base}${caseDef.path}`, { waitUntil: 'commit', timeout: 60_000 });
    let outcome = 'ready';
    try {
      await page.waitForFunction(() => /^(map|failed)$/.test(document.querySelector('[data-chatdom-atlas]')?.dataset.atlasReady ?? ''), null, { timeout: READY_TIMEOUT, polling: 50 });
    } catch {
      outcome = 'timeout';
    }
    run.readyWallMs = Date.now() - wall0;
    log('ready', outcome, run.readyWallMs, 'ms');
    await page.waitForTimeout(TAIL_MS);
    if (trace) await browser.stopTracing();
    run.outcome = outcome;
    const probe = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]?.toJSON();
      const resources = performance.getEntriesByType('resource').map(e => ({ url: e.name, initiatorType: e.initiatorType, start: e.startTime, requestStart: e.requestStart, responseStart: e.responseStart, end: e.responseEnd, transfer: e.transferSize, encoded: e.encodedBodySize, decoded: e.decodedBodySize }));
      return { timeOrigin: performance.timeOrigin, nav, resources, cold: window.__cold, atlas: document.querySelector('.atlas')?.dataset ?? null, ready: document.querySelector('[data-chatdom-atlas]')?.dataset.atlasReady };
    });
    run.atlasData = probe.atlas;
    run.final = probe.ready;
    // Align CDP's monotonic clock with the page's: the document request was sent at nav.fetchStart (or close to it).
    const docReq = [...net.values()].find(r => r.type === 'Document');
    const navFetch = probe.nav?.fetchStart ?? 0;
    const cdpToPage = ts => (docReq ? (ts - docReq.ts) * 1000 + navFetch : null);
    log('collecting');
    // Only finished requests are asked for their sizes: an open event stream never finishes.
    const finished = await Promise.all(pw.map(async p => {
      const timing = p.req.timing();
      const res = p.done ? await withTimeout(p.req.response(), 5_000).catch(() => null) : null;
      const sizes = res ? await withTimeout(p.req.sizes(), 5_000).catch(() => null) : null;
      return { url: p.url, type: p.type, worker: p.worker, start: timing.startTime > 0 ? timing.startTime - probe.timeOrigin : null, end: timing.responseEnd > 0 ? timing.startTime + timing.responseEnd - probe.timeOrigin : null, encodedBody: sizes?.responseBodySize ?? null, status: res?.status() ?? null, encoding: res ? (await withTimeout(res.allHeaders(), 5_000).catch(() => ({})))['content-encoding'] ?? null : null, open: !p.done };
    }));
    const requests = [];
    const seen = new Set();
    for (const r of [...net.values()].sort((a, b) => a.ts - b.ts)) {
      seen.add(r.url + '|' + r.ts);
      requests.push({
        url: r.url.replace(base, ''), group: groupOf(r.url, (r.type ?? '').toLowerCase()), type: r.type, status: r.status ?? null, protocol: r.protocol ?? null,
        start: round(cdpToPage(r.ts)), firstByte: r.tsResponse ? round(cdpToPage(r.tsResponse)) : null, end: r.tsEnd ? round(cdpToPage(r.tsEnd)) : null,
        encoded: r.encoded ?? null, decoded: r.decoded, encoding: r.encoding ?? null, cacheControl: r.cacheControl ?? null,
        initiator: r.initiator, by: r.by, byFn: r.byFn, priority: r.priority, failed: r.failed ?? null, source: 'cdp',
      });
    }
    // Requests the page target did not report (from workers), from Playwright's view.
    for (const p of finished) {
      if (requests.some(r => base + r.url === p.url)) continue;
      requests.push({ url: p.url.replace(base, ''), group: groupOf(p.url, p.type), type: p.type, status: p.status, start: round(p.start), end: round(p.end), encoded: p.encodedBody, decoded: null, encoding: p.encoding, initiator: p.worker ? 'worker' : 'unknown', source: 'playwright' });
    }
    requests.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
    run.requests = requests;
    run.cold = probe.cold;
    run.nav = probe.nav ? { responseEnd: round(probe.nav.responseEnd), domInteractive: round(probe.nav.domInteractive), domContentLoaded: round(probe.nav.domContentLoadedEventEnd), load: round(probe.nav.loadEventEnd) } : null;
    run.milestones = milestones(run);
    if (renderer) {
      // Settled: the live pencil places are found (or a minute passed), then the default view rests.
      await page.waitForSelector('[data-atlas-live-work="done"]', { timeout: 90_000 }).catch(() => { run.liveWorkTimeout = true; });
      await page.waitForTimeout(2_000);
      await page.evaluate(() => { window.__gl.draws = []; window.__gl.frame = 0; window.__gl.on = true; });
      await page.waitForTimeout(5_000);
      await page.evaluate(() => { window.__gl.on = false; });
      run.gl = await page.evaluate(() => window.__glReport());
      await cdp.send('Performance.enable');
      const { metrics } = await cdp.send('Performance.getMetrics');
      run.metrics = Object.fromEntries(metrics.filter(m => /JSHeap|Nodes|Documents|Frames|LayoutCount|TaskDuration|ScriptDuration/.test(m.name)).map(m => [m.name, m.value]));
      run.mapStats = await page.evaluate(() => window.__chatdomAtlas?.stats?.() ?? null).catch(() => null);
    }
    if (shot) await page.screenshot({ path: evidence(shot) });
  } catch (e) {
    run.failure = String(e?.stack ?? e);
  } finally {
    clearTimeout(watchdog);
    await browser?.close().catch(() => undefined);
    await release();
    log('released');
  }
  if (trace) {
    try {
      run.traceSummary = summariseTrace(JSON.parse(await readFile(tracePath, 'utf8')), run.milestones);
    } catch (e) {
      run.traceSummary = { failure: String(e) };
    }
    await rm(tracePath, { force: true });
  }
  return run;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}
const log = (...a) => console.log(`[cold ${new Date().toISOString().slice(11, 19)}]`, ...a);

const round = v => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v));

function milestones(run) {
  const c = run.cold ?? {};
  const mark = (attr, value) => round(c.marks?.find(m => m.attr === attr && (value === undefined || m.value === value))?.t);
  const req = (group, pick = 'end') => round(run.requests.filter(r => r.group === group && r[pick] !== null).map(r => r[pick]).sort((a, b) => a - b)[0]);
  const parse = kind => c.parses?.find(p => p.kind === kind);
  const world = parse('chatdom-atlas-survey-preview');
  const js = run.requests.filter(r => r.group === 'js' && r.end !== null);
  const fonts = run.requests.filter(r => r.group === 'font' && r.end !== null);
  const stillAt = mark('data-atlas-ready', 'still');
  return {
    htmlEnd: run.nav?.responseEnd ?? null,
    firstPaint: round(c.paints?.find(p => p.name === 'first-paint')?.t),
    fcp: round(c.paints?.find(p => p.name === 'first-contentful-paint')?.t),
    domContentLoaded: run.nav?.domContentLoaded ?? null,
    mounted: mark('mounted'),
    pointerStart: req('data:pointer', 'start'),
    pointerEnd: req('data:pointer'),
    worldStart: req('data:world', 'start'),
    worldEnd: req('data:world'),
    worldParsedEnd: world ? round(world.t0 + world.d) : null,
    worldParseMs: world ? round(world.d) : null,
    namesStart: req('data:names', 'start'),
    namesEnd: req('data:names'),
    firstRegionStart: req('data:region', 'start'),
    firstRegionEnd: req('data:region'),
    regionsBeforeStill: stillAt === null ? null : run.requests.filter(r => r.group === 'data:region' && r.start !== null && r.start < stillAt).length,
    livePointerEnd: req('data:live-pointer'),
    liveFileEnd: req('data:live-file'),
    stampsEnd: round(run.requests.filter(r => /stamps/.test(r.url) && r.end !== null).map(r => r.end).sort((a, b) => a - b)[0]),
    lastJsEnd: js.length ? Math.max(...js.filter(r => stillAt === null || r.start < stillAt).map(r => r.end)) : null,
    lastFontEndBeforeStill: fonts.length ? Math.max(...fonts.filter(r => stillAt === null || r.start < stillAt).map(r => r.end), 0) || null : null,
    fontsReady: round(c.fonts?.find(f => f.ready)?.t),
    firstCanvas: round(c.canvases?.[0]?.t),
    stateStill: mark('data-state', 'still'),
    readyStill: stillAt,
    stillTilesFirst: round(c.marks?.find(m => m.attr === 'data-still-tiles')?.t),
    namesReady: mark('data-names', 'ready'),
    readyMap: mark('data-atlas-ready', 'map'),
    stateReady: mark('data-state', 'ready'),
    liveWorkPlacing: mark('data-atlas-live-work', 'placing'),
    liveWorkDone: mark('data-atlas-live-work', 'done'),
    longTasksBeforeStill: (c.longtasks ?? []).filter(l => stillAt === null || l.t < stillAt).map(l => ({ t: round(l.t), d: round(l.d) })),
    longTaskMsBeforeStill: round((c.longtasks ?? []).filter(l => stillAt === null || l.t < stillAt).reduce((a, l) => a + l.d, 0)),
    loafBeforeStill: (c.loaf ?? []).filter(l => l.d > 50 && (stillAt === null || l.t < stillAt)).map(l => ({ t: round(l.t), d: round(l.d), blocking: round(l.blocking), scripts: l.scripts.filter(s => s.d > 5).map(s => `${s.src ?? '?'}:${s.fn || s.invoker}:${round(s.d)}ms`) })),
  };
}

/** Main-thread time by kind and by script before the first coherent frame, and the bake workers' busy time. */
function summariseTrace(trace, ms) {
  const events = trace.traceEvents ?? trace;
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const nav = events.filter(e => e.name === 'navigationStart' && /atlas|map/.test(e.args?.data?.documentLoaderURL ?? '')).sort((a, b) => a.ts - b.ts).at(-1);
  if (!nav) return { failure: 'no navigationStart' };
  const t0 = nav.ts;
  const mainKey = `${nav.pid}:${nav.tid}`;
  const until = (ms.readyStill ?? ms.readyMap ?? 20_000) * 1000 + t0;
  const untilMap = (ms.readyMap ?? ms.readyStill ?? 20_000) * 1000 + t0;
  const complete = events.filter(e => e.ph === 'X' && e.dur !== undefined && e.ts >= t0);
  const main = complete.filter(e => `${e.pid}:${e.tid}` === mainKey);
  const tasks = main.filter(e => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  const busy = (list, end) => Math.round(list.filter(e => e.ts < end).reduce((a, e) => a + Math.min(e.dur, end - e.ts), 0) / 1000);
  const KINDS = ['EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule', 'FunctionCall', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'ParseHTML', 'ParseAuthorStyleSheet', 'UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize', 'MajorGC', 'MinorGC', 'V8.GC_SCAVENGER', 'EventDispatch', 'XHRReadyStateChange', 'ResourceReceivedData', 'Commit', 'Decode Image', 'ImageDecodeTask', 'v8.produceModuleCache', 'v8.parseOnBackground'];
  const byKind = {};
  for (const e of main) if (KINDS.includes(e.name) && e.ts < until) byKind[e.name] = (byKind[e.name] ?? 0) + e.dur / 1000;
  const byScript = {};
  for (const e of main) {
    if (e.ts >= until || !['EvaluateScript', 'FunctionCall', 'v8.compileModule', 'v8.evaluateModule', 'v8.compile'].includes(e.name)) continue;
    const d = e.args?.data ?? {};
    const url = (d.url ?? d.fileName ?? '').split('/').pop() || '(none)';
    const key = `${e.name} ${url}${d.functionName ? ' ' + d.functionName : ''}`;
    byScript[key] = (byScript[key] ?? 0) + e.dur / 1000;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]);
  const longTasks = tasks.filter(t => t.dur > 50_000 && t.ts < untilMap).map(t => {
    const inner = main.filter(e => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && KINDS.includes(e.name)).sort((a, b) => b.dur - a.dur).slice(0, 4);
    return { t: Math.round((t.ts - t0) / 1000), d: Math.round(t.dur / 1000), top: inner.map(e => `${e.name}${e.args?.data?.url ? ' ' + e.args.data.url.split('/').pop() : ''}${e.args?.data?.functionName ? ' ' + e.args.data.functionName : ''} ${Math.round(e.dur / 1000)}ms`) };
  });
  const workers = {};
  for (const e of complete) {
    const name = threads.get(`${e.pid}:${e.tid}`) ?? '';
    if (e.pid !== nav.pid || !/Worker/.test(name) || !(e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask')) continue;
    workers[name] ??= { beforeStill: 0, beforeMap: 0 };
    if (e.ts < until) workers[name].beforeStill += Math.min(e.dur, until - e.ts) / 1000;
    if (e.ts < untilMap) workers[name].beforeMap += Math.min(e.dur, untilMap - e.ts) / 1000;
  }
  for (const w of Object.values(workers)) { w.beforeStill = Math.round(w.beforeStill); w.beforeMap = Math.round(w.beforeMap); }
  return {
    mainBusyBeforeStillMs: busy(tasks, until), mainBusyBeforeMapMs: busy(tasks, untilMap),
    byKindBeforeStill: Object.fromEntries(top(byKind, 30)), topScriptsBeforeStill: top(byScript, 20), longTasksBeforeMap: longTasks, workers,
  };
}

// ── Offline: what the data would cost with other encodings ───────────────────────────────────────────────────
async function encodings(url) {
  const res = await fetch(`${base}${url}`, { headers: { 'accept-encoding': 'identity' } });
  const body = Buffer.from(await res.arrayBuffer());
  return {
    raw: body.length,
    gzip6: gzipSync(body, { level: 6 }).length,
    gzip9: gzipSync(body, { level: 9 }).length,
    brotli5: brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } }).length,
    brotli11: brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } }).length,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────────────────
const report = { label, base, at: new Date().toISOString(), host: 'shared 12-core server under load, SwiftShader WebGL, no GPU', profiles: PROFILES, cases: CASES, runs: [] };
const out = evidence(`am13-cold-load-${label}.json`);
const save = () => writeFile(out, JSON.stringify(report, null, 1) + '\n');
for (const c of CASES) {
  for (const profileId of profileIds) {
    const n = profileId === 'none' ? RUNS : 1;
    for (let i = 0; i < n; i++) {
      const run = await coldRun(c, profileId, { shot: profileId === 'none' && i === 0 ? `am13-cold-load-${label}-${c.id}.png` : null });
      run.index = i;
      report.runs.push(run);
      console.log(JSON.stringify({ case: c.id, profile: profileId, i, outcome: run.outcome, failure: run.failure?.slice(0, 200), still: run.milestones?.readyStill, map: run.milestones?.readyMap, world: run.milestones?.worldEnd, requests: run.requests?.length }));
      await save();
    }
  }
  if (process.env.COLD_TRACE !== '0') {
    const run = await coldRun(c, 'none', { trace: true });
    run.index = 'trace';
    report.runs.push(run);
    console.log(JSON.stringify({ case: c.id, trace: true, still: run.milestones?.readyStill, map: run.milestones?.readyMap, busy: run.traceSummary?.mainBusyBeforeStillMs, failure: run.traceSummary?.failure }));
    await save();
  }
}
if (process.env.COLD_RENDERER !== '0') {
  for (const c of CASES.filter(x => x.id === 'map-1440' || x.id === 'hero-1440')) {
    const run = await coldRun(c, 'none', { renderer: true });
    run.index = 'renderer';
    report.runs.push(run);
    console.log(JSON.stringify({ case: c.id, renderer: run.gl?.textures, draws: run.gl?.frames, failure: run.failure?.slice(0, 200) }));
    await save();
  }
}
// Every immutable file a first view reads, measured with other encodings.
const sample = report.runs.find(r => r.case === 'map-1440' && r.profile === 'none' && r.requests);
if (sample) {
  report.encodings = {};
  const urls = [...new Set(sample.requests.filter(r => /^data:(world|region|names|live-file)$/.test(r.group) || r.group === 'js' || r.group === 'css').map(r => r.url))];
  for (const url of urls) {
    try { report.encodings[url] = await encodings(url); } catch (e) { report.encodings[url] = { failure: String(e) }; }
  }
}
await save();
console.log(`wrote ${out}`);
