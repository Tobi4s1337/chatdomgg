// The frame-stepped recorder. It never records in real time: it injects the virtual clock before any page
// script runs, then for each frame advances the clock exactly 1/fps s, lets the page settle (images decoded,
// renderer idle), and captures. A slow host only makes a take slower, never different.
//
//   node apps/studio/rig/record.mjs --shot S01 --out <dir> [--from 0] [--to 4] [--fps 60] [--scale 2]
//   node apps/studio/rig/record.mjs --url "/studio/set.html?scene=grand&…" --out <dir> --gpu …
//
//   --gpu       record on Tobias's real-GPU Chrome over the tunnel (run inside chatdom-pc-lease; the studio
//               then serves on 127.0.0.1:5192, which the tunnel forwards to his localhost:5192)
//   --port N    local studio port (a free capture port; checked, never 5191/5192 outside a lease)
//   --alpha     transparent page background (page plates keyed for compositing)
//   --format    png (default) or jpeg; --quality for jpeg (default 92)
//   --settle    a JS expression that must be true before a frame is captured (e.g. the renderer is idle)
//   --ready     a JS expression that must be true before frame 0 (default: window.__chatdomReady === true)
//   --preroll   seconds of virtual time to run (deterministically, in 1/fps steps) before frame 0
//   --take      a name for the take (sidecar and log)
//   --resume    keep frames already captured in <dir> (take.json) and capture only the rest
//   --css       a style added to every same-origin document (the studio hides leftover chips in its own frames)
//   --capture   screenshot (default: one image per frame, `Page.captureScreenshot`) or webcodecs (the plate canvas
//               is encoded in the page by the machine's own GPU with exact timestamps; chunks come back over CDP and
//               are written as an Annex B stream per segment; `verify.mjs` muxes and checks them)
//   --budget    seconds of wall time to capture for before stopping cleanly (a lease's share); --resume carries on
//
// Every take writes `take.json` next to its frames: each frame's index, shot time, clock value and SHA-256 (of the
// image, or of the encoded chunk for webcodecs).
/* global AbortSignal -- Node's own global */
import { Buffer } from 'node:buffer';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudio } from '../server/serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const CLOCK_SOURCE = readFileSync(join(here, 'virtual-clock.js'), 'utf8');
export const CAPTURE_SOURCE = readFileSync(join(here, 'canvas-capture.js'), 'utf8');

/**
 * Encoder configurations to try, best first: H.264 High on the GPU at a fixed quantizer (constant quality, the
 * master), then at a high variable bitrate, then the same in software. Annex B, so segments concatenate.
 */
export function codecCandidates(width, height) {
  const pixels = width * height;
  const bitrate = pixels >= 8e6 ? 160e6 : pixels >= 3.6e6 ? 100e6 : 60e6;
  const avc = { codec: 'avc1.640034', avc: { format: 'annexb' }, latencyMode: 'quality' };
  return [
    { ...avc, hardwareAcceleration: 'prefer-hardware', bitrateMode: 'quantizer' },
    { ...avc, hardwareAcceleration: 'prefer-hardware', bitrateMode: 'variable', bitrate },
    { ...avc, hardwareAcceleration: 'no-preference', bitrateMode: 'variable', bitrate },
  ];
}
/** H.264 quantizer for the master: visually lossless for these plates. */
export const MASTER_QUANTIZER = 14;
const sleep = ms => new Promise(done => setTimeout(done, ms));
/** This worktree's commit, with "+" when the studio or the web app has uncommitted changes (logged per take). */
function buildCommit() {
  try {
    const repo = join(here, '../../..');
    const head = execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim();
    const dirty = execSync('git status --porcelain -- apps/web apps/studio packages', { cwd: repo }).toString().trim().length > 0;
    return dirty ? `${head}+` : head;
  } catch { return '?'; }
}

/** Launch args for headless Chrome on this host (WebGL through SwiftShader: stills only, never footage). */
export const LOCAL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb',
  // One raster path, every time: images decode during raster on one thread (no deferred "checker" decodes and no
  // partial tiles), so a downscaled avatar or emote rasterises to the same bytes in every recording.
  '--disable-checker-imaging', '--disable-partial-raster', '--num-raster-threads=1', '--disable-gpu-rasterization'];

/**
 * The studio on this host: on `port` if given, otherwise on the first capture port that is free now (checked when the
 * recording starts, after the capture lock is held, so a port taken while a job waited in the queue is skipped).
 */
