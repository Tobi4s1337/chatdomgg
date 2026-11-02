// Real-GPU stills and clip frames of the staged pier, run inside chatdom-pc-lease. It serves a build made beforehand
// (nice -n 10 npx vite build apps/web --outDir /tmp/chatdom-pier-play-dist) on 127.0.0.1:5192 and drives Tobias's
// Chrome over its DevTools port.
//
//   chatdom-pc-lease --max 10 -- node work/lanes/pier/gpu-capture.mjs --stills --size=1440x900
//   chatdom-pc-lease --max 10 -- node work/lanes/pier/gpu-capture.mjs --bag --size=390x844
//   chatdom-pc-lease --max 10 -- node work/lanes/pier/gpu-capture.mjs --clip --fps=20 --from=0 --to=900
//
// --stills shoots every beat of one catch on the bench's paused clock (each still is exact, not timed). --clip shoots
// one JPEG per frame of the same catch with clip=1, so the overlay's timers and every CSS animation are stepped on the
// stage's clock too; frames [from, to) let a long clip be split over several leases.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { preview as startPreview } from 'vite';

/* global WebSocket:readonly */
const root = process.cwd();
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = name => process.argv.includes(`--${name}`);
const [width, height] = (arg('size') ?? '1440x900').split('x').map(Number);
const narrow = width < height;
const hour = arg('hour') ?? '18.6', seed = arg('seed') ?? '23';
const output = resolve(root, arg('out') ?? 'work/evidence/pier');
const clipDir = arg('frames') ?? '/tmp/chatdom-pier-clip';
const fps = Number(arg('fps') ?? 20), from = Number(arg('from') ?? 0), to = Number(arg('to') ?? 1e9);
const only = arg('only')?.split(',');
const dist = process.env.PIER_PLAY_DIST ?? '/tmp/chatdom-pier-play-dist';
const port = 5192;

const bytes = await readFile(process.env.PIER_FOUNDED_SCENE ?? '/tmp/chatdom-pier-founded/scene.json');
const scene = JSON.parse(bytes), sceneHash = createHash('sha256').update(bytes).digest('hex');
const receipt = { version: 1, kingdomId: scene.kingdomId, origin: scene.origin, layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash };

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.next = 0; this.pending = new Map();
    this.ready = new Promise((ready, reject) => { this.ws.onopen = ready; this.ws.onerror = () => reject(new Error('The GPU browser could not be reached.')); });
    this.events = [];
    this.ws.onmessage = event => { const message = JSON.parse(event.data); if (message.method) { if (/exceptionThrown|consoleAPICalled/.test(message.method)) this.events.push(message); return; } const promise = this.pending.get(message.id); if (!promise) return; this.pending.delete(message.id); if (message.error) promise.reject(new Error(message.error.message)); else promise.resolve(message.result); };
  }
  send(method, params = {}, sessionId) { const id = ++this.next; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.ws.close(); }
}
const pause = ms => new Promise(ready => setTimeout(ready, ms));

const server = await startPreview({ root: resolve(root, 'apps/web'), logLevel: 'error', build: { outDir: dist }, preview: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{ name: 'pier-read-only-copy', configurePreviewServer(host) {
    host.middlewares.use((request, response, next) => {
      if (request.url === `/api/realm/founded/${scene.kingdomId}`) { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(receipt)); }
      else if (request.url === `/api/realm/founded/scenes/${sceneHash}`) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(bytes); }
      else next();
    });
  } }] });
