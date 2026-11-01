import { chromium } from '@playwright/test';
import { build, createServer } from 'vite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findCapturePort } from './capture-port.mjs';
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
    server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', optimizeDeps: { entries: ['src/growth-card/index.html'] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    await server.listen();
    bench = `http://127.0.0.1:${port}/src/growth-card/index.html`;
  } else {
    temporary = await mkdtemp(join(tmpdir(), 'chatdom-growth-card-'));
    await build({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, base: './', logLevel: 'error', build: { outDir: temporary, emptyOutDir: true, rollupOptions: { input: `${root}apps/web/src/growth-card/index.html` } } });
    bench = pathToFileURL(join(temporary, 'src/growth-card/index.html')).href;
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', ...(temporary ? ['--allow-file-access-from-files'] : [])] });
  await mkdir(`${root}shots/growth-card`, { recursive: true });
  const size = process.argv[2] ?? 'desktop';
  if (!['desktop', 'mobile'].includes(size)) throw new Error('Choose desktop or mobile');
  for (const [width, height] of [size === 'desktop' ? [1440, 900] : [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${bench}?seed=1&hour=20`);
    await page.getByText('SIMULATED').waitFor();
    for (const text of ['Cottage', '12 days', '4 days', '9 days']) if (!await page.getByText(text, { exact: true }).count()) throw new Error(`Missing ${text}`);
    if (await page.getByRole('progressbar').getAttribute('aria-valuetext') !== '18 of 30 qualified days') throw new Error('Progress bar is missing its day count');
    await page.evaluate(() => document.fonts.ready);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Card overflows the viewport');
    const goalContrast = await page.evaluate(() => {
      const goal = document.querySelector('.gc-goal');
      const label = goal?.querySelector('span');
      if (!goal || !label) throw new Error('Goal label missing');
      const luminance = colour => {
        const values = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (!values || values.length !== 3) throw new Error('Unexpected computed colour');
        const channels = values.map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const foreground = luminance(window.getComputedStyle(label).color);
      const background = luminance(window.getComputedStyle(goal).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    if (goalContrast < 4.5) throw new Error(`Goal label contrast ${goalContrast.toFixed(2)} is below 4.5`);
    await page.screenshot({ path: `${root}shots/growth-card/home@${width}x${height}.png` });
    await page.evaluate(() => window.__growthCardBench.replace());
    await page.getByText('Gathering home progress…').waitFor();
    await page.evaluate(() => window.__growthCardBench.late());
    if (await page.getByText('Cottage').count()) throw new Error('Old subject returned after replacement');
    await page.evaluate(() => window.__growthCardBench.empty());
    await page.getByText('No home progress in this snapshot.').waitFor();
    if (!await page.getByText('SIMULATED').count()) throw new Error('Simulated empty snapshot is unlabelled');
    await page.evaluate(() => window.__growthCardBench.unavailable());
    await page.getByText('Home progress is unavailable.').waitFor();
    await page.goto(`${bench}?home=complete`);
    await page.getByText('Your home has reached its highest stage.').waitFor();
    if (await page.getByRole('progressbar').count()) throw new Error('Completed home shows a next goal');
    if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
    await page.close();
  }
} finally { await browser?.close(); await server?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); await release?.(); }
