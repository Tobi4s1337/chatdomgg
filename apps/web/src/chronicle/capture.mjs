import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const web = resolve(root, 'apps/web');
const evidence = resolve(import.meta.dirname, 'evidence');
const port = assertCapturePort(5189);
let server, browser, release;
try {
  release = await acquireCaptureLock();
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite did not start')), 30000);
    let output = '';
    const data = chunk => { output += chunk; if (/Local:/.test(output)) { globalThis.clearTimeout(timeout); accept(); } };
    server.stdout.on('data', data); server.stderr.on('data', data);
    server.once('exit', code => { globalThis.clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${output}`)); });
  });
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/src/chronicle/bench.html`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240000 });
    const slider = page.getByRole('slider', { name: 'Travel through the nights' });
    if (!await page.getByText('SIMULATED', { exact: false }).isVisible()) throw new Error('Simulation label is missing');
    await slider.focus(); await page.keyboard.press('End');
    const end = await slider.getAttribute('aria-valuetext');
    await page.screenshot({ path: resolve(evidence, `chronicle-latest@${width}x${height}.png`) });
    await page.keyboard.press('Home');
    const first = await slider.getAttribute('aria-valuetext');
    if (!first || !end || first === end) throw new Error('Keyboard did not change the selected night');
    await page.screenshot({ path: resolve(evidence, `chronicle-first@${width}x${height}.png`) });
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
