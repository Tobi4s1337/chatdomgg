import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { buildChroniclePreview, startChroniclePreview, captureCancellation } from './preview.mjs';

// One image per lock: the shared host must remain available to other lanes between captures.
const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const view = option('--view') ?? 'first', size = option('--size') ?? 'desktop';
if (!['first', 'latest', 'market'].includes(view) || !['desktop', 'phone'].includes(size)) throw new Error('Use --view first|latest|market --size desktop|phone');
const [width, height] = size === 'desktop' ? [1440, 900] : [390, 844];
const evidence = resolve(import.meta.dirname, 'evidence');
let server, browser, release, failure, buildDir;
const cleanupErrors = [];
let browserClosing;
const cancellation = captureCancellation(() => { if (browser) { browserClosing = browser.close(); browserClosing.catch(() => {}); } });
try {
  let base;
  buildDir = await buildChroniclePreview({ signal: cancellation.signal });
  ({ server, base, release } = await startChroniclePreview({ buildDir, signal: cancellation.signal }));
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  cancellation.signal.throwIfAborted();
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}src/chronicle/bench.html`, { waitUntil: 'commit', timeout: 120_000 });
  await page.waitForFunction(() => window.__chatdomReady === true || window.__chronicleError === true, null, { timeout: 240000 });
  if (await page.evaluate(() => window.__chronicleError === true)) throw new Error(`Chronicle failed to open: ${errors.join('\n')}`);
  await page.waitForFunction(() => window.__chronicleLightingReady(), null, { timeout: 120000 });
  const draw = async () => page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
  const slider = page.getByRole('slider', { name: 'Travel through the nights' });
  const origin = page.locator('.chronicle-origin');
  if (!await origin.isVisible() || !(await origin.innerText()).includes('SIMULATED')) throw new Error('Simulation label is missing');
  if (view === 'latest') { await slider.focus(); await page.keyboard.press('End'); await draw(); }
  if (view === 'market') {
    const marketIndex = await page.evaluate(() => window.__chronicleHistory.snapshots.findIndex(snapshot => snapshot.focus === 'market'));
    if (marketIndex < 1) throw new Error('Market construction snapshot is missing');
    await page.evaluate(index => window.__chronicle.seek(index), marketIndex);
    await draw();
    if (!await page.getByText('The market gained', { exact: false }).isVisible()) throw new Error('Market fact is missing');
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.defaultView.innerWidth)) throw new Error('Horizontal overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  const path = resolve(evidence, `chronicle-${view}@${width}x${height}.png`);
  await page.screenshot({ path, timeout: 120_000 });
  console.log(`Captured ${path}; seek and reversal checks run separately in watch-check.mjs`);
} catch (error) {
  failure = cancellation.signal.aborted && (error.name === 'AbortError' || error.name === 'TargetClosedError') ? cancellation.signal.reason : error;
} finally {
  try { await (browserClosing ?? browser?.close()); } catch (error) { cleanupErrors.push(error); }
  try { if (server && server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); } } catch (error) { cleanupErrors.push(error); }
  try { await release?.(); } catch (error) { cleanupErrors.push(error); }
  try { if (buildDir) await rm(buildDir, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
}
cancellation.dispose();
if (failure && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'Capture and cleanup both failed');
if (failure) throw failure;
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Capture cleanup failed');
