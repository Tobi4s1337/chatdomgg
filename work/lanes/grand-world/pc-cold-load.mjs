// Timed load of one page on Tobias's real-GPU Chrome, through the pc tunnel's DevTools port.
// Run only inside chatdom-pc-lease, after this lane's own preview is serving on 127.0.0.1:5192.
//
//   node work/lanes/grand-world/pc-cold-load.mjs <url> <out.json> [--cold] [--size 1920x1080] [--seconds 10]
//
// <url> is http://localhost:5192/... or http://127.0.0.1:5192/... (the same forwarded preview). Chrome shares six
// HTTP/1.1 connections per host across every tab, and other pages left open on localhost:5192 hold EventSource
// streams there; the 127.0.0.1 host has its own pool. Every request the page makes is traced, with the time it
// waited for a connection, and the other pages open on the same host are listed in the record.
//
// http://localhost:5190/... is main's always-on preview (today's land), opened read-only for a same-pose comparison:
// no --cold (never clear his storage for it) and no link measurement (its land server has no throughput route).
//
// --cold clears the browser's HTTP cache and every kind of storage for the page's own origin (never another
// origin) before navigating, so the land arrives over the tunnel's real link. Without it the load is warm.
// Times are from navigation start, read on his machine: first paint (the designed curtain), the curtain in the
// DOM, the land's first complete coverage, and readiness. Then frame intervals are recorded for --seconds.
/* global AbortSignal, WebSocket -- Node 22 globals */
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9333';
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const [url, out] = args.filter((a, i) => !a.startsWith('--') && !['--size', '--seconds', '--timeout', '--shot', '--settle', '--pose', '--profile'].includes(args[i - 1]));
const today = /^http:\/\/localhost:5190\//.test(url ?? '');
if (!(today || /^http:\/\/(localhost|127\.0\.0\.1):5192\//.test(url ?? '')) || !out) throw new Error('usage: <http://localhost:5192/... | http://127.0.0.1:5192/... | http://localhost:5190/...> <out.json> [--cold]');
const origin = new URL(url).origin;
const cold = args.includes('--cold');
if (today && cold) throw new Error('main\'s preview is opened read-only; never cold');
const [width, height] = (flag('size') ?? '1920x1080').split('x').map(Number);
const seconds = Number(flag('seconds') ?? 10), timeout = Number(flag('timeout') ?? 150) * 1000;
// --shot <png> [--settle S]: after the frame record, wait S more seconds, record the land state and capture the page.
const shot = flag('shot'), settle = Number(flag('settle') ?? 0);
// --profile <out.cpuprofile>: sample the page's main thread from navigation to readiness (1 ms interval) and keep
// the performance marks the page recorded; open the profile in DevTools' Performance panel.
const profile = flag('profile');
// --pose ex,ey,ez,tx,ty,tz,fov: before the shot, hold the director and apply this fixed evidence pose through the
// scene's own capture pose (eye-level views on the real founded plan; never a production camera).
const poseText = flag('pose'), pose = poseText ? poseText.split(',').map(Number) : null;
if (pose && (pose.length !== 7 || pose.some(v => !Number.isFinite(v)))) throw new Error('--pose needs seven numbers');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const version = await (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(4000) })).json();
const ws = new WebSocket(version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, CDP.replace(/^http/, 'ws')));
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
// Network trace of this page only: path, start, connection wait, response and end, in ms from navigation.
const requests = new Map();
let navigatedAt = null;
const at = seconds => navigatedAt === null ? null : Math.round(seconds * 1000 - navigatedAt);
function traced(message) {
  const p = message.params;
  if (message.method === 'Network.requestWillBeSent') {
    if (navigatedAt === null && p.type === 'Document') navigatedAt = p.timestamp * 1000;
    const u = new URL(p.request.url);
    if (u.origin === origin) requests.set(p.requestId, { path: u.pathname + u.search, type: p.type, sent: at(p.timestamp) });
  }
  const r = requests.get(p?.requestId);
  if (!r) return;
  if (message.method === 'Network.responseReceived') {
    const t = p.response.timing;
    r.status = p.response.status; r.response = at(p.timestamp);
    // DevTools' "stalled": from the network stack starting the request to its first DNS, connect or send step,
    // which is where a request waits for one of the host's six connections.
    if (t) { r.started = at(t.requestTime); r.stalled = Math.round([t.dnsStart, t.connectStart, t.sendStart].find(v => v >= 0) ?? 0); }
    r.reused = p.response.connectionReused;
  } else if (message.method === 'Network.loadingFinished') r.end = at(p.timestamp);
  else if (message.method === 'Network.loadingFailed') { r.end = at(p.timestamp); r.failed = p.errorText; }
}
const consoleLines = [];
let navigatedWall = null;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method?.startsWith('Network.')) traced(message);
  // The page's own errors and warnings, with their time from navigation (worker errors arrive as exceptions).
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(message.params.type) && consoleLines.length < 200)
    consoleLines.push({ wall: Date.now(), type: message.params.type,
      text: message.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 600) });
  if (message.method === 'Runtime.exceptionThrown' && consoleLines.length < 200)
    consoleLines.push({ wall: Date.now(), type: 'exception',
      text: (message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text ?? '').slice(0, 900) });
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank', background: false });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const s = (method, params) => send(method, params, sessionId);
const evaluate = async (expression, awaitPromise = false) => {
  const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const report = { url, cold, viewport: { width, height }, at: new Date().toISOString(), samples: [], passed: false };
const { targetInfos } = await send('Target.getTargets');
report.otherPagesOnHost = targetInfos.filter(t => t.targetId !== targetId && t.url.startsWith(origin)).map(t => `${t.type} ${t.url.slice(origin.length)}`);
try {
  await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await s('Page.bringToFront');
  // A minimized window draws no frames: nothing would ever open.
  try {
    const { windowId, bounds } = await send('Browser.getWindowForTarget', { targetId });
    report.window = bounds?.windowState ?? null;
    if (bounds?.windowState === 'minimized') await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  } catch {}
  report.renderer = await evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2');
    const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
  if (cold) {
    await s('Network.clearBrowserCache');
    await s('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
  }
  // Watches every WebGL context and the page's frame clock without creating contexts of its own.
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const contexts = []; const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { const c = get.call(this, kind, ...rest); if (c && /webgl/.test(kind) && !contexts.includes(c)) contexts.push(c); return c; };
    window.__probeContexts = contexts; window.__probeFrames = 0;
    const tick = () => { window.__probeFrames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  })()` });
  if (profile) { await s('Profiler.enable'); await s('Profiler.setSamplingInterval', { interval: 1000 }); await s('Profiler.start'); }
  navigatedWall = Date.now();
  await s('Page.navigate', { url });
  const start = Date.now();
  const probe = `(() => {
    const canvas = document.querySelector('canvas[data-hosted-land]');
    let land = null; try { land = canvas ? JSON.parse(canvas.dataset.hostedLand) : null; } catch {}
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
    const lost = (window.__probeContexts ?? []).filter(gl => gl.isContextLost()).length;
    const frames = window.__probeFrames ?? null;
    const steps = performance.getEntriesByType('mark').filter(m => /^(gw11|chatdom:open):/.test(m.name)).map(m => m.name.replace(/^\w+:/, '') + '@' + Math.round(m.startTime));
    const status = (document.querySelector('.stream-curtain,.kingdom-gate,.opening')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 160);
    return { now: Math.round(performance.now()), visible: document.visibilityState, lost, frames, steps, status, ready: window.__chatdomReady === true, curtain: !!document.querySelector('.stream-curtain'),
      phase: window.__chatdomStream?.phase ?? null, paint, responseEnd: nav ? Math.round(nav.responseEnd) : null,
      land: land && { phase: land.phase, covered: land.covered, regions: land.regions, exactRegions: land.exactRegions,
        initialCoverageReady: land.initialCoverageReady, initialNetworkBytes: land.initialNetworkBytes, networkBytes: land.networkBytes,
        cacheHits: land.cacheHits, generatedColumns: land.generatedColumns, startupPhase: land.startupPhase, queuedRequests: land.queuedRequests,
        fadingRegions: land.fadingRegions, activeRequests: land.activeRequests, busy: land.busy, installs: land.installs } };
  })()`;
  const marks = {};
  while (Date.now() - start < timeout) {
    await sleep(250);
    const p = await evaluate(probe).catch(() => null);
    if (!p) continue;
    report.samples.push(p);
    if (p.curtain && marks.curtain === undefined) marks.curtain = p.now;
    if (p.land?.initialCoverageReady && marks.coverage === undefined) marks.coverage = p.now;
    if (p.ready && marks.ready === undefined) marks.ready = p.now;
    if (p.land?.queuedRequests === 0 && p.land?.phase === 'ready' && marks.firstViewLand === undefined) marks.firstViewLand = p.now;
    if (marks.ready !== undefined && (marks.firstViewLand !== undefined || p.now - marks.ready > 20000)) break;
  }
  const last = report.samples.at(-1);
  report.marks = { ...marks, firstPaint: last?.paint['first-paint'] ?? null, firstContentfulPaint: last?.paint['first-contentful-paint'] ?? null };
  report.final = last;
  if (profile) {
    const { profile: data } = await s('Profiler.stop');
    writeFileSync(profile, JSON.stringify(data));
    report.profile = profile;
  }
  report.pageMarks = await evaluate(`performance.getEntriesByType('mark').concat(performance.getEntriesByType('measure'))
    .map(m => ({ name: m.name, at: Math.round(m.startTime), ms: Math.round(m.duration), detail: m.detail ?? null }))`).catch(() => null);
  if (marks.ready === undefined) throw new Error(`not ready after ${timeout / 1000}s`);
  await sleep(1000);
  report.frames = await evaluate(`new Promise(resolve => { const t = []; let last = performance.now(); const end = last + ${seconds} * 1000;
    function frame(now) { t.push(now - last); last = now; if (now < end) return requestAnimationFrame(frame); t.shift();
      const s = [...t].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      resolve({ frames: t.length, p50: q(.5), p95: q(.95), p99: q(.99), worst: s.at(-1), over33: t.filter(x => x > 33.4).length, visible: document.visibilityState }); }
    requestAnimationFrame(frame); })`, true);
  if (shot) {
    // The stream drops its scene handle while it swaps scenes; wait for a live, ready one before posing.
    if (pose) report.pose = await evaluate(`(async () => { const until = performance.now() + 30000;
      while (!(window.__chatdomKingdom && window.__chatdomReady)) {
        if (performance.now() > until) throw new Error('No ready scene to pose'); await new Promise(r => setTimeout(r, 100)); }
      window.__chatdomStream.hold(true);
      window.__chatdomKingdom.pose([${pose.slice(0, 3)}], [${pose.slice(3, 6)}], ${pose[6]}); return true; })()`, true);
    await sleep(settle * 1000);
    report.shot = { path: shot, settleSeconds: settle, state: await evaluate(probe) };
    const { data } = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot, Buffer.from(data, 'base64'));
  }
  report.passed = true;
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  // The tunnel's real link, measured after the load so it never warms a cache: a 1-byte round trip, then 4 MiB of
  // incompressible bytes from this lane's logged land server (serve-land-logged.mjs), uncached.
  report.link = today ? null : await evaluate(`(async () => {
    const time = async bytes => { const t = performance.now(); const r = await fetch('/api/realm/land/__throughput?bytes=' + bytes, { cache: 'no-store' });
      const n = (await r.arrayBuffer()).byteLength; return { status: r.status, bytes: n, ms: Math.round(performance.now() - t) }; };
    const ping = await time(1), bulk = await time(4194304);
    return { ping, bulk, megabitsPerSecond: bulk.status === 200 ? +(bulk.bytes * 8 / 1e6 / (bulk.ms / 1000)).toFixed(2) : null };
  })()`, true).catch(error => ({ error: String(error?.message ?? error) }));
  report.samples = report.samples.filter((_, i, all) => i % 4 === 0 || i === all.length - 1);
  // Land blobs are many and alike; keep every other request, and the land's first ten and any that never ended.
  const all = [...requests.values()], land = all.filter(r => r.path.startsWith('/api/realm/land/') && !r.path.includes('__throughput'));
  report.requests = { total: all.length, unfinished: all.filter(r => r.end === undefined).length, land: land.length,
    landUnfinished: land.filter(r => r.end === undefined).length,
    list: all.filter(r => !land.includes(r) || land.indexOf(r) < 10 || r.end === undefined) };
  report.console = consoleLines.map(({ wall, ...line }) => ({ at: navigatedWall === null ? null : wall - navigatedWall, ...line }));
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  await send('Target.closeTarget', { targetId }).catch(() => {});
  ws.close();
}
const f = report.frames, m = report.marks ?? {};
console.log(`${out} · ${cold ? 'cold' : 'warm'} · ${report.renderer} · paint ${m.firstContentfulPaint}ms curtain ${m.curtain}ms coverage ${m.coverage}ms ready ${m.ready}ms first view ${m.firstViewLand}ms`
  + (f ? ` · p50 ${f.p50.toFixed(1)} p95 ${f.p95.toFixed(1)} p99 ${f.p99.toFixed(1)} worst ${f.worst.toFixed(1)} over33 ${f.over33}` : ` · ${report.error}`));
console.log(`link ${JSON.stringify(report.link)}`);
process.exit(report.passed ? 0 : 1);
