import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { startChroniclePreview } from './preview.mjs';

// One image per lock: the shared host must remain available to other lanes between captures.
const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const view = option('--view') ?? 'first', size = option('--size') ?? 'desktop';
if (!['first', 'latest', 'market'].includes(view) || !['desktop', 'phone'].includes(size)) throw new Error('Use --view first|latest|market --size desktop|phone');
const [width, height] = size === 'desktop' ? [1440, 900] : [390, 844];
const evidence = resolve(import.meta.dirname, 'evidence');
let server, browser, release, failure;
const cleanupErrors = [];
try {
  let base;
  ({ server, base, release } = await startChroniclePreview());
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}src/chronicle/bench.html`, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForFunction(() => window.__chatdomReady === true || window.__chronicleError === true, null, { timeout: 240000 });
  if (await page.evaluate(() => window.__chronicleError === true)) throw new Error(`Chronicle failed to open: ${errors.join('\n')}`);
  await page.waitForFunction(() => window.__chronicleLightingReady(), null, { timeout: 120000 });
  const pixels = async () => createHash('sha256').update(await page.evaluate(() => window.__chronicleRenderPixels())).digest('hex');
  const draw = async () => page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
  const slider = page.getByRole('slider', { name: 'Travel through the nights' });
  const origin = page.locator('.chronicle-origin');
  if (!await origin.isVisible() || !(await origin.innerText()).includes('SIMULATED')) throw new Error('Simulation label is missing');
  await slider.focus(); await page.keyboard.press('Home'); await draw();
  const firstText = await slider.getAttribute('aria-valuetext'), firstPixels = await pixels();
  await page.keyboard.press('End'); await draw();
  const lastText = await slider.getAttribute('aria-valuetext'), lastPixels = await pixels();
  if (!firstText || !lastText || firstText === lastText || firstPixels === lastPixels) throw new Error('Forward seek did not change the accessible night and world image');
  await page.keyboard.press('Home'); await draw();
  if (await slider.getAttribute('aria-valuetext') !== firstText || await pixels() !== firstPixels) throw new Error('Backward seek did not restore the first night and world image');
  if (view === 'latest') { await page.keyboard.press('End'); await draw(); }
  if (view === 'market') {
    const marketIndex = await page.evaluate(() => window.__chronicleHistory.snapshots.findIndex(snapshot => snapshot.focus === 'market'));
    if (marketIndex < 1) throw new Error('Market construction snapshot is missing');
    const marketCheck = await page.evaluate(index => {
      const history = window.__chronicleHistory, replay = window.__chronicle;
      const before = { ...history.snapshots[index - 1], focus: 'market' }, after = { ...history.snapshots[index], focus: 'market' };
      replay.load({ label: history.label, snapshots: [before, after] });
      const first = window.__chronicleRenderPixels(); replay.seek(1); const grown = window.__chronicleRenderPixels();
      replay.seek(0); const restored = window.__chronicleRenderPixels(); replay.load(history); replay.seek(index);
      return { changed: first !== grown, restored: first === restored };
    }, marketIndex);
    if (!marketCheck.changed || !marketCheck.restored) throw new Error(`Market forward/backward rendering failed: ${JSON.stringify(marketCheck)}`);
    await draw();
    if (!await page.getByText('The market gained', { exact: false }).isVisible()) throw new Error('Market fact is missing');
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.defaultView.innerWidth)) throw new Error('Horizontal overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  const path = resolve(evidence, `chronicle-${view}@${width}x${height}.png`);
  await page.screenshot({ path });
  console.log(`Captured ${path}; forward and backward seeking changed and restored the accessible night and world image`);
} catch (error) {
  failure = error;
} finally {
  try { await browser?.close(); } catch (error) { cleanupErrors.push(error); }
  try { if (server && server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); } } catch (error) { cleanupErrors.push(error); }
  try { await release?.(); } catch (error) { cleanupErrors.push(error); }
}
if (failure && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'Capture and cleanup both failed');
if (failure) throw failure;
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Capture cleanup failed');
