/* global clearTimeout, AbortController */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

// Short, serial stills; never a CPU recording or an fps claim. Only this child server is stopped.
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const host = process.env.GATHER_HOST ?? '127.0.0.1';
if (!['127.0.0.1', '127.0.0.10'].includes(host)) throw new Error('Choose an explicit local gather host.');
const port = Number(process.env.GATHER_CAPTURE_PORT ?? 5172);
if (!Number.isInteger(port) || port < 5170 || port > 5189 || port === 5187) throw new Error('Choose a free gather capture port.');
const prefix = process.env.GATHER_EVIDENCE ?? 'ga10';
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prefix)) throw new Error('Invalid evidence prefix.');
const cancellation = new AbortController();
const release = await acquireCaptureLock({ signal: cancellation.signal });
let browser, server;
const deadline = setTimeout(() => { cancellation.abort(new Error('Still capture exceeded 270 seconds.')); void browser?.close(); }, 270_000);
try {
  const probe = createServer();
  const available = await new Promise(resolve => {
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
  if (!available) throw new Error(`Tavern capture port ${port} is occupied; no service was touched.`);
  server = spawn('nice', ['-n', '10', 'pnpm', '--filter', '@chatdom/web', 'exec', 'vite', 'preview', '--host', host, '--port', String(port), '--strictPort',
    ...(process.env.GATHER_WEB_DIST ? ['--outDir', process.env.GATHER_WEB_DIST] : [])], { cwd: root, stdio: 'pipe', detached: true });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Tavern preview did not start')), 15_000);
    server.once('exit', code => { clearTimeout(deadline); reject(new Error(`Tavern preview ended (${code})`)); });
    server.stdout.on('data', data => { if (String(data).includes(`:${port}/`)) { clearTimeout(deadline); resolve(); } });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const output = `${root}/work/evidence/gather`;
  await mkdir(output, { recursive: true });
  const reports = [];
  for (const [view, width, height] of [['room', 1440, 900], ['room', 390, 844], ['bar', 1440, 900], ['table', 1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://${host}:${port}/-/tavern?view=${view}&still=1&hour=19`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 90_000 });
    if (errors.length) throw new Error(errors.join('\n'));
    let firstSoundControl;
    if (view === 'room' && width === 1440) {
      const control = page.getByRole('button', { name: 'Enable sound' });
      await control.click();
      await page.waitForFunction(() => document.querySelector('.gather-tavern-sound')?.getAttribute('aria-pressed') === 'true');
      await page.getByRole('button', { name: 'Mute sound' }).click();
      await page.waitForFunction(() => document.querySelector('.gather-tavern-sound')?.getAttribute('aria-pressed') === 'false');
      firstSoundControl = 'First real button gesture enabled the common audio host; second press muted it.';
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight);
    if (overflow) throw new Error('The tavern page overflows.');
    const path = `${output}/${prefix}-${view}@${width}x${height}.png`;
    await page.screenshot({ path });
    const scene = await page.evaluate(() => window.__chatdomTavern);
    reports.push({ host, port, view, width, height, path, renderer: 'SwiftShader', scene, ...(firstSoundControl ? { firstSoundControl } : {}) });
    console.log(path);
    await page.close();
  }
  await writeFile(`${output}/${prefix}-stills.json`, JSON.stringify(reports, null, 2) + '\n');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ } }
  await release();
}
