/* global AbortController */
// The campfire's offline listening study: serves the study page, renders it in headless Chrome and writes
// work/evidence/gather/ga11-sound-study.{wav,json}. Run: nice -n 10 node apps/web/src/campfire/sound/study/run.mjs
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../../../packages/testing/capture-ports.mjs';

// Preserve a caller's already lower priority; unprivileged workers cannot raise it again.
os.setPriority(0, Math.max(10, os.getPriority(0)));
const root = resolve(import.meta.dirname, '../../../../../..');
const host = '127.0.0.10';
/** The shared capture lock is held only while the browser renders, and never longer than this. */
const HOLD_MS = 90_000;
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(new Error('Campfire sound study timed out after 270 seconds')), 270_000);
let server, browser, release, holdTimer;
const available = port => new Promise(resolvePort => {
  const socket = net.createServer();
  socket.once('error', () => resolvePort(false));
  socket.listen(port, host, () => socket.close(() => resolvePort(true)));
});
const aborted = () => new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true }));
let result;
try {
  let port;
  for (let candidate = 5170; candidate <= 5189; candidate++) {
    if (candidate === 5187) continue;
    assertCapturePort(candidate);
    if (await available(candidate)) { port = candidate; break; }
  }
  if (!port) throw new Error('No free permitted capture port');
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), root, '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', data => { log += data; }); server.stderr.on('data', data => { log += data; });
  const url = `http://${host}:${port}/apps/web/src/campfire/sound/study/`;
  // Serve and warm the module graph before taking the lock, so the lock covers only the render.
  for (const path of ['', 'study.ts']) for (;;) {
    if (abort.signal.aborted) throw abort.signal.reason;
    if (server.exitCode !== null) throw new Error(`Vite exited: ${log}`);
    try { if ((await fetch(url + path, { signal: abort.signal })).ok) break; } catch (error) { if (abort.signal.aborted) throw error; }
    await new Promise(done => setTimeout(done, 100));
  }
  release = await acquireCaptureLock({ signal: abort.signal });
  const heldAt = Date.now();
  holdTimer = setTimeout(() => abort.abort(new Error(`Campfire sound study held the capture lock for ${HOLD_MS / 1000} seconds`)), HOLD_MS);
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', error => console.error(`[study page] ${error.message}`));
    await Promise.race([page.goto(url), aborted()]);
    await Promise.race([page.waitForFunction(() => typeof window.renderCampfireSoundStudy === 'function'), aborted()]);
    result = await Promise.race([page.evaluate(() => window.renderCampfireSoundStudy()), aborted()]);
  } finally {
    clearTimeout(holdTimer);
    if (browser) { await browser.close(); browser = undefined; }
    await release(); release = undefined;
    console.log(`[capture] lock held ${((Date.now() - heldAt) / 1000).toFixed(1)} s`);
  }
  const directory = resolve(root, 'work/evidence/gather');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'ga11-sound-study.wav'), Buffer.from(result.wav, 'base64'));
  await writeFile(resolve(directory, 'ga11-sound-study.json'), JSON.stringify(result.report, null, 2) + '\n');
  const { report } = result;
  console.log(`Campfire sound study saved at ${directory}; port ${port}; ${report.bytes} bytes; peak ${report.overall.peakDbfs} dBFS; RMS ${report.overall.rmsDbfs} dBFS; peak sources ${report.final.peakSources}.`);
  for (const check of report.checks) console.log(`${check.pass ? 'pass' : 'FAIL'}  ${check.name}`);
  if (!report.passed) process.exitCode = 1;
} finally {
  clearTimeout(timer); clearTimeout(holdTimer);
  if (browser) await browser.close();
  if (release) await release();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(done => server.once('exit', done)); }
}