const version = await fetch('http://127.0.0.1:9333/json/version').then(response => response.json());
const cdp = new Cdp(version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, 'ws://127.0.0.1:9333'));
await cdp.ready;
const started = Date.now();
let targetId;
try {
  ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', background: false }));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  const evaluate = async (expression, awaitPromise = true) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: narrow });
  if (narrow) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await cdp.send('Target.activateTarget', { targetId });
  await send('Page.bringToFront');
  const window = await cdp.send('Browser.getWindowForTarget', { targetId });
  if (window.bounds.windowState === 'minimized') await cdp.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'normal' } });
  const capture = async (path, format = 'png') => {
    const shot = await send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality: 88 });
    await writeFile(path, Buffer.from(shot.data, 'base64'));
  };
  const renderer = async () => evaluate("(()=>{const c=document.createElement('canvas'),gl=c.getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()", false);
  await mkdir(output, { recursive: true });
  const measurements = [];

  if (has('stream')) {
    // The stream view's own director at dusk, over the realm's scene with the pier in it (PIER_FOUNDED_SCENE).
    const camera = arg('camera') ?? 'hero';
    const url = `http://localhost:${port}/stream?source=realm&kingdom=${scene.kingdomId}&hour=${hour}&camera=${camera}`;
    await send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 480 && !ready; i++) { ready = await evaluate('window.__chatdomReady === true', false).catch(() => false); if (!ready) await pause(250); }
    await pause(Number(arg('settle') ?? 4000));
    const path = resolve(output, `pi10-stream-${camera}-dusk@${width}x${height}.png`);
    await capture(path);
    measurements.push({ path: path.replace(root + '/', ''), url, ready, pierPieces: scene.placements.filter(piece => piece.id.startsWith('pier:')).length, renderer: await renderer() });
    console.log(`${path.replace(root + '/', '')} ready=${ready}`);
  } else if (has('fps')) {
    // Frame timing at the pier on the 5080, measured in this front tab: the play bench running live (not paused), the
    // second fisher fishing and the viewer's cast played by the bench's fair player, for ten seconds of real frames.
    const url = `http://localhost:${port}/-/pier?view=play&kingdom=${scene.kingdomId}&hour=${hour}&seed=${seed}`;
    await send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 480 && !ready; i++) { ready = await evaluate('window.__chatdomPier?.stats.ready === true', false).catch(() => false); if (!ready) await pause(250); }
    if (!ready) throw new Error('The pier bench never drew a frame for the timing run.');
    await evaluate('window.__chatdomPier.play.auto(true)', false).catch(() => {});
    await pause(2000);
    const seconds = Number(arg('seconds') ?? 10);
    const timing = await evaluate(`new Promise(done => { const deltas = []; let last = performance.now(); const end = last + ${seconds * 1000};
      const tick = now => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { deltas.sort((a, b) => a - b);
        const at = q => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
        done({ frames: deltas.length, seconds: ${seconds}, fps: deltas.length / ${seconds}, medianMs: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), worstMs: deltas.at(-1) }); } };
      requestAnimationFrame(now => { last = now; requestAnimationFrame(tick); }); })`);
    const layer = await evaluate('window.__chatdomPier.play.stats()', false).catch(() => null);
    const whole = await evaluate('({calls: window.__chatdomPier.stats.calls, triangles: window.__chatdomPier.stats.triangles})', false).catch(() => null);
    const measured = { capturedAt: new Date().toISOString(), url, width, height, renderer: await renderer(), browser: version.Browser, timing, layer, frame: whole };
    await writeFile(resolve(output, `pi10-gpu-fps-${width}x${height}.json`), JSON.stringify(measured, null, 2) + '\n');
    console.log(`fps ${width}x${height}: ${JSON.stringify(timing)} ${measured.renderer}`);
  } else if (has('bag')) {
    // The bag with the Moonlit Pike's card open, and the belt below it.
    const url = `http://localhost:${port}/-/pier?view=bag&card=5f7b9d14-2e3a-4b62-9dae-8a4b5c6d7e56`;
    await send('Page.navigate', { url });
    for (let i = 0; i < 240 && !await evaluate('!!window.__chatdomReady', false).catch(() => false); i++) await pause(250);
    await pause(600);
    const path = resolve(output, `pi10-bag-card-dusk@${width}x${height}.png`);
    await capture(path);
    measurements.push({ path: path.replace(root + '/', ''), url, renderer: await renderer() });
    console.log(path.replace(root + '/', ''));
  } else {
    const clip = has('clip');
    const url = `http://localhost:${port}/-/pier?view=play&kingdom=${scene.kingdomId}&hour=${hour}&seed=${seed}${clip ? '&clip=1' : '&hold=1'}`;
    await send('Page.navigate', { url });
    for (let i = 0; ; i++) {
      const state = await evaluate('JSON.stringify({ready:window.__chatdomPier?.stats.ready,error:window.__chatdomPierError})', false).then(JSON.parse).catch(() => ({}));
      if (state.error) throw new Error(state.error);
      if (state.ready) break;
      if (i % 40 === 0 || i > 360) {
        const where = await evaluate('JSON.stringify({phase: window.__chatdomPierPhase, visible: document.visibilityState, ready: document.readyState, stats: window.__chatdomPier?.stats})', false).catch(() => 'unreadable');
        // How many animation frames this tab is given in one second: zero means the browser window is throttled.
        const frames = await evaluate('new Promise(done => { let n = 0; const end = performance.now() + 1000; const f = now => { n++; if (now < end) requestAnimationFrame(f); else done(n); }; requestAnimationFrame(f); setTimeout(() => done(n), 1500); })').catch(() => 'unreadable');
        const tabs = await fetch('http://127.0.0.1:9333/json/list').then(response => response.json()).then(list => list.filter(t => t.type === 'page').map(t => t.url.slice(0, 60))).catch(() => 'unreadable');
        console.log(`waiting ${Math.round(i / 4)} s: frames/s ${frames}, tabs ${JSON.stringify(tabs)}, ${where.slice(0, 160)}`);
        for (const event of cdp.events.splice(0)) {
          const p = event.params;
          if (event.method === 'Runtime.exceptionThrown') console.log('page exception:', p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text);
          else if (['error', 'warning'].includes(p.type)) console.log(`page ${p.type}:`, p.args?.map(a => a.value ?? a.description).join(' '));
        }
      }
      if (i > 360) throw new Error('The pier bench never drew a meaningful frame.');
      await pause(250);
    }
    const gpu = await renderer();
    if (/swiftshader|llvmpipe|software/i.test(gpu)) throw new Error('The leased browser is using software rendering.');
    const play = (method, ...args) => evaluate(`window.__chatdomPier.play[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const state = () => play('state'), phase = async () => (await play('stats')).phase;
    // Every CSS animation and transition runs on the clip's clock: paused, then set to its own age each frame.
    await evaluate(`window.__clipStep = dt => { const t = (window.__clipT = (window.__clipT ?? 0) + dt);
      for (const a of document.getAnimations()) { if (a.__clipStart === undefined) { a.__clipStart = t; a.pause(); } a.currentTime = t - a.__clipStart; } }`, false);
    await play('pause', true);
    let frame = 0;
    const step = 1000 / fps;
    let carried = 0, stepped = 0;
    // The bench's room ticks on real 50 ms timers, as the realm does: a stage step never runs ahead of real time, or
    // reel edges land on ticks the room has already batched and a fair fight is lost.
    const paced = async ms => { const wait = stepped + ms + 5 - Date.now(); if (wait > 0) await pause(wait); stepped = Date.now(); };
    // One drawn frame of the clip: the stage clock advances one frame's worth (in whole server ticks of up to 50 ms).
    const shootFrame = async () => {
      carried += step;
      const ms = Math.floor(carried); carried -= ms;
      await paced(ms);
      await play('advance', ms, 1);
      await evaluate(`window.__clipStep(${ms})`, false);
      if (frame >= from && frame < to) {
        await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
        await capture(`${clipDir}/frame-${String(frame).padStart(5, '0')}.jpg`, 'jpeg');
      }
      frame += 1;
      if (frame >= to) throw Symbol.for('done');
    };
    const shoot = async name => {
      if (clip || (only && !only.includes(name))) return;
      await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      const path = resolve(output, `pi10-gpu-${name}-dusk@${width}x${height}.png`);
      await capture(path);
      const stats = await play('stats'), pier = await evaluate('({calls: window.__chatdomPier.stats.calls, triangles: window.__chatdomPier.stats.triangles})', false);
      measurements.push({ path: path.replace(root + '/', ''), url, renderer: gpu, layer: stats, frame: pier });
      console.log(`${path.replace(root + '/', '')} ${JSON.stringify(pier)} layer ${JSON.stringify(stats)}`);
    };
    // Advance the stage: in clip mode every 1/fps is one shot frame; for stills it is stepped in server ticks.
    const advance = async ms => {
      if (clip) { for (let left = ms; left > 0; left -= step) await shootFrame(); return; }
      for (let left = ms; left > 0; left -= 50) { await paced(Math.min(50, left)); await play('advance', Math.min(50, left), 4); }
    };
    const until = async (test, every = 100, limit = 30_000) => { for (let spent = 0; spent < limit; spent += every) { if (await test()) return true; await advance(every); } return false; };
    if (clip) await mkdir(clipDir, { recursive: true });
    try {
      await until(async () => (await state()).rod, 50, 4000);
      await advance(1200); await shoot('rest');
      await play('press'); await advance(900); await shoot('draw');
      await play('release'); await advance(300); await shoot('flight');
      await advance(900); await shoot('float');
      await until(async () => (await state()).cast === 'bite', clip ? step : 100, 30_000);
      await advance(150); await shoot('bite');
      // The strike and the fight are played by the bench's own fair player, inside the page on every frame (as the
      // second fisher is), so no reel edge waits on a DevTools round trip.
      await play('auto', true);
      for (let tick = 0; tick < 900; tick++) {
        const now = await state();
        if (now.cast !== 'fighting' && now.cast !== 'bite' && tick > 4) break;
        await advance(clip ? step : 50);
        if (!clip && tick === 60) { await shoot('fight'); await play('camera', 'side'); await shoot('fight-side'); await play('camera', 'shoulder'); }
      }
      await play('auto', false); await play('release');
      await until(async () => (await phase()) === 'leaping', clip ? step : 50, 6000);
      await advance(450); await shoot('leap');
      await until(async () => (await phase()) === 'landed', clip ? step : 50, 3000);
      await advance(300); await shoot('landed');
      await advance(900); await shoot('tag');
      if (!clip) { await play('camera', 'first'); await advance(200); await shoot('tag-first'); await play('camera', 'shoulder'); }
      // The tag's full stay and its slide out, then a breath of the quiet pier.
      if (clip) await advance(7500);
    } catch (error) { if (error !== Symbol.for('done')) throw error; }
    if (clip) console.log(`Clip frames ${from}..${Math.min(frame, to)} of ${frame} at ${fps} fps in ${clipDir}.`);
  }
  if (measurements.length) {
    const name = resolve(output, `pi10-gpu-${has('stream') ? 'stream' : has('bag') ? 'bag' : 'play'}-${width}x${height}-stats.json`);
    await writeFile(name, JSON.stringify({ capturedAt: new Date().toISOString(), receipt, browser: version.Browser, measurements }, null, 2) + '\n');
  }
  console.log(`Held the GPU ${Math.round((Date.now() - started) / 1000)} s.`);
} finally {
  if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  cdp.close();
  await new Promise(done => server.httpServer.close(done));
}
