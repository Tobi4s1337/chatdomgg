/* global clearTimeout */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

// Short, serial stills; never a CPU recording or an fps claim. Only this child server is stopped.
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const port = Number(process.env.GATHER_CAPTURE_PORT ?? 5172);
if (![5171, 5172, 5173, 5182].includes(port)) throw new Error('Choose a free gather capture port.');
const release = await acquireCaptureLock();
let browser, server;
try {
  server = spawn('nice', ['-n', '10', 'pnpm', '--filter', '@chatdom/web', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
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
    await page.goto(`http://127.0.0.1:${port}/-/tavern?view=${view}&still=1&hour=19`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 90_000 });
    if (errors.length) throw new Error(errors.join('\n'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight);
    if (overflow) throw new Error('The tavern page overflows.');
    const path = `${output}/ga10-${view}@${width}x${height}.png`;
    await page.screenshot({ path });
    const scene = await page.evaluate(() => window.__chatdomTavern);
    reports.push({ view, width, height, path, renderer: 'SwiftShader', scene });
    console.log(path);
    await page.close();
  }
  await writeFile(`${output}/ga10-stills.json`, JSON.stringify(reports, null, 2) + '\n');
} finally {
  await browser?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ } }
  await release();
}
