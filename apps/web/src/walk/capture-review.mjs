// One still OR one short deterministic motion clip per shared capture-lock acquisition.
// Review benches are explicitly SIMULATED; these are not proof of the town/realm integration.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { createOfflineReview } from './offline-review.mjs';

const { values } = parseArgs({ options: {
  view: { type: 'string', default: 'motion' }, width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' },
  gesture: { type: 'string', default: 'none' },
  clip: { type: 'boolean', default: false }, out: { type: 'string', default: 'shots/walking-together' },
  offline: { type: 'boolean', default: false },
  trajectory: { type: 'string', default: 'straight' }, detail: { type: 'boolean', default: false },
} });
const width = Number(values.width), height = Number(values.height);
if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 1920)) throw new Error('Invalid review dimensions');
if (!['motion', 'wardrobe', 'selector', 'labels'].includes(values.view)) throw new Error('Unknown review view');
if (!['none', 'wave', 'bow', 'cheer', 'dance', 'sit', 'point'].includes(values.gesture)) throw new Error('Unknown gesture');
if (!['straight', 'turns'].includes(values.trajectory)) throw new Error('Unknown trajectory');
if (values.clip && values.view !== 'motion') throw new Error('Only motion review has a deterministic frame barrier');
let server, browser, offline;
const cancellation = new globalThis.AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { cancellation.abort(new Error('Review capture cancelled')); void browser?.close().catch(() => {}); });
const release = await acquireCaptureLock({ signal: cancellation.signal });
const errors = [];
const checks = [];
const tag = values.view === 'motion' ? `motion-${values.gesture}${values.trajectory === 'turns' ? '-turns' : ''}${values.detail ? '-detail' : ''}${values.clip ? '-clip' : ''}` : values.view;
const stem = `${values.out}/${tag}@${width}x${height}`;
try {
  await mkdir(values.out, { recursive: true });
  // Bind only an allowed free port; a busy port is never stopped or reused.
  for (const port of values.offline ? [] : CAPTURE_PORTS) {
    const attempt = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await attempt.listen(); server = attempt; break; } catch (error) { await attempt.close(); if (!/already in use/.test(String(error))) throw error; }
  }
  if (!values.offline && !server) throw new Error('No free review port');
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  const path = values.view === 'wardrobe' ? '/src/avatar-builder/builder.html?still=1&who=lapsed&tab=earned'
    : values.view === 'selector' ? '/src/walk/gestures/review.html'
      : values.view === 'labels' ? '/src/walk/labels/review.html' : `/src/citizens/gestures.html?gesture=${values.gesture}&trajectory=${values.trajectory}&detail=${values.detail ? 1 : 0}`;
  if (values.offline) offline = await createOfflineReview(context, path.split('?')[0], values.out);
  await page.goto(new URL(path, offline?.origin ?? server.resolvedUrls.local[0]).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 120_000 });
  if (values.view === 'wardrobe') {
    await page.getByRole('button', { name: 'Hair', exact: true }).click();
    for (const selector of ['.ab-tiles', '.ab-swatch-group']) {
      const group = page.locator(selector).first();
      const prior = await group.locator('[role="radio"][tabindex="0"]').getAttribute('aria-label')
        ?? await group.locator('[role="radio"][tabindex="0"]').innerText();
      await group.locator('[role="radio"][tabindex="0"]').focus();
      await page.keyboard.press('ArrowRight');
      const result = await group.evaluate(element => {
        const radios = [...element.querySelectorAll('[role="radio"]')], selected = radios.filter(radio => radio.getAttribute('aria-checked') === 'true');
        return { stops: radios.filter(radio => radio.getAttribute('tabindex') === '0').length, selected: selected.length,
          focused: selected[0] === document.activeElement, choice: selected[0]?.getAttribute('aria-label') ?? selected[0]?.textContent?.trim() };
      });
      if (result.stops !== 1 || result.selected !== 1 || !result.focused || prior === result.choice) throw new Error(`Wardrobe arrow selection failed: ${JSON.stringify(result)}`);
      checks.push({ name: `keyboard selection ${selector}`, ...result });
    }
    await page.getByRole('button', { name: 'Earned', exact: true }).click();
    if (!await page.locator('.ab-status').isVisible()) throw new Error('Wardrobe save status is hidden');
    checks.push({ name: 'visible wardrobe save status', words: await page.locator('.ab-status').innerText() });
    await page.waitForFunction(() => document.querySelectorAll('.ab-sheet .ab-thumb-waiting').length === 0);
  }
  if (values.view === 'labels') {
    await page.waitForFunction(() => [...document.querySelectorAll('.walk-person-label')].some(element => element.getAttribute('aria-hidden') === 'false'));
    const bounds = await page.locator('.walk-person-label[aria-hidden="false"]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom + (element.classList.contains('is-speech') ? 7 : 0) };
    }));
    for (const [index, rect] of bounds.entries()) {
      if (rect.left < 7 || rect.top < 7 || rect.right > width - 7 || rect.bottom > height - 7) throw new Error('A visible label escaped the viewport');
      if (bounds.slice(index + 1).some(other => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top)) throw new Error('Visible labels overlapped');
    }
    checks.push({ name: 'measured visible labels do not overlap or escape the viewport', count: bounds.length });
  }
  if (values.clip) {
    // Three seconds, before the review pass loops. No browser-clock stepping or synthetic network evidence.
    const frames = `${values.out}/${tag}-frames-${width}x${height}`;
    await mkdir(frames, { recursive: true });
    for (let index = 0; index < 72; index++) {
      await page.evaluate(t => window.__chatdomGestureReview.seek(t), index / 24);
      await page.screenshot({ path: `${frames}/${String(index).padStart(4, '0')}.png` });
    }
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', `${frames}/%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', `${stem}.mp4`], { stdio: ['ignore', 'ignore', 'inherit'] });
      ffmpeg.once('error', reject); ffmpeg.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg: ${code}`)));
    });
  } else {
    if (values.view === 'motion') await page.evaluate(() => window.__chatdomGestureReview.seek(1));
    await page.screenshot({ path: `${stem}.png` });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(`${stem}.json`, JSON.stringify({ source: 'SIMULATED review bench', offline: values.offline, view: values.view, gesture: values.gesture,
    trajectory: values.trajectory, detail: values.detail, width, height, clip: values.clip,
    errors, checks, limitation: 'Lane component review only. Production wardrobe and gesture bindings remain main-owned needs.' }, null, 2));
  console.log(`Reviewed capture written to ${stem}`);
} finally {
  try {
    // Remove request routing while the context is alive, then close owned services even if it fails.
    try { await offline?.close(); } catch (error) { console.error('Offline review cleanup:', error); }
    const closures = await Promise.allSettled([browser?.close(), server?.close()]);
    for (const result of closures) if (result.status === 'rejected') console.error('Review capture cleanup:', result.reason);
  } finally { await release(); }
}
