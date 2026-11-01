import { chromium } from '@playwright/test';
import { build, createServer } from 'vite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findCapturePort } from '../../../web/src/growth-card/capture-port.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
let server, browser, release, temporary;
try {
  release = await acquireCaptureLock();
  let port;
  try { port = await findCapturePort(); } catch (error) {
    if (error.message !== 'All permitted capture ports are occupied') throw error;
  }
  let bench;
  if (port) {
    server = await createServer({ root: `${root}apps/panel`, configFile: `${root}apps/panel/vite.config.ts`, logLevel: 'error', optimizeDeps: { entries: ['src/growth-card/bench.html'] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    await server.listen();
    bench = `http://127.0.0.1:${port}/src/growth-card/bench.html`;
  } else {
    temporary = await mkdtemp(join(tmpdir(), 'chatdom-growth-shelf-'));
    await build({ root: `${root}apps/panel`, configFile: `${root}apps/panel/vite.config.ts`, base: './', logLevel: 'error', build: { outDir: temporary, emptyOutDir: true, rollupOptions: { input: `${root}apps/panel/src/growth-card/bench.html` } } });
    bench = pathToFileURL(join(temporary, 'src/growth-card/bench.html')).href;
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', ...(temporary ? ['--allow-file-access-from-files'] : [])] });
  const page = await browser.newPage({ viewport: { width: 318, height: 496 } });
  await page.goto(`${bench}?seed=1&hour=20`);
  await page.getByText('A paper crane folded from a map').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Shelf overflows the panel');
  if (await page.locator('.gcs-shelf li').count() !== 3) throw new Error('Shelf preview is not bounded');
  await page.getByText('More keepsakes in the passport.').waitFor();
  await mkdir(`${root}shots/growth-card`, { recursive: true });
  await page.screenshot({ path: `${root}shots/growth-card/shelf@318x496.png` });
  await page.evaluate(() => window.__earnedShelfBench.pending());
  await page.getByText('Gathering keepsakes…').waitFor();
  await page.evaluate(() => window.__earnedShelfBench.hide());
  await page.getByText('Travels kept private.').waitFor();
  await page.evaluate(() => window.__earnedShelfBench.late());
  if (await page.getByText('A paper crane folded from a map').count()) throw new Error('Private shelf retained or restored a keepsake');
  await page.evaluate(() => window.__earnedShelfBench.empty());
  await page.getByText('No keepsakes recorded yet.').waitFor();
  await page.evaluate(() => window.__earnedShelfBench.invalid());
  await page.getByText('Keepsakes could not be verified.').waitFor();
} finally { await browser?.close(); await server?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); await release?.(); }
