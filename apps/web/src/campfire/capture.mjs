/* global URLSearchParams:readonly */
// Captures the campfire's focused shots: the circle on the web, its between-game states and the
// public stream. Every shot is the SIMULATED development cast at a fixed instant.
//   pnpm build && node apps/web/src/campfire/capture.mjs                     # owns a temporary preview
//   node apps/web/src/campfire/capture.mjs --base-url http://127.0.0.1:5190  # an existing preview of this checkout
//   node apps/web/src/campfire/capture.mjs --only circle,stream
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const only = option('--only')?.split(',');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/campfire`;

// The instant sits mid-discussion of day two, so the clock, a lost lantern and the Gallery all show.
const SHOTS = [
  { name: 'circle', size: [1440, 900], query: { state: 'playing', seats: '12' } },
  { name: 'circle', size: [390, 844], query: { state: 'playing', seats: '12' } },
  { name: 'circle-6', size: [1440, 900], query: { state: 'playing', seats: '6' } },
  { name: 'waiting', size: [1440, 900], query: { state: 'waiting', seats: '8' } },
  { name: 'waiting', size: [390, 844], query: { state: 'waiting', seats: '8' } },
  { name: 'text-only', size: [1440, 900], query: { state: 'text-only', seats: '9' } },
  { name: 'closed', size: [1440, 900], query: { state: 'closed', seats: '6' } },
  { name: 'stream', size: [1920, 1080], query: { state: 'playing', seats: '12', surface: 'stream' } },
  { name: 'stream', size: [1280, 720], query: { state: 'playing', seats: '12', surface: 'stream' } },
].filter(shot => !only || only.includes(shot.name));

let server, browser, release;
try {
  if (!SHOTS.length) throw new Error('No campfire shot matches --only.');
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_CAMPFIRE_PORT'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });
  for (const shot of SHOTS) {
    const [width, height] = shot.size;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const query = new URLSearchParams({ ...shot.query, still: '1', at: '0', seed: 'hearthmoor' });
    await page.goto(`${base}/-/campfire?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomCampfireError === 'string', {}, { timeout: 300_000 });
    const report = await page.evaluate(() => ({
      error: window.__chatdomCampfireError ?? null, campfire: window.__chatdomCampfire ?? null,
      surface: document.querySelector('[data-campfire-surface]')?.getAttribute('data-campfire-surface'),
      ribbon: document.querySelector('.campfire-source')?.textContent ?? '',
      overflow: { x: document.documentElement.scrollWidth - window.innerWidth, y: document.documentElement.scrollHeight - window.innerHeight },
      text: document.body.innerText,
    }));
    const label = `${shot.name}@${width}x${height}`;
    if (report.error) throw new Error(`${label}: ${report.error}`);
    if (errors.length) throw new Error(`${label}: ${errors.join('\n')}`);
    const expected = shot.query.surface === 'stream' ? 'stream' : 'circle';
    if (report.surface !== expected || report.campfire?.surface !== expected) throw new Error(`${label}: expected the ${expected} surface, found ${report.surface}. Rebuild the web app.`);
    if (report.campfire.origin !== 'SIMULATED' || !report.ribbon.includes('SIMULATED')) throw new Error(`${label}: the development cast must be labelled SIMULATED.`);
    if (report.overflow.x > 0 || report.overflow.y > 0) throw new Error(`${label}: the page overflows the viewport by ${report.overflow.x}×${report.overflow.y}px.`);
    // The public surfaces carry no private vocabulary beyond the rules and a sanctioned reveal.
    for (const leak of ['knownSnuffers', 'inspection', 'your role', 'Your card']) if (report.text.includes(leak)) throw new Error(`${label}: public text mentions “${leak}”.`);
    await page.screenshot({ path: `${output}/${label}.png` });
    console.log(`Captured ${label} · ${report.campfire.lifecycle} · ${report.campfire.seats} seated.`);
    await page.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
  }
}
