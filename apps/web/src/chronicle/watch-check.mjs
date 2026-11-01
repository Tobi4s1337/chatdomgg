import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { startChroniclePreview } from './preview.mjs';

// Local verification only. The recording is evidence of a SIMULATED fixture, not a product video.
const evidence = resolve(import.meta.dirname, 'evidence');
const rawDir = resolve(evidence, 'watch-raw');
const output = resolve(evidence, 'chronicle-simulated-30s.webm');
const run = promisify(execFile);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let server, browser, release;

async function ready(page, base) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}src/chronicle/bench.html`);
  await page.waitForFunction(() => window.__chatdomReady === true || window.__chronicleError === true, null, { timeout: 240_000 });
  if (await page.evaluate(() => window.__chronicleError === true)) throw new Error(`Chronicle failed to open: ${errors.join('\n')}`);
  await page.waitForFunction(() => window.__chronicleLightingReady(), null, { timeout: 120_000 });
  if (errors.length) throw new Error(errors.join('\n'));
  return errors;
}

async function accessibility(browser, base, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    // The isolated bench has no live host control. This visible test host stands in for it to check focus restoration.
    await page.addInitScript(() => {
      const observer = new window.MutationObserver(() => {
        if (!document.body) return;
        observer.disconnect();
        const opener = document.createElement('button');
        opener.id = 'chronicle-test-opener'; opener.textContent = 'Open Chronicle';
        Object.assign(opener.style, { position: 'fixed', top: '4px', right: '4px', zIndex: '10' });
        document.body.append(opener); opener.focus();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    const errors = await ready(page, base);
    assert(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches), 'Reduced motion emulation did not apply');
    assert(await page.getByText('SIMULATED', { exact: false }).isVisible(), 'Simulation label is missing');
    const panel = page.getByRole('region', { name: 'Kingdom Chronicle' });
    const close = page.getByRole('button', { name: 'Close Chronicle' });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    const slider = page.getByRole('slider', { name: 'Travel through the nights' });
    const caption = page.locator('.chronicle-caption');
    assert(await panel.isVisible() && await caption.isVisible(), 'Chronicle or its fact is not visible');
    assert(await page.locator('.chronicle-fact').getAttribute('aria-live') === 'polite', 'Fact changes are not announced politely');
    const sizes = await page.evaluate(() => {
      const panel = document.querySelector('.chronicle').getBoundingClientRect();
      const caption = document.querySelector('.chronicle-caption');
      const seek = document.querySelector('.chronicle-track input').getBoundingClientRect();
      const close = document.querySelector('.chronicle-close').getBoundingClientRect();
      return { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        font: Number.parseFloat(window.getComputedStyle(caption).fontSize), seekHeight: seek.height, closeWidth: close.width, closeHeight: close.height };
    });
    assert(!sizes.overflow && sizes.left >= 0 && sizes.top >= 0 && sizes.right <= width && sizes.bottom <= height, `Chronicle is clipped or overflows at ${width}x${height}: ${JSON.stringify(sizes)}`);
    assert(sizes.font >= 18 && sizes.seekHeight >= 44 && sizes.closeWidth >= 44 && sizes.closeHeight >= 44, `Text or touch targets are too small at ${width}x${height}: ${JSON.stringify(sizes)}`);
    assert((await slider.getAttribute('aria-valuetext'))?.includes('entry 1 of'), 'Slider has no understandable current entry');
    await close.focus(); await page.keyboard.press('Tab');
    assert(await play.evaluate(element => element === document.activeElement), 'Keyboard does not reach Play after Close');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__chronicle.state().status === 'ready' && window.__chronicle.state().index >= 1, null, { timeout: 15_000 });
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    assert(await pause.evaluate(element => element === document.activeElement), 'Play control lost keyboard focus');
    await page.keyboard.press('Space');
    const stopped = await slider.inputValue();
    await page.waitForTimeout(3_400);
    assert(await slider.inputValue() === stopped, 'The Chronicle advanced while paused');
    await page.keyboard.press('Space');
    await page.waitForFunction(value => window.__chronicle.state().status === 'ready' && window.__chronicle.state().index > value, Number(stopped), { timeout: 15_000 });
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    assert(await slider.evaluate(element => element === document.activeElement), 'Keyboard does not reach timeline');
    await page.keyboard.press('Home'); const first = await slider.getAttribute('aria-valuetext');
    await page.keyboard.press('End'); const last = await slider.getAttribute('aria-valuetext');
    assert(first && last && first !== last, 'Keyboard seeking did not change the accessible night');
    await page.evaluate(() => window.__chronicle.load({ label: 'SIMULATED', snapshots: [] }));
    assert(await page.getByText('There are no recorded nights to read yet.').isVisible(), 'Empty history state is missing');
    assert(await page.getByText('SIMULATED', { exact: false }).isVisible(), 'Empty simulated history lost its label');
    assert(await page.getByRole('button', { name: 'Play', exact: true }).isDisabled(), 'Empty history allowed playback');
    assert(await slider.getAttribute('aria-valuetext') === null && await slider.inputValue() === '0', 'Empty history retained a stale accessible night');
    await page.evaluate(() => window.__chronicle.load(null));
    assert(await page.getByText('The Chronicle is unavailable right now.').isVisible(), 'Unavailable history state is missing');
    assert(await slider.getAttribute('aria-valuetext') === null, 'Unavailable history retained a stale accessible night');
    await page.evaluate(() => window.__chronicle.load(window.__chronicleHistory));
    await slider.focus(); await page.keyboard.press('Escape');
    assert(await page.getByText('The Chronicle is closed.').isVisible(), 'Escape did not close the Chronicle');
    assert(await page.locator('#chronicle-test-opener').evaluate(element => element === document.activeElement), 'Close did not restore host focus');
    const recovery = await page.evaluate(async () => {
      const { mountChronicle } = await import('/src/chronicle/view.ts');
      const opener = document.querySelector('#chronicle-test-opener');
      const results = [];
      for (const failure of ['clear', 'dispose']) {
        opener.focus();
        const host = document.createElement('div'); document.body.append(host);
        let closed = false, reported = false, disposed = false;
        const view = mountChronicle(host, { history: window.__chronicleHistory,
          binding: { replace() {}, clear() { if (failure === 'clear') throw new Error('clear failed'); },
            dispose() { disposed = true; if (failure === 'dispose') throw new Error('dispose failed'); } },
          sound() { throw new Error('sound failed'); }, onClose(error) { closed = true; reported = error instanceof Error; } });
        const input = host.querySelector('input'); input.value = '1'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
        const advanced = view.replay.state().status === 'ready' && view.replay.state().index === 1;
        const button = host.querySelector('.chronicle-close'); button.focus(); button.click();
        results.push(advanced && closed && reported && disposed && !host.hasChildNodes() && document.activeElement === opener);
        host.remove();
      }
      return results.every(Boolean);
    });
    assert(recovery, 'Host sound or cleanup failure prevented controls, close, error reporting or focus restoration');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${width}x${height}: readable bounds, labels, keyboard, pause/resume, empty/unavailable, Escape and focus restoration passed with reduced motion`);
  } finally { await context.close(); }
}

