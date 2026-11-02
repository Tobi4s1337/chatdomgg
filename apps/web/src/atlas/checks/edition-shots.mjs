/* global WheelEvent, PointerEvent, AbortSignal, requestAnimationFrame */
// Before and after an edition, the same views: a survey preview service and an edition service (a founded edition
// or a bench rehearsal) of the same revision, at the web and phone sizes plus one framed land.
//   ATLAS_BEFORE_URL=http://127.0.0.2:5172 ATLAS_AFTER_URL=http://127.0.0.2:5175 node apps/web/src/atlas/checks/edition-shots.mjs
import { chromium, request } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

// Without ATLAS_BEFORE_URL only the edition side is taken (a later look at the same views).
const sides = { ...(process.env.ATLAS_BEFORE_URL ? { before: process.env.ATLAS_BEFORE_URL } : {}), after: process.env.ATLAS_AFTER_URL };
if (!sides.after) throw new Error('ATLAS_AFTER_URL is required (ATLAS_BEFORE_URL too for a before/after pair).');
const out = process.env.ATLAS_SHOT_DIR ?? 'work/evidence/atlas-map';
const prefix = process.env.ATLAS_SHOT_PREFIX ?? 'am12';
const language = process.env.ATLAS_FRAME_LANGUAGE ?? 'de';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('[data-atlas-ready="map"]'), null, { timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => { const s = window.__chatdomAtlas?.stats(); return s && !s.flying && !s.gesture && s.tiles.uncovered === 0 && s.tiles.fading === 0; }, null, { timeout: 30000 });
}

async function frame(page, target) {
  await page.evaluate(async target => {
    const root = document.querySelector('.atlas-map');
    const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
    const before = window.__chatdomAtlas.stats().camera;
    root.dispatchEvent(new WheelEvent('wheel', { clientX: 720, clientY: 450, deltaY: -Math.log(target.scale / before.scale) / 0.011, ctrlKey: true, bubbles: true, cancelable: true }));
    await tick(); await tick();
    const camera = window.__chatdomAtlas.stats().camera;
    const dx = (camera.x - target.x) * camera.scale, dy = (camera.y - target.y) * camera.scale;
    const event = (type, x, y) => root.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 41, pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true }));
    event('pointerdown', 720, 450); event('pointermove', 720 + dx, 450 + dy); event('pointercancel', 720 + dx, 450 + dy);
    await tick(); await tick();
  }, target);
  await page.waitForFunction(() => { const s = window.__chatdomAtlas.stats(); return s && !s.flying && !s.gesture && s.tiles.uncovered === 0 && s.tiles.fading === 0; }, null, { timeout: 30000 });
  const actual = await page.evaluate(() => window.__chatdomAtlas.stats().camera);
  if (Math.abs(actual.x - target.x) > 2 || Math.abs(actual.y - target.y) > 2) throw new Error(`Camera did not frame ${language}: ${JSON.stringify({ actual, target })}`);
}

// One framed land for both sides: the edition's own geometry decides the camera, so the two shots match.
const api = await request.newContext();
const pointer = await (await api.get(`${sides.after}/map-data/v1/preview`)).json();
const world = await (await api.get(`${sides.after}${pointer.world.url}`)).json();
await api.dispose();
const region = world.regions.find(r => r.language === language);
if (!region) throw new Error(`No ${language} land in ${pointer.id}.`);
const scale = Math.min(2.1, 1000 / (2.4 * region.r / world.coordScale), 780 / (2.4 * region.r / world.coordScale));
const target = { x: region.x / world.coordScale, y: region.y / world.coordScale, scale };

const release = await acquireCaptureLock({ signal: AbortSignal.timeout(240000) });
const started = Date.now();
const evidence = { edition: pointer.edition ?? null, frame: { language, ...target }, shots: [] };
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  await mkdir(out, { recursive: true });
  for (const [side, base] of Object.entries(sides)) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/map`);
    await ready(page);
    const seal = await page.locator('.atlas-seal, [class*="seal"]').first().innerText().catch(() => '');
    await page.screenshot({ path: `${out}/${prefix}-${side}-1440.png` });
    await frame(page, target);
    await page.screenshot({ path: `${out}/${prefix}-${side}-${language}-1440.png` });
    await page.close();
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(`${base}/map`);
    await ready(phone);
    await phone.screenshot({ path: `${out}/${prefix}-${side}-390.png` });
    await phone.close();
    if (errors.length) throw new Error(`${side}: ${errors.join('; ')}`);
    evidence.shots.push({ side, seal: seal.replace(/\s+/g, ' ').trim(), files: [`${prefix}-${side}-1440.png`, `${prefix}-${side}-${language}-1440.png`, `${prefix}-${side}-390.png`] });
    console.log(`${side}: shots written; seal "${seal.replace(/\s+/g, ' ').trim()}"`);
  }
} finally {
  await browser?.close();
  await release();
}
evidence.lockHeldMs = Date.now() - started;
await writeFile(`${out}/${prefix}-edition-shots.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`PASS ${Object.keys(sides).join('/')} stills, lock held ${Math.round(evidence.lockHeldMs / 1000)} s`);
