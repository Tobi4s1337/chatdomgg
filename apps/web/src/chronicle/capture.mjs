import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const web = resolve(root, 'apps/web');
const evidence = resolve(import.meta.dirname, 'evidence');
const port = assertCapturePort(5171);
let base;
let server, browser, release;
try {
  release = await acquireCaptureLock();
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite did not start')), 30000);
    let output = '';
    const data = chunk => {
      output += chunk;
      const match = output.match(/Local:\s*(https?:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) { base = match[1]; globalThis.clearTimeout(timeout); accept(); }
    };
    server.stdout.on('data', data); server.stderr.on('data', data);
    server.once('exit', code => { globalThis.clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${output}`)); });
  });
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${base}src/chronicle/bench.html`);
    await page.waitForFunction(() => window.__chatdomReady === true || window.__chronicleError === true, null, { timeout: 240000 });
    if (await page.evaluate(() => window.__chronicleError === true)) throw new Error(`Chronicle failed to open: ${errors.join('\n')}`);
    await page.waitForFunction(() => window.__chronicleLightingReady(), null, { timeout: 120000 });
    const pixels = async () => createHash('sha256').update(await page.evaluate(() => window.__chronicleRenderPixels())).digest('hex');
    const draw = async () => page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    const slider = page.getByRole('slider', { name: 'Travel through the nights' });
    if (!await page.getByText('SIMULATED', { exact: false }).isVisible()) throw new Error('Simulation label is missing');
    await slider.focus(); await page.keyboard.press('Home'); await draw();
    const firstPixels = await pixels();
    await page.keyboard.press('End'); await draw();
    const lastPixels = await pixels();
    const end = await slider.getAttribute('aria-valuetext');
    await page.screenshot({ path: resolve(evidence, `chronicle-latest@${width}x${height}.png`) });
    await page.keyboard.press('Home'); await draw();
    const first = await slider.getAttribute('aria-valuetext');
    if (!first || !end || first === end) throw new Error('Keyboard did not change the selected night');
    await page.screenshot({ path: resolve(evidence, `chronicle-first@${width}x${height}.png`) });
    if (firstPixels === lastPixels) throw new Error('The world image did not change when seeking to the latest entry; first and latest screenshots were saved for diagnosis');
    const marketIndex = await page.evaluate(() => window.__chronicleHistory.snapshots.findIndex(snapshot => snapshot.focus === 'market'));
    if (marketIndex < 1) throw new Error('Market construction snapshot is missing');
    const marketCheck = await page.evaluate(index => {
      const history = window.__chronicleHistory, replay = window.__chronicle;
      const before = { ...history.snapshots[index - 1], focus: 'market' };
      const after = { ...history.snapshots[index], focus: 'market' };
      replay.load({ label: history.label, snapshots: [before, after] });
      const first = window.__chronicleRenderPixels();
      replay.seek(1); const grown = window.__chronicleRenderPixels();
      replay.seek(0); const restored = window.__chronicleRenderPixels();
      replay.load(history); replay.seek(index);
      return { changed: first !== grown, restored: first === restored };
    }, marketIndex);
    if (!marketCheck.changed || !marketCheck.restored) throw new Error(`Market forward/backward rendering failed: ${JSON.stringify(marketCheck)}`);
    await draw();
    await page.screenshot({ path: resolve(evidence, `chronicle-market@${width}x${height}.png`) });
    if (!await page.getByText('The market gained', { exact: false }).isVisible()) throw new Error('Market fact is missing');
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.defaultView.innerWidth)) throw new Error('Horizontal overflow');
    if (errors.length) throw new Error(errors.join('\n'));
    await page.getByRole('button', { name: 'Close Chronicle' }).click();
    if (!await page.getByText('The Chronicle is closed.').isVisible()) throw new Error('Close did not restore the host');
    console.log(`${width}x${height}: keyboard seek, SIMULATED label and close passed`);
    await page.close();
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await release?.();
}