async function record(browser, base) {
  await mkdir(rawDir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: rawDir, size: { width: 960, height: 600 } } });
  let raw;
  try {
    const page = await context.newPage();
    const errors = await ready(page, base);
    assert(await page.getByText('SIMULATED', { exact: false }).isVisible(), 'Recording is missing the SIMULATED label');
    const video = page.video();
    if (!video) throw new Error('Playwright did not start recording');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(31_000);
    const end = await page.evaluate(() => window.__chronicle.state());
    assert(end.status === 'ready' && end.index >= 8, `Playback did not advance for 30 seconds: ${JSON.stringify(end)}`);
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close(); raw = await video.path();
    console.log(`SIMULATED playback reached entry ${end.index + 1} of ${end.count}; recorded entries advance by snapshot replacement.`);
  } finally { await context.close(); }
  if (!raw) throw new Error('No recording was produced');
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', raw]);
  const duration = Number(JSON.parse(probe.stdout).format.duration);
  if (!Number.isFinite(duration) || duration < 30) throw new Error(`Recording is too short: ${duration} seconds`);
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, duration - 30)), '-i', raw, '-t', '30', '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-b:v', '0', '-crf', '33', output], { maxBuffer: 4 * 1024 * 1024 });
  const finalProbe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output]);
  const finalDuration = Number(JSON.parse(finalProbe.stdout).format.duration);
  if (!Number.isFinite(finalDuration) || finalDuration < 29.9 || finalDuration > 30.2) throw new Error(`Trimmed recording has unexpected duration: ${finalDuration}`);
  await rm(raw, { force: true });
  console.log(`Recorded ${finalDuration.toFixed(2)} seconds at ${output}. Playwright video has no audio; this does not verify sound. Watch the entire file before accepting CH02.`);
}

try {
  let base;
  ({ server, base, release } = await startChroniclePreview());
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [width, height] of [[1440, 900], [390, 844]]) await accessibility(browser, base, width, height);
  await record(browser, base);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await release?.();
}
