import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const width = Number(process.env.GRAND_STARTUP_WIDTH ?? 1920), height = width === 1920 ? 1080 : width === 1440 ? 900 : 844;
assert.ok([1920, 1440, 390].includes(width));
const outDir = resolve(`shots/grand-world/startup-land-bench-${width}`), evidence = 'work/evidence/grand-world';
const store = resolve(process.env.GRAND_LAND_STORE ?? 'shots/grand-world/land-bake-g3');
const webRequire = createRequire(resolve('apps/web/package.json'));
const sceneBytes = await readFile('/tmp/grand-world-scene.json');
const receipt = JSON.parse(await readFile('/tmp/grand-world-manifest.json', 'utf8'));
assert.equal(createHash('sha256').update(sceneBytes).digest('hex'), receipt.sceneHash);
const fixture = JSON.stringify({ plan: JSON.parse(sceneBytes).plan, receipt });
const base = `/api/realm/land/${receipt.kingdomId}/${receipt.sceneHash}`;
await mkdir(evidence, { recursive: true });
await build({ configFile: false, logLevel: 'warn', resolve: { alias: [
  { find: /^three$/, replacement: webRequire.resolve('three').replace(/three\.cjs$/, 'three.module.js') },
  { find: '@chatdom/render', replacement: resolve('packages/render/src/index.ts') },
  { find: '@chatdom/content', replacement: resolve('packages/content/src/index.ts') },
] }, build: { outDir, emptyOutDir: true, target: 'es2022',
  rollupOptions: { input: resolve('work/lanes/grand-world/startup-land-bench.ts'), output: { entryFileNames: 'bench.js' } } } });
if (process.argv.includes('--build-only')) process.exit(0);
const html = '<!doctype html><meta charset="utf-8"><title>Real baked land startup comparison</title><style>body{margin:0}canvas{display:block}</style><canvas></canvas><script type="module" src="/bench.js"></script>';
const report = { kind: 'real-baked-land-owner-comparison', nativeKingdom: false, renderer: 'Chrome SwiftShader',
  capture: 'preserved WebGL canvas PNG; no browser compositor or UI',
  viewport: { width, height }, sceneHash: receipt.sceneHash, frames: [], errors: [], requests: [] };
let release, browser, context, deadline;
try {
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(600_000) });
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  deadline = setTimeout(() => { void browser.close(); }, 180_000);
  context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (url.origin !== 'http://127.0.0.1:5175') return route.abort();
    let body, contentType = 'text/javascript';
    try {
      if (path === '/') { body = html; contentType = 'text/html'; }
      else if (path === '/fixture.json') { body = fixture; contentType = 'application/json'; }
      else if (path === base) {
        body = await readFile(`${store}/bindings/${receipt.kingdomId}/${receipt.sceneHash}.json`); contentType = 'application/json';
      } else if (path.startsWith(`${base}/`) && /^[a-f0-9]{64}$/.test(path.slice(base.length + 1))) {
        body = await readFile(`${store}/blobs/${path.slice(base.length + 1)}.gz`); contentType = 'application/gzip';
      } else {
        const file = resolve(outDir, `.${path}`);
        if (!file.startsWith(outDir + sep) || !path.endsWith('.js')) return route.abort();
        body = await readFile(file);
      }
      if (path.startsWith(base)) report.requests.push({ path, bytes: Buffer.byteLength(body) });
      return route.fulfill({ status: 200, contentType, headers: { 'content-length': String(Buffer.byteLength(body)) }, body });
    } catch { return route.fulfill({ status: 404, body: 'Missing isolated fixture artifact' }); }
  });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5175/', { timeout: 20_000 });
  await page.waitForFunction(() => !!window.__startupLand, undefined, { timeout: 20_000 });
  report.prepared = await page.evaluate(({ width, height }) => window.__startupLand.init(width, height), { width, height });
  for (const [name, method] of [['startup', 'drawStartup'], ['midfade', 'advanceToMidFade'], ['settled', 'advanceToSettled']]) {
    const frame = await page.evaluate(method => window.__startupLand[method](), method);
    assert.equal(frame.stats.generatedColumns, 0);
    assert.ok(frame.render.triangles > 0);
    if (name === 'midfade') assert.ok(frame.stats.fadingRegions > 0);
    assert.deepEqual(report.errors, []);
    const screenshot = `${evidence}/gw10-startup-land-${name}@${width}x${height}.png`;
    report.frames.push({ name, ...frame, screenshot });
    const png = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
    assert.ok(png.startsWith('data:image/png;base64,'));
    await writeFile(screenshot, Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'));
    console.log(`${name} ${width}x${height}: ${JSON.stringify(frame.stats)}`);
  }
  const first = report.frames[0];
  assert.equal(first.stats.initialCoverageReady, true);
  assert.equal(first.stats.startupPhase, 'awaiting-presentation');
  assert.equal(report.frames.at(-1).stats.startupPhase, 'settled');
  if (width === 1920) assert.ok(first.stats.networkBytes <= 4 * 1024 * 1024);
  report.renderChecksPassed = true;
  report.initialBudgetPassed = !first.stats.initialBudgetExceeded;
  await page.evaluate(() => window.__startupLand.dispose());
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  globalThis.clearTimeout(deadline);
  try {
    await context?.close();
  } finally {
    await browser?.close(); await release?.();
    await writeFile(`${evidence}/gw10-startup-land@${width}x${height}.json`, `${JSON.stringify(report, null, 2)}\n`);
  }
}
