import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const port = assertCapturePort(Number(process.env.GRAND_COMPACT_PORT ?? 5175));
const outDir = resolve('shots/grand-world/compact-water-bench');
const evidence = 'work/evidence/grand-world';
const webRequire = createRequire(resolve('apps/web/package.json'));
await mkdir(evidence, { recursive: true });
await build({ configFile: false, logLevel: 'warn', resolve: { alias: [
  { find: /^three$/, replacement: webRequire.resolve('three').replace(/three\.cjs$/, 'three.module.js') },
  { find: '@chatdom/render', replacement: resolve('packages/render/src/index.ts') },
] }, build: { outDir, emptyOutDir: true, target: 'es2022',
  rollupOptions: { input: resolve('work/lanes/grand-world/compact-water-bench.ts'), output: { entryFileNames: 'bench.js' } } } });
const script = await readFile(`${outDir}/bench.js`);
const html = '<!doctype html><meta charset="utf-8"><title>Water encoding comparison</title><style>body{margin:0}canvas{display:block}</style><canvas></canvas><script type="module" src="/bench.js"></script>';
const report = { kind: 'isolated-water-material-comparison', renderer: 'Chrome SwiftShader', nativeKingdom: false, frames: [] };
let release, browser, context, video;
try {
  // One short comparison recording; all stills below are frames of that bounded clip.
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(600_000) });
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } } });
  const page = await context.newPage(); video = page.video();
  // This isolated bundle needs no service. Fulfill every request locally; never bind or contact a shared port.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== `http://127.0.0.1:${port}` || !['/', '/bench.js'].includes(url.pathname)) return route.abort();
    return route.fulfill({ status: 200, contentType: url.pathname === '/bench.js' ? 'text/javascript' : 'text/html',
      body: url.pathname === '/bench.js' ? script : html });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Bound the whole recording below five minutes, independent of individual browser waits.
  const deadline = setTimeout(() => { void browser.close(); }, 150_000);
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { timeout: 20_000 });
    await page.waitForFunction(() => !!window.__compactWater, undefined, { timeout: 15_000 });
    for (const [width, height] of [[1440, 900], [390, 844], [1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      const pair = [];
      for (const mode of ['legacy', 'compact']) {
        const frame = { mode, width, height, errors: [] };
        report.frames.push(frame);
        try {
          const result = await page.evaluate(({ mode, width, height }) => window.__compactWater.draw(mode, width, height), { mode, width, height });
          Object.assign(frame, result);
          assert.equal(result.ready, true);
          assert.ok(result.nonzeroPixels > width * height);
          assert.deepEqual(result.reflection, { rendered: true, valid: true, reason: null });
          await page.waitForFunction(() => window.__chatdomReady === true);
          frame.screenshot = `${evidence}/gw10-compact-water-${mode}@${width}x${height}.png`;
          await page.screenshot({ path: frame.screenshot, timeout: 15_000 });
          frame.errors = [...errors];
          assert.deepEqual(frame.errors, []);
          pair.push(result);
          console.log(`${mode} ${width}x${height}: ${result.pixelHash}`);
        } catch (error) {
          frame.failure = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
      assert.equal(pair[0].pixelHash, pair[1].pixelHash, `Pixel mismatch at ${width}x${height}`);
      assert.deepEqual(pair[0].queries, pair[1].queries);
      assert.equal(pair[1].groundAliases, true);
    }
    report.pixelIdentical = true;
  } finally { globalThis.clearTimeout(deadline); }
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  try {
    await context?.close();
    if (video) {
      report.clip = `${evidence}/gw10-compact-water-comparison.webm`;
      await video.saveAs(report.clip);
    }
  } finally {
    await browser?.close();
    await release?.();
    await writeFile(`${evidence}/gw10-compact-water-render.json`, `${JSON.stringify(report, null, 2)}\n`);
  }
}
