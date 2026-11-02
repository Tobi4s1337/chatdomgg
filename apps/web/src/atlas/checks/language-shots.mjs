/* global WheelEvent, PointerEvent, AbortSignal, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.1:5175';
const out = 'work/evidence/atlas-map';
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60000) });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/map`);
  await page.waitForFunction(() => document.querySelector('[data-atlas-ready="map"]'), null, { timeout: 60000 }).catch(async error => {
    throw new Error(`${error.message}\nPage errors: ${errors.join('; ')}\nVisible state: ${await page.locator('body').innerText()}`);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/am10-language${process.env.ATLAS_LANGUAGE_CODES ? '-special' : ''}-map-1440.png` });
  const pointer = await (await page.request.get(`${base}/map-data/v1/preview`)).json();
  const world = await (await page.request.get(`${base}${pointer.world.url}`)).json();
  const requested = process.env.ATLAS_LANGUAGE_CODES?.split(',');
  const regions = world.regions.filter(region => region.language && (!requested || requested.includes(region.language))).sort((a, b) => b.members - a.members).slice(0, requested ? requested.length : 10);
  const evidence = [];
  for (const region of regions) {
    const scale = Math.min(2.1, 1000 / (2.4 * region.r / world.coordScale), 780 / (2.4 * region.r / world.coordScale));
    const target = { x: region.x / world.coordScale - 185 / scale, y: region.y / world.coordScale, scale };
    await page.evaluate(async target => {
      const root = document.querySelector('.atlas-map');
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const before = window.__chatdomAtlas.stats().camera;
      root.dispatchEvent(new WheelEvent('wheel', { clientX: 720, clientY: 450, deltaY: -Math.log(target.scale / before.scale) / 0.011, ctrlKey: true, bubbles: true, cancelable: true }));
      await frame(); await frame();
      const camera = window.__chatdomAtlas.stats().camera;
      const dx = (camera.x - target.x) * camera.scale, dy = (camera.y - target.y) * camera.scale;
      const event = (type, x, y) => root.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 41, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true }));
      event('pointerdown', 905, 450); event('pointermove', 905 + dx, 450 + dy); event('pointercancel', 905 + dx, 450 + dy);
      await frame(); await frame();
    }, target);
    await page.waitForFunction(() => { const s = window.__chatdomAtlas.stats(); return s && !s.flying && !s.gesture && s.tiles.uncovered === 0 && s.tiles.fading === 0; }, null, { timeout: 15000 });
    const actual = await page.evaluate(() => window.__chatdomAtlas.stats().camera);
    if (Math.abs(actual.x - target.x) > 2 || Math.abs(actual.y - target.y) > 2) throw new Error(`Camera did not frame ${region.language}: ${JSON.stringify({ actual, target })}`);
    const path = `${out}/am10-language-${region.language}-1440.png`;
    await page.screenshot({ path });
    evidence.push({ language: region.language, members: region.members, path });
    console.log(`Viewed frame ready for ${region.language}: ${region.members} holdings`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(`${out}/am10-language${requested ? '-special' : ''}-shots.json`, JSON.stringify({ preview: pointer.id, regions: evidence, pageErrors: errors }, null, 2) + '\n');
  await page.close();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await phone.goto(`${base}/map`);
  await phone.waitForFunction(() => document.querySelector('[data-atlas-ready="map"]'), null, { timeout: 60000 });
  await phone.screenshot({ path: `${out}/am10-language${requested ? '-special' : ''}-map-390.png` });
  console.log(`PASS ${regions.length} language lands and desktop/phone overview; no page errors`);
} finally { await browser?.close(); await release(); }
