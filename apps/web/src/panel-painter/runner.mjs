import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { MAX_STILL_BYTES, paintingDue, paintingRevision, readPainterConfig } from './policy.mjs';

async function boundedBody(response, limit) {
  if (!response.ok) throw new Error(`The painter source answered HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new Error('The painter source exceeds its byte limit.');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('The painter source exceeds its byte limit.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

/** The screenshot is read by Chrome, then encoded by Chrome. Renderer buffers are never read or changed. */
export async function encodeScreenshot(page, png) {
  const encoded = await page.evaluate(async ({ png, limit }) => {
    const source = new globalThis.Image();
    source.src = `data:image/png;base64,${png}`;
    await source.decode();
    const canvas = document.createElement('canvas');
    for (const width of [636, 508, 406, 318]) {
      canvas.width = width; canvas.height = Math.round(source.height * width / source.width);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The browser cannot encode the kingdom painting.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const quality of [.85, .7, .55, .4]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.type === 'image/webp' && blob.size <= limit) {
          return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), width: canvas.width, height: canvas.height };
        }
      }
    }
    throw new Error('The kingdom painting exceeds its byte budget.');
  }, { png: png.toString('base64'), limit: MAX_STILL_BYTES });
  return { ...encoded, bytes: Buffer.from(encoded.bytes) };
}

/** A short, credential-free reason for the log: the first line of the message, with any bearer value removed. */
export function reason(error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure';
  return text.split('\n')[0].replace(/Bearer\s+\S+/gi, 'Bearer …').slice(0, 400);
}

export async function runPainter(config, { once = false, signal, report = console.info, evidenceDirectory,
  launch = options => chromium.launch(options), fetcher = fetch, acquireLock = acquireCaptureLock } = {}) {
  let browser, context;
  const startupRelease = await acquireLock();
  try {
    if (config.cdpOrigin) {
      const version = await fetcher(`${config.cdpOrigin}/json/version`, { signal: globalThis.AbortSignal.timeout(4_000) });
      const endpoint = JSON.parse((await boundedBody(version, 16 * 1024)).toString()).webSocketDebuggerUrl;
      const websocket = new URL(endpoint), tunnel = new URL(config.cdpOrigin);
      if (!['ws:', 'wss:'].includes(websocket.protocol) || !websocket.pathname.startsWith('/devtools/browser/')) throw new Error('The GPU tunnel did not return Chrome.');
      // Chrome reports the PC's DevTools port; only its SSH-forwarded host port is reachable here.
      websocket.host = tunnel.host; websocket.protocol = tunnel.protocol === 'https:' ? 'wss:' : 'ws:';
      browser = await chromium.connectOverCDP(websocket.href, { timeout: 10_000 });
    } else browser = await launch({ channel: 'chrome', headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    context = await browser.newContext({ viewport: { width: 636, height: 400 }, deviceScaleFactor: 1 });
  } catch (error) { if (browser) await browser.close(); throw error; }
  finally { await startupRelease(); }
  const warm = new Map(), painted = new Map();
  const result = { painted: 0, unavailable: 0, unchanged: 0 };
  const read = (path, init = {}) => fetcher(`${config.realmOrigin}${path}`, { ...init,
    signal: signal ? globalThis.AbortSignal.any([signal, globalThis.AbortSignal.timeout(30_000)]) : globalThis.AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${config.ingressSecret}`, ...init.headers } });
  const clock = async () => {
    const response = await read('/api/realm/clock');
    const bytes = await boundedBody(response, 1024), body = JSON.parse(bytes.toString());
    if (body.version !== 1 || !Number.isFinite(body.serverTime) || body.serverTime <= 0) throw new Error('The realm clock is unavailable.');
    return { bytes, serverTime: body.serverTime };
  };
  try {
    do {
      for (const kingdomId of config.kingdomIds) {
        if (signal?.aborted) break;
        let release;
        try {
          const response = await read('/internal/realm/panel/kingdom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kingdomId }) });
          const snapshot = JSON.parse((await boundedBody(response, 8 * 1024 * 1024)).toString());
          if (snapshot.kingdomId !== kingdomId || snapshot.status !== 'kingdom' || !snapshot.presence || !snapshot.manifest) {
            const prior = warm.get(kingdomId); if (prior) { await prior.page.close(); warm.delete(kingdomId); }
            result.unavailable++;
            report(`Kingdom ${kingdomId}: waiting for approved streets and public presence.`); continue;
          }
          const time = await clock(), revision = paintingRevision(snapshot, time.serverTime);
          if (!paintingDue(painted.get(kingdomId), revision, snapshot.stream === 'live', time.serverTime)) { result.unchanged++; continue; }
          // All browser work shares the repository's capture lock on this host.
          release = await acquireLock();
          let entry = warm.get(kingdomId);
          let sceneBytes;
          if (entry?.sceneHash !== snapshot.manifest.sceneHash) {
            sceneBytes = await boundedBody(await read(`/internal/realm/panel/scene/${kingdomId}`), 64 * 1024 * 1024);
            if (createHash('sha256').update(sceneBytes).digest('hex') !== snapshot.manifest.sceneHash) throw new Error('The kingdom scene changed before capture.');
          }
          const input = { snapshot, ...(sceneBytes ? { sceneBytes: [...sceneBytes] } : {}) };
          if (!entry) {
            const page = await context.newPage();
            entry = { page, sceneHash: null, errors: [] }; warm.set(kingdomId, entry);
            const noted = entry.errors;
            const note = text => { noted.push(text); noted.splice(0, noted.length - 3); };
            page.on('pageerror', error => note(reason(error)));
            page.on('crash', () => note('The painter page crashed.'));
            page.on('console', message => { if (message.type() === 'error') note(message.text().split('\n')[0].replace(/Bearer\s+\S+/gi, 'Bearer …').slice(0, 200)); });
            if (config.cdpOrigin) {
              await page.bringToFront();
              const cdp = await context.newCDPSession(page);
              try {
                const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
                if (bounds.windowState === 'minimized') await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
              } catch { /* Chrome may not expose a window on every capture host. */ }
              finally { await cdp.detach(); }
            }
            await page.route('**/api/realm/clock', async route => {
              try { const current = await clock(); await route.fulfill({ contentType: 'application/json', body: current.bytes, headers: { 'Cache-Control': 'no-store' } }); }
              catch { await route.fulfill({ status: 503, body: '' }); }
            });
            await page.exposeBinding('__chatdomPainterRead', () => input);
            await page.goto(`${config.webOrigin}/-/panel-painter`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } else await entry.page.evaluate(input => window.__chatdomPainter.prepare(input), input);
          await entry.page.waitForFunction(() => window.__chatdomPainter?.ready() || window.__chatdomPainter?.error(), null, { timeout: 180_000 });
          const refusal = await entry.page.evaluate(() => window.__chatdomPainter.error());
          if (refusal) throw new Error(`The renderer refused the painting. ${String(refusal).slice(0, 200)}${entry.errors?.length ? ` Page: ${entry.errors.join(' | ')}` : ''}`);
          await entry.page.evaluate(() => window.__chatdomPainter.freeze());
          const png = await entry.page.screenshot({ type: 'png', timeout: 30_000 });
          const image = await encodeScreenshot(entry.page, png);
          entry.sceneHash = snapshot.manifest.sceneHash;
          const capturedAt = (await clock()).serverTime;
          const upload = await fetcher(`${config.apiOrigin}/api/panel/v1/stills`, { method: 'POST',
            signal: signal ? globalThis.AbortSignal.any([signal, globalThis.AbortSignal.timeout(30_000)]) : globalThis.AbortSignal.timeout(30_000),
            headers: { Authorization: `Bearer ${config.uploadSecret}`, 'Content-Type': 'image/webp',
              'X-Chatdom-Kingdom-Id': kingdomId, 'X-Chatdom-Captured-At': String(Math.floor(capturedAt)), 'X-Chatdom-Revision': revision }, body: image.bytes });
          if (!upload.ok) throw new Error(`The painting upload answered HTTP ${upload.status}.`);
          painted.set(kingdomId, { revision, capturedAt });
          if (evidenceDirectory) {
            await mkdir(evidenceDirectory, { recursive: true });
            await writeFile(join(evidenceDirectory, `kingdom-${kingdomId}@636x400.png`), png);
            await writeFile(join(evidenceDirectory, `kingdom-${kingdomId}.webp`), image.bytes);
          }
          result.painted++;
          report(`Kingdom ${kingdomId}: painted ${image.width}x${image.height}, ${image.bytes.length} bytes.`);
        } catch (error) {
          result.unavailable++;
          const entry = warm.get(kingdomId), notes = entry?.errors?.length ? ` Page: ${entry.errors.join(' | ')}` : '';
          if (entry) { await entry.page.close().catch(() => {}); warm.delete(kingdomId); }
          report(`Kingdom ${kingdomId}: painting unavailable (${reason(error)}${error instanceof Error && error.message.includes(' Page: ') ? '' : notes}); retrying on the next pass.`);
        } finally { await release?.(); }
      }
      if (!once && !signal?.aborted) await new Promise(resolve => {
        const done = () => { globalThis.clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 15_000); signal?.addEventListener('abort', done, { once: true });
      });
    } while (!once && !signal?.aborted);
    return result;
  } finally {
    await context.close();
    // Closing a connected Playwright browser disconnects its transport; it never sends Browser.close.
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readPainterConfig(process.env), controller = new globalThis.AbortController();
    process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
    const evidenceIndex = process.argv.indexOf('--evidence-dir');
    const once = process.argv.includes('--once');
    const result = await runPainter(config, { once, signal: controller.signal,
      evidenceDirectory: evidenceIndex >= 0 ? process.argv[evidenceIndex + 1] : undefined });
    if (once && (result.unavailable > 0 || result.painted === 0)) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : 'The painter could not start.'); process.exitCode = 1; }
}
