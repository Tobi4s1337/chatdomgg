/* global AbortController */
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../../packages/testing/capture-ports.mjs';

// Preserve a caller's already lower priority; unprivileged workers cannot raise it again.
os.setPriority(0, Math.max(10, os.getPriority(0)));
const root = resolve(import.meta.dirname, '../../../../..');
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(new Error('Sound study timed out after 270 seconds')), 270_000);
let server, browser, release;
const available = port => new Promise(resolvePort => {
  const socket = net.createServer();
  socket.once('error', () => resolvePort(false));
  socket.listen(port, '127.0.0.1', () => socket.close(() => resolvePort(true)));
});
try {
  release = await acquireCaptureLock({ signal: abort.signal });
  let port;
  for (let candidate = 5170; candidate <= 5189; candidate++) {
    if (candidate === 5187) continue;
    assertCapturePort(candidate);
    if (await available(candidate)) { port = candidate; break; }
  }
  if (!port) throw new Error('No free permitted capture port');
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), root, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  const url = `http://127.0.0.1:${port}/apps/web/src/tavern/sound-study/`;
  for (;;) {
    if (abort.signal.aborted) throw abort.signal.reason;
    if (server.exitCode !== null) throw new Error(`Vite exited: ${log}`);
    try { if ((await fetch(url, { signal: abort.signal })).ok) break; } catch (error) { if (abort.signal.aborted) throw error; }
    await new Promise(done => setTimeout(done, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => typeof window.renderTavernSoundStudy === 'function');
  const result = await Promise.race([
    page.evaluate(() => window.renderTavernSoundStudy()),
    new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true })),
  ]);
  const directory = resolve(root, 'work/evidence/gather');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'ga10-sound-study.wav'), Buffer.from(result.wav, 'base64'));
  await writeFile(resolve(directory, 'ga10-sound-study.json'), JSON.stringify(result.report, null, 2) + '\n');
  console.log(`Sound study saved at ${directory}; port ${port}; peak ${result.report.peak}; RMS ${result.report.rms}; peak sources ${result.report.peakSources}.`);
} finally {
  clearTimeout(timer);
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(done => server.once('exit', done)); }
  if (release) await release();
}
