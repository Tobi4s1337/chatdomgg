/* global URLSearchParams:readonly */
// Captures the planting bench: the founded woods, kept views and clearing envelopes on the plan map.
//   node apps/web/src/kingdom-land/capture-planting.mjs [--base-url http://127.0.0.1:5190] [--only plan,phone] [--seed chatdom]
// Without --base-url it serves apps/web through its own dev server on the first free port in 5170–5199.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const only = new Set((option('--only') ?? 'plan').split(','));
const seed = option('--seed') ?? 'chatdom';
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/kingdom-land`;
const frames = [
  { name: 'planting-plan', view: 'plan', width: 1440, height: 900 },
  { name: 'planting-plan', view: 'phone', width: 390, height: 844 },
].filter(frame => only.has(frame.view));

async function serve() {
  for (let port = 5170; port <= 5199; port++) {
    const server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'warn',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (error?.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No free port in 5170–5199 for the planting bench');
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await serve());
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const frame of frames) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: frame.width, height: frame.height } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || /THREE\.WebGLProgram|shader/i.test(message.text())) errors.push(message.text()); });
    const query = new URLSearchParams({ seed });
    await page.goto(`${base}/src/kingdom-land/planting-bench.html?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomLandError === 'string', {}, { timeout: 900_000 });
    const failure = await page.evaluate(() => window.__chatdomLandError);
    if (failure) throw new Error(`${frame.name}: ${failure}`);
    if (errors.length) throw new Error(`${frame.name}:\n${errors.join('\n')}`);
    await page.screenshot({ path: `${output}/${frame.name}@${frame.width}x${frame.height}.png` });
    await page.close();
    console.log(`[capture] ${frame.name}@${frame.width}x${frame.height}`);
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
