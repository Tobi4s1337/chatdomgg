// Atlas motion, back/focus, context-loss and still checks in real Chrome, with the same SwiftShader launch as the
// repo shot script. Needs a built web app and `atlas:serve` on 5193 (see Spec 01 Acceptance). Run from the repo root:
//   node apps/web/src/atlas/checks/atlas-checks.mjs [--only laptop|phone|recovery|still]
// Writes shots/atlas/motion-*, sheet-*, context-* (incl. context-still), still@* and a JSON report to shots/atlas/checks.json.
// SwiftShader frame times say nothing about real devices: these checks judge positions, states and holes, not fps.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { startCapturePreview, closeCapturePreview } from '../../../../../packages/testing/preview.mjs';

const GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const OUT = 'shots/atlas';
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const report = { checks: [], failures: [] };

function check(name, ok, detail) {
  report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) report.failures.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stats = (page) => page.evaluate(() => window.__chatdomAtlas?.stats() ?? null);
const marks = (page) => page.evaluate(() => window.__chatdomAtlas?.marks(400) ?? []);
/** Pointer moves are delivered aligned to animation frames: let two frames pass before reading the camera. */
const frames = (page) => page.evaluate(() => new Promise((done) => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
const attr = (page, name) => page.locator('[data-chatdom-atlas]').getAttribute(name);
const toScreen = (s, view, x, y) => ({ x: (x - s.camera.x) * s.camera.scale + view.width / 2, y: (y - s.camera.y) * s.camera.scale + view.height / 2 });
const toWorld = (s, view, x, y) => ({ x: s.camera.x + (x - view.width / 2) / s.camera.scale, y: s.camera.y + (y - view.height / 2) / s.camera.scale });

/** Wait until nothing moves by itself (no flight, no coasting, no glide) and the land is complete. */
async function still(page, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await stats(page);
    if (s && !s.flying && !s.gesture && s.tiles.uncovered === 0 && s.tiles.fading === 0) return s;
    await sleep(120);
  }
  return stats(page);
}

async function open(browser, view, touch) {
  const page = await browser.newPage({ viewport: view, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/map`);
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

/** Screenshots taken while a move runs, tiled into one strip for the motion review. */
async function filmstrip(page, name, start, frames = 6, every = 260) {
  const paths = [];
  await start();
  for (let i = 0; i < frames; i++) {
    const path = `${OUT}/frames/${name}-${i}.png`;
    await page.screenshot({ path, timeout: 60_000 });
    paths.push(path);
    await sleep(every);
  }
  const target = `${OUT}/${name}.png`;
  await new Promise((resolve, reject) => execFile('ffmpeg', ['-y', '-loglevel', 'error', ...paths.flatMap((path) => ['-i', path]), '-filter_complex', `${paths.map((_, i) => `[${i}:v]scale=iw/2:-1[f${i}]`).join(';')};${paths.map((_, i) => `[f${i}]`).join('')}hstack=inputs=${paths.length}`, target], (error) => (error ? reject(error) : resolve())));
  return target;
}

async function laptop(browser) {
  const view = { width: 1440, height: 900 };
  const { page, errors } = await open(browser, view, false);
  let s = await still(page);
  check('laptop: first view complete with no uncovered tiles', s.tiles.uncovered === 0 && s.maxUncovered === 0, s.tiles);

  // Anchored wheel: three notches at one point keep the world point under the pointer.
  const point = { x: 1010, y: 430 };
  const anchor = toWorld(s, view, point.x, point.y);
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  s = await still(page);
  const held = toScreen(s, view, anchor.x, anchor.y);
  check('laptop: wheel zoom keeps the point under the pointer', Math.hypot(held.x - point.x, held.y - point.y) < 1.5, { held, scale: s.camera.scale });

  // A flick pans and coasts on after release, then stops.
  const before = s.camera;
  await page.mouse.move(700, 450);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(700 - i * 30, 450 - i * 6, { steps: 1 });
  await page.mouse.up();
  const coasting = (await stats(page)).gesture;
  s = await still(page);
  const travelled = Math.hypot(s.camera.x - before.x, s.camera.y - before.y) * s.camera.scale;
  check('laptop: a flick coasts beyond the drag and stops', travelled > 240 && !s.gesture, { travelled: Math.round(travelled), coastingAfterRelease: coasting });

  // The four distances: each notch flies to its band within three seconds.
  for (const distance of ['continent', 'realm', 'kingdom', 'world']) {
    const started = Date.now();
    await page.locator(`.atlas-notch[data-distance="${distance}"]`).click();
    s = await still(page);
    const took = Date.now() - started;
    check(`laptop: notch flies to ${distance} distance`, (await attr(page, 'data-distance')) === distance, { took, scale: s.camera.scale });
  }
  await mkdir(`${OUT}/frames`, { recursive: true });
  const strip = await filmstrip(page, 'motion-flight@1440x900', () => page.locator('.atlas-notch[data-distance="realm"]').click(), 7, 200);
  s = await still(page);
  check('laptop: no tile hole in any frame since the first view', s.maxUncovered === 0, { maxUncovered: s.maxUncovered, frames: s.frames, strip });
  check('laptop: overlay within budgets', s.overlay.shields <= 300, s.overlay);
  check('laptop: tile cache bounded', s.tiles.bytes <= 112 * 1024 * 1024, { tiles: s.tiles.tiles, mib: +(s.tiles.bytes / 2 ** 20).toFixed(1) });

  // A press interrupts a flight at once and the camera stays where it was.
  await page.keyboard.press('Escape');
  await page.locator('.atlas-map').focus();
  await page.keyboard.press('1');
  await sleep(500);
  await page.mouse.move(720, 450);
  await page.mouse.down();
  const interrupted = await stats(page);
  await sleep(400);
  const after = await stats(page);
  await page.mouse.up();
  check('laptop: a press stops a flight in place', !interrupted.flying && Math.abs(after.camera.scale - interrupted.camera.scale) < 1e-9, { scale: after.camera.scale });
  await page.keyboard.press('3');
  await still(page);

  // A holding under where the card will open: choosing it moves the map so the card does not cover it.
  const right = (await marks(page)).filter((mark) => mark.x > view.width - 360 && mark.x < view.width - 60 && mark.y > 120 && mark.y < view.height - 140);
  if (!right.length) check('laptop: found a mark under the card side', false);
  else {
    const mark = right[0];
    const settled = await stats(page);
    const beforeCard = settled.camera;
    const nearBy = (list) => list.filter((item) => Math.hypot(item.x - mark.x, item.y - mark.y) < 40).map((item) => `${item.name}@${Math.round(item.x)},${Math.round(item.y)}`);
    const nearBefore = nearBy(await marks(page));
    await page.mouse.move(mark.x, mark.y);
    await sleep(300);
    const nearHover = nearBy(await marks(page));
    await page.mouse.click(mark.x, mark.y);
    await page.locator('.atlas-card').waitFor();
    const after = await still(page);
    const moved = (await marks(page)).find((item) => item.id === mark.id);
    const card = await page.locator('.atlas-card').boundingBox();
    const heading = await page.locator('.atlas-card h2').textContent();
    check('laptop: chosen mark is kept clear of the card', !!moved && moved.x < card.x - 40, {
      mark: moved && { x: Math.round(moved.x), y: Math.round(moved.y) }, from: { x: Math.round(mark.x), y: Math.round(mark.y), name: mark.name },
      card: heading, nearBefore, nearHover, cardLeft: Math.round(card.x), settledBefore: !settled.flying && !settled.gesture, settledAfter: !after.flying && !after.gesture,
    });
    await page.screenshot({ path: `${OUT}/motion-card@1440x900.png` });

    // Back closes the card and returns the camera to the view before it.
    await page.goBack();
    await page.locator('.atlas-card').waitFor({ state: 'detached' });
    s = await still(page);
    const back = s.camera;
    check('laptop: Back closes the card and restores the view', Math.abs(back.x - beforeCard.x) * back.scale < 1 && Math.abs(back.y - beforeCard.y) * back.scale < 1 && Math.abs(back.scale / beforeCard.scale - 1) < 1e-6, { back, beforeCard });
    check('laptop: Back stayed on the map', new URL(page.url()).pathname === '/map');

    // Escape closes and puts focus back on the map; the next Back is the page's, not a stale card entry.
    // A mark in open paper, clear of the cartouche and key on the left and of the controls.
    const again = (await marks(page)).find((mark) => mark.x > 420 && mark.x < 1000 && mark.y > 120 && mark.y < 780);
    await page.mouse.click(again.x, again.y);
    await page.locator('.atlas-card').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.atlas-card').waitFor({ state: 'detached' });
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    check('laptop: Escape closes the card and focus returns to the map', focused.includes('atlas-map'), { focused });
    const entries = await page.evaluate(() => window.history.state?.chatdomAtlas ?? null);
    check('laptop: no card entry is left in history after Escape', entries === null, { state: entries });
  }

  // Context loss with recovery: the same camera and selection, and a drawn map afterwards.
  const chosen = (await marks(page)).find((mark) => mark.x > 420 && mark.x < 1000 && mark.y > 120 && mark.y < 780);
  await page.mouse.click(chosen.x, chosen.y);
  await page.locator('.atlas-card').waitFor();
  s = await still(page);
  const saved = s.camera;
  await page.evaluate(() => {
    const canvas = document.querySelector('.atlas-map canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    window.__atlasLose = gl.getExtension('WEBGL_lose_context');
    window.__atlasLose.loseContext();
  });
  await page.waitForFunction(() => document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-context') === 'lost');
  await page.screenshot({ path: `${OUT}/context-lost@1440x900.png` });
  await page.evaluate(() => window.__atlasLose.restoreContext());
  await page.waitForFunction(() => document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-context') === 'ok');
  s = await still(page);
  await sleep(600);
  await page.screenshot({ path: `${OUT}/context-restored@1440x900.png` });
  check('laptop: context restored keeps camera and selection', Math.abs(s.camera.x - saved.x) < 1e-9 && Math.abs(s.camera.scale - saved.scale) < 1e-9 && (await page.locator('.atlas-card').count()) === 1, { losses: s.contextLosses });

  // Context loss with no recovery: the map is rebuilt from the same view on a new canvas.
  await page.evaluate(() => {
    const canvas = document.querySelector('.atlas-map canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  await page.waitForFunction(() => document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-context') === 'lost');
  await page.waitForFunction(() => document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-context') === 'ok', null, { timeout: 60_000 });
  s = await still(page);
  await sleep(600);
  await page.screenshot({ path: `${OUT}/context-rebuilt@1440x900.png` });
  const canvases = await page.locator('.atlas-map canvas').count();
  check('laptop: a context that never returns is rebuilt in place', canvases === 1 && Math.abs(s.camera.x - saved.x) < 1e-6 && Math.abs(s.camera.scale - saved.scale) < 1e-6 && s.contextLosses === 0 && (await page.locator('.atlas-card').count()) === 1, { canvases, camera: s.camera });

  // A resize during a flight lands it with the new size, nothing left moving.
  await page.keyboard.press('Escape');
  await page.locator('.atlas-map').focus();
  await page.keyboard.press('1');
  await sleep(300);
  await page.setViewportSize({ width: 1100, height: 760 });
  s = await still(page);
  check('laptop: resize mid-flight still lands at world distance', (await attr(page, 'data-distance')) === 'world' && !s.flying, { scale: s.camera.scale });
  check('laptop: no page errors', errors.length === 0, errors.slice(0, 5));
  await page.close();
}

/** Recovery: a reload on a card's history entry, and a lost context that no new canvas can replace. */
async function recovery(browser) {
  const view = { width: 1440, height: 900 };
  const { page, errors } = await open(browser, view, false);
  await still(page);
  const pick = async () => (await marks(page)).find((mark) => mark.x > 420 && mark.x < 1000 && mark.y > 120 && mark.y < 780);

  // Reload with a card open (R22): a card with a route reopens from it, and Back then closes it onto the map; a card
  // without one (a lapsed name) cannot reopen, so the page steps over its stale entry and the first Back leaves.
  await page.goto('about:blank');
  await page.goto(`${base}/map`);
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
  await still(page);
  let chosen = await pick();
  await page.mouse.click(chosen.x, chosen.y);
  await page.locator('.atlas-card').waitFor();
  const routed = new URL(page.url()).pathname !== '/map';
  const heading = (await page.locator('.atlas-card h2').textContent())?.trim();
  await page.reload();
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
  if (routed) {
    await page.locator('.atlas-card').waitFor({ timeout: 30_000 }).catch(() => undefined);
    const again = (await page.locator('.atlas-card h2').textContent().catch(() => null))?.trim();
    check('recovery: a reload on a card’s route reopens that card', again === heading, { heading, again });
    await page.goBack();
    await page.locator('.atlas-card').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    check('recovery: Back after the reload closes the card onto the map', new URL(page.url()).pathname === '/map' && (await page.locator('.atlas-card').count()) === 0, { url: page.url() });
  } else {
    await page.waitForFunction(() => window.history.state?.chatdomAtlas === undefined, null, { timeout: 5_000 }).catch(() => undefined);
  }
  await page.goBack();
  check('recovery: after a reload on a card entry, the next Back leaves the map', page.url() === 'about:blank', { url: page.url(), routed });
  await page.goForward();
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
  await still(page);

  // A context that never returns, and no new one to be had: the still takes over with the card kept.
  chosen = await pick();
  await page.mouse.click(chosen.x, chosen.y);
  await page.locator('.atlas-card').waitFor();
  const name = await page.locator('.atlas-card h2').textContent();
  await page.evaluate(() => {
    const canvas = document.querySelector('.atlas-map canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const native = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return /webgl|webgpu/.test(String(kind)) && this !== canvas ? null : native.call(this, kind, ...rest);
    };
    Object.defineProperty(window.navigator, 'gpu', { value: undefined, configurable: true });
    gl.getExtension('WEBGL_lose_context').loseContext();
  });
  const fellBack = await page.waitForFunction(() => document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-state') === 'still', null, { timeout: 60_000 }).then(() => true, () => false);
  if (fellBack) await page.waitForFunction(() => document.querySelector('[data-still-marks]') !== null, null, { timeout: 120_000 });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/context-still@1440x900.png` });
  const kept = await page.locator('.atlas-card h2').textContent().catch(() => null);
  const redrawing = await page.locator('.atlas-redraw').count();
  check('recovery: a rebuild with no new context falls back to the still, card kept', fellBack && kept === name && redrawing === 0, { fellBack, kept, redrawing });
  const pageErrors = errors.filter((error) => !/webgl|webgpu|context/i.test(error));
  check('recovery: no page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
  await page.close();
}

/** Two touch points through the DevTools protocol: Playwright has no multi-touch API. */
async function touches(cdp, type, points) {
  // Points are [x, y, id]. touchStart and touchMove name the fingers down; touchEnd names the fingers that lift.
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
}

async function phone(browser) {
  const view = { width: 390, height: 844 };
  const { page, errors } = await open(browser, view, true);
  const cdp = await page.context().newCDPSession(page);
  let s = await still(page);
  check('phone: first view complete', s.tiles.uncovered === 0, s.tiles);

  // Pinch: the world point under the first centroid follows the centroid while the fingers spread.
  const anchor = toWorld(s, view, 195, 470);
  await touches(cdp, 'touchStart', [[160, 470, 0]]);
  await touches(cdp, 'touchStart', [[160, 470, 0], [230, 470, 1]]);
  for (let i = 1; i <= 10; i++) {
    await touches(cdp, 'touchMove', [[160 - i * 7, 470 + i * 3, 0], [230 + i * 7, 470 + i * 3, 1]]);
  }
  await frames(page);
  s = await stats(page);
  const pinched = toScreen(s, view, anchor.x, anchor.y);
  check('phone: pinch keeps the world point under the fingers', Math.hypot(pinched.x - 195, pinched.y - 500) < 2, { at: pinched, scale: s.camera.scale });

  // One finger lifts: the other pans on from where it is, without a jump.
  const handover = s.camera;
  // The left finger (id 0, at 90,500) lifts; the right one (id 1, at 300,500) stays down and then pans.
  await touches(cdp, 'touchEnd', [[90, 500, 0]]);
  await frames(page);
  const lifted = await stats(page);
  const grabbed = toWorld(lifted, view, 300, 500);
  await touches(cdp, 'touchMove', [[280, 520, 1]]);
  await touches(cdp, 'touchMove', [[260, 540, 1]]);
  await frames(page);
  s = await stats(page);
  const followed = toScreen(s, view, grabbed.x, grabbed.y);
  check('phone: pinch hands over to a one-finger pan without a jump', Math.abs(lifted.camera.x - handover.x) < 1e-9 && Math.hypot(followed.x - 260, followed.y - 540) < 2, { followed });
  await touches(cdp, 'touchEnd', [[260, 540, 1]]);
  await still(page);

  // Realm distance, then a tap on a mark low on the screen: the sheet opens and the mark rises above it.
  await page.locator('.atlas-notch[data-distance="realm"]').tap();
  await still(page);
  const low = (await marks(page)).filter((mark) => mark.y > view.height * 0.62 && mark.y < view.height - 80 && mark.x > 40 && mark.x < view.width - 60);
  if (!low.length) check('phone: found a mark low on the screen', false, { distance: await attr(page, 'data-distance'), marks: (await marks(page)).length });
  else {
    await page.touchscreen.tap(low[0].x, low[0].y);
    await page.locator('.atlas-card').waitFor();
    await still(page);
    const sheet = await page.locator('.atlas-card').boundingBox();
    const moved = (await marks(page)).find((item) => item.id === low[0].id);
    check('phone: chosen mark stays above the bottom sheet', !!moved && moved.y < sheet.y - 30, { mark: moved && Math.round(moved.y), sheetTop: Math.round(sheet.y) });
    await page.screenshot({ path: `${OUT}/sheet@390x844.png` });
    await page.goBack();
    await page.locator('.atlas-card').waitFor({ state: 'detached' });
    await still(page);
  }
  await mkdir(`${OUT}/frames`, { recursive: true });
  const strip = await filmstrip(page, 'motion-flight@390x844', () => page.locator('.atlas-notch[data-distance="world"]').tap(), 6, 220);
  s = await still(page);
  check('phone: no tile hole in any frame since the first view', s.maxUncovered === 0, { maxUncovered: s.maxUncovered, strip });
  check('phone: tile cache bounded', s.tiles.bytes <= 48 * 1024 * 1024, { tiles: s.tiles.tiles, mib: +(s.tiles.bytes / 2 ** 20).toFixed(1) });
  check('phone: no page errors', errors.length === 0, errors.slice(0, 5));
  await page.close();
}

async function stillChecks() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-3d-apis', '--no-sandbox'] });
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/map`);
      await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000 });
      await page.evaluate(() => document.fonts.ready);
      const state = await attr(page, 'data-state');
      const revision = await attr(page, 'data-revision');
      check(`still ${width}x${height}: drawn as a dated still of the survey`, state === 'still' && !!revision, { state, revision });
      // A held live frame on the page is drawn on the still too: its washes, and its time on the ribbon.
      const held = await attr(page, 'data-live-as-of');
      if (held) await page.locator('.atlas-still-ribbon-live').waitFor({ timeout: 30_000 }).catch(() => undefined);
      const ribbonLive = await page.locator('.atlas-still-ribbon-live').count();
      check(`still ${width}x${height}: carries the page's live frame`, !held || ribbonLive === 1, { held, ribbonLive });
      await sleep(400);
      await page.screenshot({ path: `${OUT}/still@${width}x${height}.png` });
      const buttons = page.locator('.atlas-still button[data-settler]');
      const count = await buttons.count();
      check(`still ${width}x${height}: holdings are buttons`, count > 10, { count });
      if (count) {
        const first = buttons.first();
        await first.focus();
        await page.keyboard.press('Enter');
        await page.locator('.atlas-card').waitFor();
        await sleep(400);
        await page.screenshot({ path: `${OUT}/still-card@${width}x${height}.png` });
        await page.keyboard.press('Escape');
        await page.locator('.atlas-card').waitFor({ state: 'detached' });
        const back = await page.evaluate(() => document.activeElement?.getAttribute('data-settler'));
        check(`still ${width}x${height}: card opens from the keyboard and Escape returns focus`, !!back, { back });
      }
      check(`still ${width}x${height}: no page errors`, errors.length === 0, errors.slice(0, 5));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

let server;
let base;
let browser;
try {
  ({ server, base } = await startCapturePreview());
  await mkdir(OUT, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
  if (!only || only === 'laptop') await laptop(browser);
  if (!only || only === 'phone') await phone(browser);
  if (!only || only === 'recovery') await recovery(browser);
  if (!only || only === 'still') await stillChecks();
} catch (error) {
  check('suite ran to the end', false, String(error?.stack ?? error).slice(0, 600));
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await writeFile(`${OUT}/checks.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.checks.length - report.failures.length}/${report.checks.length} checks passed`);
  process.exitCode = report.failures.length ? 1 : 0;
}