async function startOnFreePort(port) {
  if (port) return startStudio({ port, quiet: true });
  const { CAPTURE_PORTS } = await import('../../../packages/testing/capture-ports.mjs');
  for (const candidate of [...CAPTURE_PORTS].reverse()) {
    try { return await startStudio({ port: candidate, quiet: true }); }
    catch (error) { if (error?.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('no free capture port');
}

async function openBrowser({ gpu }) {
  const { chromium } = await import('@playwright/test');
  if (!gpu) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: LOCAL_ARGS });
    const context = await browser.newContext({ viewport: null });
    return { browser, context, close: () => browser.close() };
  }
  const cdp = process.env.PC_CDP || 'http://127.0.0.1:9333';
  const version = await (await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
  // Chrome reports its own port on his PC; go through the tunnel's end instead.
  const ws = version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, cdp.replace(/^http/, 'ws'));
  const browser = await chromium.connectOverCDP(ws);
  const context = browser.contexts()[0];
  // Disconnect only: his Chrome keeps running; our tab is closed by the caller.
  return { browser, context, close: () => browser.close().catch(() => {}) };
}

/**
 * Records frames [from, to) of `url` (a path on the studio server) into `out`.
 * Returns the take's sidecar object.
 */
export async function record({ url, out, from = 0, to, fps = 60, width = 1920, height = 1080, scale = 1, gpu = false,
  port = 0, alpha = false, format = 'png', quality = 92, settle = null, ready = 'window.__chatdomReady === true',
  preroll = 0, take = 'take', epoch, actions = [], css = '', resume = false, log = () => {}, frameHook = null, readyTimeout = 600,
  capture = 'screenshot', budget = Infinity, quantizer = MASTER_QUANTIZER }) {
  mkdirSync(out, { recursive: true });
  // A resumed take that is already complete over the same span needs no browser (and no lease time).
  if (resume && existsSync(join(out, 'take.json'))) {
    const done = JSON.parse(readFileSync(join(out, 'take.json'), 'utf8'));
    if (done.complete && done.from === from && done.to >= to) { log(`${take}: already complete`); return done; }
  }
  const studio = gpu ? await startStudio({ port: 5192, quiet: true }) : await startOnFreePort(port);
  const { context, close } = await openBrowser({ gpu });
  const page = await context.newPage();
  // A lease that runs out (or a person) stops the recorder with a signal: close our tab in Tobias's Chrome first.
  const abort = async () => { await page.close().catch(() => {}); await close(); await studio.close().catch(() => {}); process.exit(143); };
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  const sidecar = { take, build: buildCommit(), url, fps, width, height, scale, from, to, gpu, format: capture === 'webcodecs' ? 'h264' : format, alpha, capture, frames: [], segments: [], renderer: null, started: new Date().toISOString(), complete: false };
  // A resumed take keeps the frames it already has; stepping through them again costs no capture.
  const previous = resume && existsSync(join(out, 'take.json')) ? JSON.parse(readFileSync(join(out, 'take.json'), 'utf8')) : null;
  const kept = new Map((previous?.frames ?? []).map(f => [f.frame, f]));
  if (previous && capture === 'webcodecs') {
    // Keep each earlier segment only up to what its sidecar recorded (a stop between writing chunks and the sidecar
    // leaves a few unrecorded bytes at the end), and only the frames that are in a kept segment.
    for (const segment of previous.segments ?? []) {
      const file = join(out, segment.file);
      if (!existsSync(file)) continue;
      if (statSync(file).size > segment.bytes) truncateSync(file, segment.bytes);
      sidecar.segments.push(segment);
    }
    const covered = new Set(sidecar.segments.map(s => s.file));
    for (const [frame, f] of kept) if (!covered.has(f.segment)) kept.delete(frame);
  }
  try {
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    if (alpha) await session.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    if (gpu) await session.send('Page.bringToFront').catch(() => {});
    await page.addInitScript({ content: `globalThis.__VIRTUAL_CLOCK_CONFIG__ = ${JSON.stringify({ epoch: epoch ?? Date.UTC(2026, 10, 2, 19, 30, 0), origin: 1000 })};` });
    await page.addInitScript({ content: CLOCK_SOURCE });
    if (capture === 'webcodecs') await page.addInitScript({ content: CAPTURE_SOURCE });
    // The studio's own frames hide leftovers (e.g. SIMULATED chips): a style in every same-origin document.
    if (css) await page.addInitScript({ content: `(() => { const css = ${JSON.stringify(css)}; const add = () => { const s = document.createElement('style'); s.dataset.studio = 'clean'; s.textContent = css; (document.head || document.documentElement).appendChild(s); }; document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', add, { once: true }) : add(); })();` });
    const full = new URL(url, studio.base).toString();
    log(`open ${full}`);
    await page.goto(full, { waitUntil: 'load', timeout: readyTimeout * 1000 });
    sidecar.renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL';
    });
    log(`renderer ${sidecar.renderer}`);
    // Load with time standing still: zero-length frames let rAF-driven loaders install work without time passing.
    const started = Date.now();
    for (;;) {
      const done = await page.evaluate(`(() => { globalThis.__virtualClock.advance(0); return !!(${ready}); })()`).catch(() => false);
      if (done) break;
      if (Date.now() - started > readyTimeout * 1000) throw new Error(`not ready after ${readyTimeout} s: ${ready}`);
      await sleep(40);
    }
    log(`ready after ${((Date.now() - started) / 1000).toFixed(1)} s`);
    // A studio shot knows its own length and its scripted inputs.
    const meta = await page.evaluate(() => window.__studio ? { duration: window.__studio.duration, actions: window.__studio.actions ?? [] } : null);
    to ??= meta?.duration ?? 1;
    sidecar.to = to;
    actions = [...actions, ...(meta?.actions ?? [])];
    const step = 1000 / fps;
    for (let i = 0; i < Math.round(preroll * fps); i++) await page.evaluate(ms => globalThis.__virtualClock.advance(ms), step);
    const first = Math.round(from * fps), last = Math.round(to * fps);
    const pending = [...actions].sort((a, b) => a.at - b.at);
    let encoded = null;
    if (capture === 'webcodecs') {
      const w = Math.round(width * scale / 2) * 2, h = Math.round(height * scale / 2) * 2;
      const opened = await page.evaluate(options => globalThis.__studioCapture.configure(options), { width: w, height: h, fps, candidates: codecCandidates(w, h), keyInterval: fps });
      if (!opened.ok) throw new Error(`WebCodecs: ${opened.reason} ${JSON.stringify(opened.refused ?? [])}`);
      sidecar.encoder = opened.config;
      log(`encoder ${opened.config.codec} ${opened.config.hardwareAcceleration} ${opened.config.bitrateMode}${opened.config.bitrate ? ` ${opened.config.bitrate / 1e6} Mb/s` : ` q${quantizer}`} at ${w}×${h}`);
      encoded = { file: null, bytes: 0, first: null, last: null, pending: new Map() };
    }
    const drain = async (all = false) => {
      if (all) await page.evaluate(() => globalThis.__studioCapture.flush());
      for (;;) {
        const got = await page.evaluate(() => globalThis.__studioCapture.drain());
        if (got.errors.length) throw new Error(`encoder: ${got.errors.join('; ')}`);
        for (const chunk of got.chunks) {
          const index = Math.round(chunk.timestamp * fps / 1e6);
          const meta = encoded.pending.get(index);
          if (!meta) throw new Error(`encoder returned frame ${index}, which was never submitted (or came out of order)`);
          encoded.pending.delete(index);
          const bytes = Buffer.from(chunk.data, 'base64');
          appendFileSync(join(out, encoded.file), bytes);
          encoded.bytes += bytes.length;
          encoded.last = index;
          sidecar.frames.push({ ...meta, sha256: chunk.sha256, size: chunk.size, key: chunk.key, segment: encoded.file });
        }
        const segment = sidecar.segments.find(s => s.file === encoded.file);
        if (segment) Object.assign(segment, { last: encoded.last, bytes: encoded.bytes });
        if (got.chunks.length) writeFileSync(join(out, 'take.json'), JSON.stringify(sidecar, null, 1));
        if (got.left) continue;
        if (!all || encoded.pending.size === 0) break;
        if (!got.chunks.length) throw new Error(`the encoder dropped ${encoded.pending.size} frames (first ${[...encoded.pending.keys()][0]})`);
      }
    };
    const t0 = Date.now();
    let stopped = false;
    for (let frame = 0; frame < last; frame++) {
      const t = frame / fps;
      if (frame > 0) await page.evaluate(ms => globalThis.__virtualClock.advance(ms), step);
      // The studio page draws its own state from t; other pages only follow the clock.
      await page.evaluate(async time => { if (window.__studio) await window.__studio.frame(time); }, t);
      while (pending.length && pending[0].at <= t + 1e-9) await act(page, pending.shift());
      if (frameHook) await frameHook(page, t, frame);
      // Every step waits for the renderer, captured or not, so a resumed take reaches each frame in the same state.
      if (settle) await waitFor(page, settle, 120);
      if (frame < first) continue;
      if (kept.has(frame - first) && (capture === 'webcodecs' || existsSync(join(out, `${String(frame - first).padStart(6, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`)))) {
        sidecar.frames.push(kept.get(frame - first));
        continue;
      }
      if (Date.now() - t0 > budget * 1000) { stopped = true; log(`budget of ${budget} s reached at frame ${frame - first}`); break; }
      const clock = await page.evaluate(() => globalThis.__virtualClock.now());
      if (encoded) {
        const index = frame - first;
        if (encoded.file === null) {
          encoded.file = `seg-${String(index).padStart(6, '0')}.h264`;
          writeFileSync(join(out, encoded.file), Buffer.alloc(0));
          sidecar.segments.push({ file: encoded.file, first: index, last: null, bytes: 0 });
        }
        encoded.pending.set(index, { frame: index, t: Number(t.toFixed(6)), clock });
        let queue = (await page.evaluate(([i, q]) => globalThis.__studioCapture.capture(i, { quantizer: q }), [index, quantizer])).queue;
        while (queue > 6) { await sleep(5); queue = await page.evaluate(() => globalThis.__studioCapture.queue()); }
        if (index % 30 === 29) await drain();
      } else {
        const shot = await session.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), fromSurface: true, captureBeyondViewport: false });
        const bytes = Buffer.from(shot.data, 'base64');
        const name = `${String(frame - first).padStart(6, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`;
        writeFileSync(join(out, name), bytes);
        sidecar.frames.push({ frame: frame - first, t: Number(t.toFixed(6)), clock, sha256: createHash('sha256').update(bytes).digest('hex') });
        if ((frame - first) % 60 === 59) writeFileSync(join(out, 'take.json'), JSON.stringify(sidecar, null, 1));
      }
      if ((frame - first) % 30 === 0) log(`frame ${frame - first}/${last - first} t=${t.toFixed(3)} (${((frame - first + 1) / ((Date.now() - t0) / 1000 / 60)).toFixed(0)} frames/min)`);
    }
    if (encoded && encoded.file) await drain(true);
    sidecar.frames.sort((a, b) => a.frame - b.frame);
    sidecar.finished = new Date().toISOString();
    sidecar.complete = !stopped && sidecar.frames.length === last - first;
    const fresh = sidecar.frames.length - kept.size;
    sidecar.framesPerMinute = Number((fresh / ((Date.now() - t0) / 60000)).toFixed(1));
    sidecar.runs = [...(previous?.runs ?? []), { started: new Date(t0).toISOString(), frames: fresh, seconds: Math.round((Date.now() - t0) / 1000), framesPerMinute: sidecar.framesPerMinute, renderer: sidecar.renderer }];
    writeFileSync(join(out, 'take.json'), JSON.stringify(sidecar, null, 1));
    return sidecar;
  } finally {
    process.off('SIGTERM', abort);
    process.off('SIGINT', abort);
    await page.close().catch(() => {});
    await close();
    await studio.close();
  }
}

