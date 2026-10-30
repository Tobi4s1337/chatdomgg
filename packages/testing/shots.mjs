import { chromium } from '@playwright/test';
import { acquireCaptureLock } from './capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';
import { mkdir } from 'node:fs/promises';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const external = option('--base-url');
let base = external;
const area = option('--area') ?? 'all';
if (!['all', 'foundation', 'kingdom', 'atlas'].includes(area)) throw new Error(`Unknown area: ${area}`);
// Targeted look checks keep the shared host lean; the default verify matrix is unchanged.
const tierFilter = option('--tier'), hourFilter = option('--hour'), sizeFilter = option('--size');
if (tierFilter && !['hamlet', 'town'].includes(tierFilter)) throw new Error('Expected --tier hamlet|town');
if (hourFilter && !['noon', 'dusk', 'night'].includes(hourFilter)) throw new Error('Expected --hour noon|dusk|night');
if (sizeFilter && !['desktop', 'phone'].includes(sizeFilter)) throw new Error('Expected --size desktop|phone');
const kingdomSizes = sizeFilter === 'desktop' ? [[1440, 900]] : sizeFilter === 'phone' ? [[390, 844]] : [[1440, 900], [390, 844]];
const hours = [['noon', 12], ['dusk', 19.5], ['night', 23]].filter(([label]) => !hourFilter || label === hourFilter);
let server, browser, release;
try {
  release = await acquireCaptureLock();
  if (!external) ({ server, base } = await startCapturePreview());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const capture = async (path, name, sizes, kingdom = false, tier = 'town') => {
    console.log(`Preparing ${name} (${sizes.map(([w, h]) => `${w}x${h}`).join(', ')})`);
    const page = await browser.newPage({ viewport: { width: sizes[0][0], height: sizes[0][1] } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${base}${path}?source=simulated&seed=willowmere&tier=${tier}&hour=12&time=30&camera=hero`);
    await page.waitForFunction(isKingdom => (window.__chatdomReady === true && (!isKingdom || (window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldUploads > 0 && window.__chatdomKingdom.stats.fieldSettled))) || !!document.querySelector('.kingdom-gate button'), kingdom, { timeout: 240_000 });
    if (await page.locator('.kingdom-gate button').count()) throw new Error(`${name}: kingdom error gate: ${await page.locator('.kingdom-gate').innerText()}${errors.length ? `\n${errors.join('\n')}` : ''}`);
    if (kingdom && await page.locator('[data-chatdom-kingdom]').count() !== 1) throw new Error('Kingdom screenshot requires the real kingdom root');
    if (area === 'atlas' && await page.locator('[data-chatdom-atlas]').count() !== 1) throw new Error('Atlas screenshot requires the real Atlas root');
    if (area === 'atlas') {
      const atlas = page.locator('[data-chatdom-atlas]');
      if (await atlas.getAttribute('data-state') !== 'ready' || !await atlas.getAttribute('data-preview') || !await atlas.getAttribute('data-revision')) throw new Error(`Atlas screenshot requires a drawn survey, not a failure state: ${await atlas.getAttribute('data-state')}`);
    }
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const [label, hour] of kingdom ? hours : [['', 0]]) {
        if (kingdom) {
          await page.evaluate(hour => window.__chatdomKingdom.hour(hour), hour);
          await page.waitForFunction(hour => Math.abs(window.__chatdomKingdom.stats.hour - hour) < 0.01 && window.__chatdomKingdom.stats.camera === 'hero', hour);
          await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
          await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
          const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
          const triangleLimit = width <= 390 ? 800_000 : 2_000_000;
          if (stats.drawCalls < 1 || stats.drawCalls > 120 || stats.triangles < 1 || stats.triangles > triangleLimit || stats.fieldBytes <= 0 || stats.fieldBytes > 12 * 1024 * 1024) throw new Error(`${name} ${width}x${height}: scene budget exceeded: ${JSON.stringify(stats)}`);
          if (!(await page.locator('.source-ribbon').innerText()).includes('SIMULATED')) throw new Error(`${name}: missing SIMULATED source`);
        }
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`${name} overflows viewport at ${width}x${height}`);
        if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
        const dir = `shots/${area === 'atlas' ? 'atlas' : kingdom ? 'kingdom' : 'foundation'}`;
        await mkdir(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${name}${label ? `-${label}` : ''}@${width}x${height}.png`, fullPage: false, timeout: 120_000 });
        console.log(`Captured ${dir}/${name}${label ? `-${label}` : ''}@${width}x${height}.png`);
      }
    }
    await page.close();
  };
  if (area === 'atlas') await capture('/map', 'atlas', [[1440, 900], [390, 844]]);
  else {
    for (const tier of tierFilter ? [tierFilter] : ['town', 'hamlet']) await capture('/', tier, kingdomSizes, true, tier);
    if (area !== 'kingdom') {
      await capture('/stream', 'stream', [[1920, 1080], [1280, 720]], true);
      await capture('/panel', 'panel', [[318, 496]]);
    }
  }
} finally {
  try { await browser?.close(); } finally {
    try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
  }
}
