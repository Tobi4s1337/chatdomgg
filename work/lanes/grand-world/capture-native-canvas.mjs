import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';

// One native-canvas still per lease. Read in the actual draw task, before the browser discards
// its default framebuffer. Production renderer settings and DOM composition are left untouched.
const hour = Number(process.env.GRAND_NATIVE_HOUR ?? 17.5);
const hours = new Map([[6.5, 'dawn'], [12, 'noon'], [17.5, 'golden'], [22, 'night']]);
assert.ok(hours.has(hour), 'Use a named evidence hour');
const width = 1920, height = 1080;
const landPort = assertCapturePort(Number(process.env.GRAND_LAND_PORT ?? 5182));
const browserPort = assertCapturePort(Number(process.env.GRAND_NATIVE_BROWSER_PORT ?? 5184));
process.env.GRAND_NATIVE_PREVIEW_PORT ??= '5173';
process.env.CHATDOM_REALM_TARGET = 'http://127.0.0.1:5197';
process.env.CHATDOM_API_TARGET = 'http://127.0.0.1:5196';
process.env.CHATDOM_LAND_TARGET = `http://127.0.0.1:${landPort}`;
const directory = resolve('shots/grand-world/land-bake-a');
const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
const receipt = JSON.parse(await readFile('/tmp/grand-world-manifest.json', 'utf8'));
const live = await fetch(`http://127.0.0.1:5197/api/realm/founded/${receipt.kingdomId}`, { signal: globalThis.AbortSignal.timeout(5000) });
assert.equal(live.status, 200);
assert.deepEqual(await live.json(), receipt, 'Current public receipt changed; do not capture a stale binding');
const stem = `work/evidence/grand-world/gw10-native-canvas-${hours.get(hour)}@${width}x${height}`;
await mkdir('work/evidence/grand-world', { recursive: true });
const report = { kind: 'full-native-kingdom-canvas', renderer: 'Chrome SwiftShader',
  capture: 'PNG exported synchronously after the native draw; excludes DOM overlays and loading UI',
  viewport: { width, height }, hour, receipt, landRequests: [], errors: [], workerScripts: [], passed: false };
let release, server, preview, browserServer, browser, page, deadline;
const sockets = new Set();
function ownConnections(httpServer) {
  httpServer.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
}
try {
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(600_000) });
  deadline = setTimeout(() => { void browserServer?.kill(); }, 210_000);
  server = createLandReadServer(directory);
  ownConnections(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port: landPort, host: '127.0.0.1', exclusive: true }, resolve); });
  preview = await startCapturePreview('GRAND_NATIVE_PREVIEW_PORT');
  ownConnections(preview.server.httpServer);
  browserServer = await chromium.launchServer({ host: '127.0.0.1', port: browserPort, channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  browser = await chromium.connect(browserServer.wsEndpoint());
  page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('worker', worker => report.workerScripts.push(new URL(worker.url()).pathname));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/realm/land/')) report.landRequests.push({ path, status: response.status() });
  });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__nativeCanvas = { done: false };
    window.requestAnimationFrame = callback => raf(time => {
      const prior = window.__chatdomKingdom?.inspect().renderCompletedAt ?? 0;
      callback(time);
      const result = window.__nativeCanvas, kingdom = window.__chatdomKingdom;
      if (result.done || result.failure || !kingdom) return;
      const state = kingdom.inspect();
      if (!window.__chatdomReady || !state.loaded || state.renderPhase !== 'drawn' || state.renderCompletedAt <= prior) return;
      const visible = [...document.querySelectorAll('canvas.stream-canvas')].filter(canvas =>
        canvas.style.visibility !== 'hidden' && canvas.width && canvas.height && canvas.getClientRects().length);
      if (visible.length !== 1) return;
      const canvas = visible[0];
      try {
        // Must remain synchronous in THIS draw's RAF callback. A later task can see a cleared buffer.
        const png = canvas.toDataURL('image/png');
        result.png = png;
        result.state = JSON.parse(JSON.stringify({ beforeCompletedAt: prior, afterCompletedAt: state.renderCompletedAt,
          renderStartedAt: state.renderStartedAt, land: state.land, water: state.water,
          fields: state.fields, uploadedBytes: state.uploadedBytes, presence: state.presence,
          stats: kingdom.stats, canvas: { width: canvas.width, height: canvas.height } }));
        result.done = true;
        kingdom.suspendRendering(); // Stop only this scene; leave UI callbacks and timer polling alive.
      } catch (error) { result.failure = error instanceof Error ? error.message : String(error); }
    });
  });
  await page.goto(`${preview.base}/stream?source=realm&kingdom=${receipt.kingdomId}&hour=${hour}`, { timeout: 20_000 });
  await page.waitForFunction(() => window.__nativeCanvas?.done || window.__nativeCanvas?.failure, undefined, { timeout: 185_000, polling: 100 });
  const captured = await page.evaluate(() => window.__nativeCanvas);
  assert.equal(captured.failure, undefined);
  report.state = captured.state;
  assert.equal(captured.state.canvas.width, width); assert.equal(captured.state.canvas.height, height);
  assert.ok(captured.state.afterCompletedAt > captured.state.beforeCompletedAt);
  assert.ok(Math.abs(captured.state.stats.hour - hour) < .01, 'Native hour differs from the requested evidence hour');
  assert.equal(captured.state.land.generatedColumns, 0);
  assert.equal(captured.state.land.initialCoverageReady, true);
  assert.equal(captured.state.land.initialCoveredRegions, captured.state.land.initialRequiredRegions);
  assert.ok(captured.state.stats.homes > 0);
  assert.ok(report.landRequests.length > 2);
  assert.ok(report.landRequests.every(request => request.status === 200 && request.path.includes(receipt.sceneHash)));
  assert.deepEqual(report.errors, []);
  assert.ok(captured.png.startsWith('data:image/png;base64,'));
  const png = Buffer.from(captured.png.slice('data:image/png;base64,'.length), 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
  report.pixelCheck = await page.evaluate(async () => {
    const blob = await (await fetch(window.__nativeCanvas.png)).blob(), bitmap = await globalThis.createImageBitmap(blob);
    const canvas = new globalThis.OffscreenCanvas(64, 64), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, 64, 64); bitmap.close();
    const pixels = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0, squared = 0, alpha = 0, min = 255, max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      sum += value; squared += value * value; alpha += pixels[i + 3]; min = Math.min(min, value); max = Math.max(max, value);
    }
    const count = pixels.length / 4;
    return { mean: sum / count, variance: squared / count - (sum / count) ** 2, meanAlpha: alpha / count, range: max - min };
  });
  assert.ok(report.pixelCheck.meanAlpha > 250 && report.pixelCheck.variance > 4 && report.pixelCheck.range > 12, 'Reject a blank or discarded framebuffer');
  await writeFile(`${stem}.png`, png);
  report.png = `${stem}.png`; report.pngBytes = png.byteLength; report.passed = true;
  console.log(JSON.stringify({ path: report.png, homes: report.state.stats.homes, landBytes: report.state.land.initialNetworkBytes, pixelCheck: report.pixelCheck }));
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try { await browserServer?.kill(); }
  finally {
    globalThis.clearTimeout(deadline);
    for (const socket of sockets) socket.destroy();
    try { if (preview) await closeCapturePreview(preview.server); }
    finally {
      try { if (server?.listening) await new Promise(resolve => server.close(resolve)); }
      finally { await release?.(); await writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`); }
    }
  }
}
