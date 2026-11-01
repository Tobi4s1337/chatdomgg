/* global AbortSignal */
// Product-route evidence only. Optional --bench-env resumes an already built private isolated harness.
// node apps/web/src/chronicle/native-check.mjs --url 'http://127.0.0.1:5177/stream?source=realm&kingdom=129634568&chronicle=1' --mode record --bench-env /tmp/<owned>/capture.env
import { spawn, execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
const url = args.includes('--url') ? value('--url') : '', mode = args.includes('--mode') ? value('--mode') : 'desktop';
if (!url || !['desktop', 'phone', 'record'].includes(mode)) throw new Error('Pass --url <actual product URL> --mode desktop|phone|record.');
const benchEnv = args.includes('--bench-env') ? value('--bench-env') : undefined;
if (benchEnv && !benchEnv.startsWith('/tmp/chatdom-winddown-live.')) throw new Error('Only the owned winddown capture harness may be resumed.');
const evidence = resolve('work/evidence/chronicle-native'), run = promisify(execFile);
let release, bench, browser, deadline, page;
const problems = [];
const stop = async () => {
  await browser?.close().catch(() => {}); browser = undefined;
  if (bench && bench.exitCode === null && bench.signalCode === null) {
    bench.kill('SIGTERM');
    await Promise.race([new Promise(resolveExit => bench.once('exit', resolveExit)), new Promise(resolveWait => globalThis.setTimeout(resolveWait, 7000))]);
    if (bench.exitCode === null && bench.signalCode === null) throw new Error('The owned harness did not stop.');
  }
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().finally(async () => { await release?.(); process.exit(130); }); });
try {
  release = await acquireCaptureLock({ priority: 'lane', signal: AbortSignal.timeout(20 * 60_000) });
  deadline = globalThis.setTimeout(() => { void stop().finally(async () => { await release?.(); process.exit(124); }); }, 8 * 60_000);
  if (benchEnv) {
    bench = spawn(process.execPath, ['--env-file=.env', `--env-file=${benchEnv}`, 'scripts/live/bench.mjs', 'up', '--skip-build'],
      { env: { ...process.env, CHATDOM_BENCH_PREPARE_MODULE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    bench.stdout.on('data', chunk => { output += String(chunk); });
    bench.stderr.on('data', chunk => { output += String(chunk); });
    const bootEnd = Date.now() + 180_000;
    while (!output.includes('bench up · SIMULATED')) {
      if (bench.exitCode !== null || Date.now() > bootEnd) {
        await writeFile(resolve(dirname(benchEnv), 'chronicle-boot.log'), output, { mode: 0o600 });
        throw new Error(`Owned harness did not boot (exit ${bench.exitCode ?? 'pending'}); inspect its private chronicle-boot.log with credential redaction.`);
      }
      await new Promise(resolveWait => globalThis.setTimeout(resolveWait, 250));
    }
  }
  console.log('[chronicle] owned harness ready; opening actual product route');
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const width = mode === 'phone' ? 390 : 1440, height = mode === 'phone' ? 844 : 900;
  const raw = resolve(evidence, 'raw');
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', ...(mode === 'record' ? { recordVideo: { dir: raw, size: { width, height } } } : {}) });
  page = await context.newPage();
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text().slice(0, 400)); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const overlay = page.locator('.chronicle-native');
  if (!new URL(url).searchParams.has('chronicle') && !(await overlay.count())) await page.getByRole('button', { name: 'Chronicle', exact: true }).click({ timeout: 180_000 });
  await page.waitForSelector('.chronicle-native[data-ready="true"][data-loading="false"]', { timeout: 180_000 });
  await page.waitForSelector('.chronicle-native[data-settled="true"]', { timeout: 120_000 });
  console.log('[chronicle] native historical scene drawn with settled lighting');
  const slider = page.getByRole('slider', { name: 'Travel through the nights' });
  const entries = Number(await slider.getAttribute('max')) + 1;
  if (entries < 2) throw new Error(`The native history has only ${entries} recorded night.`);
  if (!(await overlay.textContent()).includes('SIMULATED') && benchEnv) throw new Error('The isolated fixture lost its simulation provenance.');
  const first = await slider.getAttribute('aria-valuetext');
  if (mode === 'record') {
    const video = page.video();
    // Show a real home construction within the short evidence clip rather than only quiet early nights.
    const start = Math.max(0, Math.min(25, entries - 10));
    await slider.evaluate((element, index) => { element.value = String(index); element.dispatchEvent(new globalThis.Event('input', { bubbles: true })); }, start);
    await page.waitForFunction(index => document.querySelector('.chronicle-track input')?.value === String(index) && document.querySelector('.chronicle-native')?.dataset.loading === 'false', start, { polling: 250, timeout: 120_000 });
    await page.waitForSelector('.chronicle-native[data-settled="true"]', { timeout: 120_000 });
    const clipFirst = await slider.getAttribute('aria-valuetext');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(31_000);
    const end = await slider.getAttribute('aria-valuetext');
    if (end === clipFirst) throw new Error('The actual product Chronicle did not advance.');
    await page.close(); const source = await video.path(); await context.close();
    const duration = Number(JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source])).stdout).format.duration);
    const file = resolve(evidence, 'chronicle-durable-simulated-30s.webm');
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, duration - 30)), '-i', source, '-t', '30', '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-b:v', '0', '-crf', '30', file]);
    await rm(source, { force: true });
    await writeFile(resolve(evidence, 'record.json'), JSON.stringify({ url, entries, first: clipFirst, end, file, problems, audio: 'Playwright capture has no audio; sound is not verified.' }, null, 2));
    console.log(`Recorded actual product history: ${file}; ${clipFirst} → ${end}`);
  } else {
    const file = resolve(evidence, `chronicle-durable@${width}x${height}.png`);
    await page.screenshot({ path: file, timeout: 120_000 });
    await slider.focus(); await slider.press('End');
    await page.waitForFunction(() => { const slider = document.querySelector('.chronicle-track input'); return slider && slider.value === slider.max && document.querySelector('.chronicle-native')?.dataset.loading === 'false'; }, null, { polling: 250, timeout: 120_000 });
    await slider.press('Home');
    await page.waitForFunction(() => document.querySelector('.chronicle-track input')?.value === '0' && document.querySelector('.chronicle-native')?.dataset.loading === 'false', null, { polling: 250, timeout: 120_000 });
    const restored = await slider.getAttribute('aria-valuetext');
    if (first !== restored) throw new Error('Backward seeking failed to restore the first historical snapshot.');
    await page.getByRole('button', { name: 'Close Chronicle' }).click();
    await page.waitForSelector('.chronicle-native', { state: 'detached' });
    await writeFile(resolve(evidence, `${mode}.json`), JSON.stringify({ url, entries, first, restored, file, problems }, null, 2));
    await context.close(); console.log(`Captured and checked native ${mode}: ${file}`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
} catch (error) {
  if (page && !page.isClosed()) {
    const state = await page.evaluate(() => ({ overlay: document.querySelector('.chronicle-native')?.dataset,
      caption: document.querySelector('.chronicle-caption')?.textContent, loading: document.querySelector('.chronicle-native-loading')?.textContent,
      slider: document.querySelector('.chronicle-track input')?.getAttribute('aria-valuetext'), live: window.__chatdomKingdom?.debug })).catch(() => null);
    await writeFile(resolve(evidence, `${mode}-failure.json`), JSON.stringify({ message: error.message, state, problems }, null, 2));
  }
  throw error;
} finally { globalThis.clearTimeout(deadline); await stop(); await release?.(); }
