// Runs inside chatdom-pc-lease. It owns one preview serving a read-only scene copy, and every page it opens.
import { createServer as createProbe } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { preview as startPreview } from 'vite';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

/* global WebSocket:readonly, URLSearchParams:readonly */

const root = process.cwd(), output = resolve(root, 'work/evidence/pier');
const software = process.argv.includes('--software');
async function portFree(port) {
  const probe = createProbe();
  try {
    await new Promise((ready, reject) => { probe.once('error', reject); probe.listen(port, '0.0.0.0', ready); });
    await new Promise(ready => probe.close(ready)); return true;
  } catch (error) { if (error.code === 'EADDRINUSE') return false; throw error; }
}
let previewPort = 5192;
if (software) {
  previewPort = 0;
  for (const candidate of [5184, 5185, 5186, 5188, 5189, 5198, 5199, ...Array.from({ length: 14 }, (_, i) => 5170 + i)]) {
    assertCapturePort(candidate);
    if (await portFree(candidate)) { previewPort = candidate; break; }
  }
  if (!previewPort) throw new Error('No safe capture preview port is free.');
}
if (!await portFree(previewPort)) throw new Error('The capture preview port is already in use.');
console.log(`Capture preview ${previewPort}; checked free.`);
const release = software ? await acquireCaptureLock() : undefined;
const bytes = await readFile(process.env.PIER_FOUNDED_SCENE ?? '/tmp/chatdom-pier-founded/scene.json');
const scene = JSON.parse(bytes);
const sceneHash = createHash('sha256').update(bytes).digest('hex');
const receipt = { version: 1, kingdomId: scene.kingdomId, origin: scene.origin, layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash };

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.next = 0; this.pending = new Map();
    this.ready = new Promise((ready, reject) => { this.ws.onopen = ready; this.ws.onerror = () => reject(new Error('The GPU browser could not be reached.')); });
    this.ws.onmessage = event => { const message = JSON.parse(event.data), promise = this.pending.get(message.id); if (!promise) return; this.pending.delete(message.id); if (message.error) promise.reject(new Error(message.error.message)); else promise.resolve(message.result); };
  }
  send(method, params = {}, sessionId) { const id = ++this.next; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.ws.close(); }
}
const pause = ms => new Promise(ready => setTimeout(ready, ms));
let cdp, browser, preview;
try {
  preview = await startPreview({ root: resolve(root, 'apps/web'), build: { outDir: process.env.PIER_PLAY_DIST ?? '/tmp/chatdom-pier-play-dist' }, preview: { host: '127.0.0.1', port: previewPort, strictPort: true },
    plugins: [{ name: 'pier-read-only-copy', configurePreviewServer(host) {
      host.middlewares.use((request, response, next) => {
        if (request.url === `/api/realm/founded/${scene.kingdomId}`) { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(receipt)); }
        else if (request.url === `/api/realm/founded/scenes/${sceneHash}`) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(bytes); }
        else next();
      });
    } }],
  });
  if (software) browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  else {
    const version = await fetch('http://127.0.0.1:9333/json/version').then(response => response.json());
    cdp = new Cdp(version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, 'ws://127.0.0.1:9333')); await cdp.ready;
  }
  await mkdir(output, { recursive: true });
  const pictures = [], measurements = [];
  async function page(url, width, height, path) {
    if (software) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await page.goto(url.replace('localhost', '127.0.0.1'), { waitUntil: 'domcontentloaded' });
        try { await page.waitForFunction(() => window.__chatdomPier?.stats.ready || window.__chatdomPierError, {}, { timeout: 120_000 }); }
        catch (error) { console.error(await page.evaluate(() => ({ phase: window.__chatdomPierPhase, error: window.__chatdomPierError, stats: window.__chatdomPier?.stats })).catch(() => ({ phase: 'unresponsive' })), errors); throw error; }
        const result = await page.evaluate(() => ({ error: window.__chatdomPierError, stats: window.__chatdomPier?.stats }));
        if (errors.length || result.error || !result.stats?.ready) throw new Error(result.error ?? (errors.join('\n') || 'The pier itself is not ready.'));
        await page.screenshot({ path, timeout: 60_000 });
        measurements.push({ path: path.replace(root + '/', ''), width, height, renderer: 'SwiftShader; no performance evidence', stats: result.stats }); pictures.push(path);
        console.log(`${path.replace(root + '/', '')} · SwiftShader · ${result.stats.pierDraws ?? result.stats.colorDraws ?? result.stats.calls} color draws · ${result.stats.pierTriangles ?? result.stats.triangles ?? 'see model stats'} triangles`);
      } finally { await page.close(); }
      return;
    }
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', background: false });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const evaluate = async (expression, awaitPromise = false) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
    try {
      await send('Page.enable'); await send('Runtime.enable');
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Target.activateTarget', { targetId });
      await send('Page.bringToFront');
      const window = await cdp.send('Browser.getWindowForTarget', { targetId });
      if (window.bounds.windowState === 'minimized') await cdp.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'normal' } });
      await send('Page.navigate', { url });
      const deadline = Date.now() + 90_000;
      for (;;) {
        const state = await evaluate('JSON.stringify({ready:window.__chatdomPier?.stats.ready,error:window.__chatdomPierError})').then(JSON.parse).catch(() => ({}));
        if (state.error) throw new Error(state.error);
        if (state.ready) break;
        if (Date.now() > deadline) { const diagnostic = await evaluate('JSON.stringify({body:document.body.innerText, stats:window.__chatdomPier?.stats})').catch(() => 'unreadable'); throw new Error(`No meaningful pier frame: ${diagnostic}`); }
        await pause(250);
      }
      await pause(250);
      const stats = await evaluate('window.__chatdomPier.stats');
      const renderer = await evaluate("(()=>{const c=document.createElement('canvas'),gl=c.getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()");
      if (/swiftshader|llvmpipe|software/i.test(renderer)) throw new Error('The leased browser is using software rendering.');
      const screenshot = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(screenshot.data, 'base64'));
      measurements.push({ path: path.replace(root + '/', ''), url, width, height, renderer, stats }); pictures.push(path);
      console.log(`${path.replace(root + '/', '')} · ${width}×${height} · ${stats.pierDraws ?? stats.calls} draws · ${stats.pierTriangles ?? stats.triangles} triangles`);
    } finally { await cdp.send('Target.closeTarget', { targetId }).catch(() => {}); }
  }
  if (process.argv.includes('--fish')) {
    const group = process.argv.find(arg => arg.startsWith('--group='))?.slice(8) ?? '0';
    if (!/^([0-6]|rod)$/.test(group)) throw new Error('Choose a fish sheet group.');
    const [width, height] = process.argv.includes('--narrow') ? [390, 844] : [1440, 900];
    await page(`http://localhost:${previewPort}/-/pier?view=fish&group=${group}&hour=18.6&still=1`, width, height, resolve(output, `pi10-fish-${group}-dusk@${width}x${height}.png`));
  } else if (process.argv.includes('--assets')) {
    const props = ['lantern', 'rack', 'lectern', 'board', 'bench', 'mooring', 'bucket'];
    for (const style of ['hearth', 'tide', 'grove']) for (const prop of props) for (const angle of ['front', 'side', 'back']) {
      const id = `pier-${style}-${prop}`;
      await page(`http://localhost:${previewPort}/-/pier?view=asset&asset=${id}&angle=${angle}&hour=18.6&still=1`, 480, 480, resolve(output, `pi10-${id}-${angle}@480x480.png`));
    }
  } else if (process.argv.includes('--kits')) {
    // Every kit: its seven furnishings from three angles, then the whole pier in that kit on the copied kingdom's shore at dusk.
    const only = process.argv.find(arg => arg.startsWith('--style='))?.slice(8);
    for (const style of only ? [only] : ['hearth', 'tide', 'grove']) {
      await page(`http://localhost:${previewPort}/-/pier?view=furnishings&style=${style}&hour=18.6&still=1`, 1440, 900, resolve(output, `pi10-kit-${style}-dusk@1440x900.png`));
      const query = new URLSearchParams({ kingdom: scene.kingdomId, view: 'shore', style, hour: '18.6', still: '1', ...(software ? { software: '1' } : {}) });
      await page(`http://localhost:${previewPort}/-/pier?${query}`, 1440, 900, resolve(output, `pi10-shore-${style}-dusk@1440x900.png`));
    }
  } else if (process.argv.includes('--watch')) {
    // The watcher's lanterns and mood (kingdom-layer.ts), read back from the installed placements: shore and head at dusk.
    const sizes = software ? [[1440, 900]] : [[1440, 900], [390, 844]];
    for (const view of software ? ['head'] : ['shore', 'head']) for (const [width, height] of sizes) {
      const query = new URLSearchParams({ kingdom: scene.kingdomId, view, hour: '18.6', layer: 'watch', still: '1', ...(software ? { software: '1' } : {}) });
      await page(`http://localhost:${previewPort}/-/pier?${query}`, width, height, resolve(output, `pi10-watch-${view}-dusk@${width}x${height}.png`));
    }
  } else {
    const sizes = process.argv.includes('--narrow') ? [[390, 844]] : software || process.argv.includes('--first') ? [[1440, 900]] : [[1440, 900], [390, 844]];
    const chosenView = process.argv.includes('--head') ? 'head' : process.argv.includes('--deck') ? 'deck' : 'shore';
    const views = software || process.argv.includes('--first') ? [[chosenView, 18.6]] : [['shore', 18.6], ['shore', 12], ['deck', 18.6], ['head', 18.6]];
    for (const [view, hour] of views) for (const [width, height] of sizes) {
      const query = new URLSearchParams({ kingdom: scene.kingdomId, view, hour: String(hour), still: '1', ...(software ? { software: '1' } : {}) });
      await page(`http://localhost:${previewPort}/-/pier?${query}`, width, height, resolve(output, `pi10-${view}-${hour === 12 ? 'noon' : 'dusk'}@${width}x${height}.png`));
    }
  }
  const statsName = process.argv.includes('--fish') ? `pi10-fish-${process.argv.find(arg => arg.startsWith('--group='))?.slice(8) ?? '0'}${process.argv.includes('--narrow') ? '-narrow' : ''}-render-stats.json` : process.argv.includes('--assets') ? 'pi10-furnishing-render-stats.json' : process.argv.includes('--watch') ? 'pi10-watch-render-stats.json' : process.argv.includes('--kits') ? 'pi10-kits-render-stats.json' : software ? `pi10-${process.argv.includes('--head') ? 'head' : process.argv.includes('--deck') ? 'deck' : 'shore'}-${process.argv.includes('--narrow') ? 'narrow' : 'wide'}-render-stats.json` : 'pi10-pier-render-stats.json';
  await writeFile(resolve(output, statsName), JSON.stringify({ capturedAt: new Date().toISOString(), receipt, measurements }, null, 2) + '\n');
  console.log(`Captured ${pictures.length} ${software ? 'SwiftShader' : 'real-GPU'} stills; owned port ${previewPort}.`);
} finally {
  try { cdp?.close(); await browser?.close(); }
  finally {
    try { await preview?.close(); }
    finally { await release?.(); }
  }
}
