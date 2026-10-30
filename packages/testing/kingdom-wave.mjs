import { chromium } from '@playwright/test';
import { acquireCaptureLock } from './capture-lock.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';

// Offline logical-time samples, not a real-time performance measurement.
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : Number(process.argv[i + 1]); };
const fps = option('--fps', 8), duration = option('--duration', 20), hour = option('--hour', 19.5), scale = option('--scale', 2 / 3), logicalSeconds = option('--logical-seconds', 20);
const seedIndex = process.argv.indexOf('--seed');
const seed = seedIndex < 0 ? 'willowmere' : process.argv[seedIndex + 1];
if (!seed || seed.length > 128) throw new Error('Expected a nonempty --seed of at most 128 characters');
if (!Number.isInteger(fps) || fps < 1 || fps > 30 || !Number.isFinite(duration) || duration < 1 || duration > 120 || !Number.isFinite(hour) || hour < 0 || hour >= 24 || !Number.isFinite(scale) || scale <= 0 || scale > 2 || !Number.isFinite(logicalSeconds) || logicalSeconds <= 0 || logicalSeconds > 3600) throw new Error('Expected --fps 1..30, --duration 1..120 seconds, --hour 0..<24, --scale >0..2 and --logical-seconds >0..3600');
const count = Math.max(2, Math.round(fps * duration));
const times = Array.from({ length: count }, (_, i) => logicalSeconds * i / (count - 1));
const output = 'shots/kingdom/wave';
let server, browser, release;
try {
  release = await acquireCaptureLock();
  const externalIndex = process.argv.indexOf('--base-url');
  let base = externalIndex >= 0 ? process.argv[externalIndex + 1] : undefined;
  if (!base) ({ server, base } = await startCapturePreview());
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/?seed=${encodeURIComponent(seed)}&tier=town&hour=${hour}&time=0&camera=window`);
  await page.waitForFunction(() => (window.__chatdomReady && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldUploads > 0 && window.__chatdomKingdom.stats.fieldSettled) || !!document.querySelector('.kingdom-gate button'), null, { timeout: 240_000 });
  if (await page.locator('.kingdom-gate button').count()) throw new Error(`Kingdom error gate: ${await page.locator('.kingdom-gate').innerText()}${errors.length ? `\n${errors.join('\n')}` : ''}`);
  if (!(await page.locator('.source-ribbon').innerText()).includes('SIMULATED')) throw new Error('Missing SIMULATED label');
  const frames = [];
  const initialShadows = await page.evaluate(() => window.__chatdomKingdom.stats.shadowUpdates);
  const initialGeometry = await page.evaluate(() => window.__chatdomKingdom.stats.geometryBuilds);
  if (initialShadows <= 0) throw new Error('No sun shadow map rendered');
  for (const [index, time] of times.entries()) {
    if (index !== 0) await page.evaluate(time => window.__chatdomKingdom.capture(time), time);
    // capture() invalidates the field; two rendered frames ensure its next request has been issued.
    await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
    await page.waitForFunction(time => window.__chatdomKingdom.stats.time === time && window.__chatdomKingdom.stats.fieldSettled, time, { timeout: 120_000 });
    const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
    if (stats.shadowUpdates !== initialShadows) throw new Error(`Sun shadow map rebuilt at ${time}s: ${stats.shadowUpdates} vs ${initialShadows}`);
    if (stats.geometryBuilds !== initialGeometry) throw new Error(`Presence rebuilt geometry at ${time}s`);
    if (errors.length) throw new Error(errors.join('\n'));
    const file = `${String(index).padStart(4, '0')}.png`;
    await page.screenshot({ path: `${output}/${file}`, timeout: 120_000 });
    const namedWindowVisible = await page.getByText('Juniper', { exact: false }).isVisible();
    frames.push({ file, logicalSeconds: time, activeWindows: stats.activeWindows, namedWindowVisible, fieldUploads: stats.fieldUploads, windowFieldVisited: stats.windowFieldVisited, beaconFieldVisited: stats.beaconFieldVisited, shadowUpdates: stats.shadowUpdates });
    if (index % fps === 0 || index === times.length - 1) console.log(`Wave ${index + 1}/${times.length}: ${time.toFixed(2)} s, ${stats.activeWindows} windows`);
  }
  if (frames[0].activeWindows !== 0 || !frames.some(frame => frame.activeWindows === 1) || frames.at(-1).activeWindows !== 240) throw new Error(`Unexpected wave: ${JSON.stringify(frames)}`);
  if (!frames.some(frame => frame.activeWindows === 1 && frame.namedWindowVisible && frame.windowFieldVisited > 0)) throw new Error('First arrival must show Juniper with real window illumination');
  await writeFile(`${output}/manifest.json`, `${JSON.stringify({ label: 'SIMULATED', timing: 'offline logical seconds; not real-time playback or performance', seed, fps, duration, logicalSeconds, hour, cssViewport: { width: 1440, height: 900 }, physicalPixels: { width: Math.round(1440 * scale), height: Math.round(900 * scale) }, deviceScaleFactor: scale, frames }, null, 2)}\n`);
  console.log(`Captured ${frames.length} offline logical-time frames in ${output}; encode with: ffmpeg -framerate ${fps} -i ${output}/%04d.png -c:v libx264 -pix_fmt yuv420p ${output}/wave.mp4`);
} finally {
  try { await browser?.close(); } finally {
    try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
  }
}