async function waitFor(page, expression, seconds) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    if (await page.evaluate(`!!(${expression})`).catch(() => false)) return;
    if (Date.now() > until) throw new Error(`frame never settled: ${expression}`);
    await sleep(25);
  }
}

/** A scripted input: a real mouse click at a page point (it reaches same-origin iframes as a person's would). */
async function act(page, action) {
  if (action.kind === 'click') {
    await page.mouse.move(action.x, action.y);
    await page.mouse.down();
    await page.mouse.up();
  } else if (action.kind === 'eval') {
    await page.evaluate(action.expression);
  }
}

function args(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2), next = argv[i + 1];
    flags[key] = next === undefined || next.startsWith('--') ? true : (i++, next);
  }
  return flags;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = args(process.argv.slice(2));
  if (!f.out || (!f.url && !f.shot)) { process.stderr.write('usage: record.mjs (--shot S01 | --url /path) --out <dir> [--from s] [--to s] [--gpu] …\n'); process.exit(2); }
  const [width, height] = String(f.size ?? '1920x1080').split('x').map(Number);
  const url = f.shot ? `/studio/?shot=${f.shot}&t=0` : String(f.url);
  const sidecar = await record({ url, out: resolve(String(f.out)), from: Number(f.from ?? 0), ...(f.to !== undefined ? { to: Number(f.to) } : {}), fps: Number(f.fps ?? 60),
    width, height, scale: Number(f.scale ?? 1), gpu: !!f.gpu, port: Number(f.port ?? 0), alpha: !!f.alpha, format: f.format === 'jpeg' ? 'jpeg' : 'png',
    quality: Number(f.quality ?? 92), settle: f.settle ?? null, ...(f.ready ? { ready: String(f.ready) } : {}), preroll: Number(f.preroll ?? 0),
    take: String(f.take ?? f.shot ?? 'take'), resume: !!f.resume, css: f.css ? String(f.css) : '', capture: f.capture === 'webcodecs' ? 'webcodecs' : 'screenshot',
    ...(f.budget ? { budget: Number(f.budget) } : {}), log: line => process.stdout.write(`${line}\n`) });
  process.stdout.write(`${sidecar.frames.length} frames · ${sidecar.framesPerMinute} frames/min · ${sidecar.renderer}\n`);
}
