import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const output = resolve('shots/grand-world/baked-browser');
await build({ configFile: false, root: process.cwd(), logLevel: 'warn',
  build: { target: 'es2022', outDir: output, emptyOutDir: true,
    rollupOptions: { input: resolve('work/lanes/grand-world/check-baked-browser.ts'),
      output: { entryFileNames: 'harness.js' } } } });
if (process.argv.includes('--build-only')) process.exit(0);

const { binding } = JSON.parse(await readFile('work/evidence/grand-world/gw10-bake.json', 'utf8')).bakes[0];
const { kingdomId, sceneHash, layoutRevision, collisionRevision, sourcePlanHash, recipeHash } = binding;
const expected = { kingdomId, sceneHash, layoutRevision, collisionRevision, sourcePlanHash, recipeHash };
const base = `/api/realm/land/${kingdomId}/${sceneHash}`;
const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
const server = createLandReadServer(resolve(process.env.GRAND_LAND_STORE ?? 'shots/grand-world/land-bake-g3'));
const landHandler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path.startsWith('/api/realm/land/')) { landHandler(request, response); return; }
  if (path === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<script type="module" src="/harness.js"></script>'); return; }
  const file = resolve(output, `.${path}`);
  if (!file.startsWith(output + sep)) { response.writeHead(404); response.end(); return; }
  void readFile(file).then(bytes => { response.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream' }); response.end(bytes); },
    () => { response.writeHead(404); response.end(); });
});
const port = assertCapturePort(5171);
let release, browser;
try {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolveListen); });
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(25_000) });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  const requests = [], errors = [], workers = [], workerClosures = [];
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/realm/land/')) requests.push(path); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => { workers.push(worker); workerClosures.push(new Promise(resolveClose => worker.once('close', resolveClose))); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => typeof window.checkBakedBrowser === 'function');
  let timeout;
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Browser acceptance timed out')), 25_000); });
  let cold, warm, repaired, lockedMs;
  try {
    const result = await Promise.race([page.evaluate(expected => window.checkBakedBrowser(expected), expected), deadline]);
    [cold, warm, repaired] = result.summaries; lockedMs = result.lockedMs;
    await Promise.race([Promise.all(workerClosures), deadline]);
  } finally { globalThis.clearTimeout(timeout); }
  assert.equal(cold.stats.cacheHits, 0);
  assert.equal(cold.stats.completedBlobs, 3);
  assert.equal(warm.stats.cacheHits, 3);
  assert.equal(warm.stats.completedBlobs, 3);
  assert.equal(warm.stats.cacheCorruptions, 0);
  assert.equal(repaired.stats.cacheHits, 2);
  assert.equal(repaired.stats.cacheCorruptions, 1);
  assert.equal(repaired.stats.completedBlobs, 3);
  for (const key of ['metadata', 'surfaceGround', 'surfaceWater', 'meshQuads', 'meshOffsets', 'ref']) {
    assert.deepEqual(warm[key], cold[key]); assert.deepEqual(repaired[key], cold[key]);
  }
  assert.equal(requests.filter(path => path === base).length, 5);
  assert.equal(requests.filter(path => path === `${base}/${cold.ref.hash}`).length, 3);
  assert.equal(requests.filter(path => path === `${base}/${binding.manifest.hash}`).length, 3);
  assert.equal(requests.length, 13);
  assert.equal(new Set(requests).size, 4);
  assert.ok(workers.length >= 4, 'Each opening must use an actual worker');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cold: cold.stats, warm: warm.stats, repaired: repaired.stats, lockedMs, requests: requests.length, workers: workers.length }));
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
  await release?.();
}
