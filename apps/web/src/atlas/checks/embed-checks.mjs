// Embed contract in real Chrome. Start the built preview and real Atlas service first:
// ATLAS_CHECK_URL=http://127.0.0.1:5178 node apps/web/src/atlas/checks/embed-checks.mjs
/* global EventTarget, history, AbortSignal, performance, scrollY */
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.1:5178';
const failures = [];
let checks = 0;
function check(name, condition, detail) {
  checks++;
  if (!condition) failures.push(name);
  console.log(`${condition ? 'ok' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const GPU = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];
const ready = page => page.waitForFunction(() => window.__atlasBench?.handle && document.querySelector('[data-atlas-ready]:not([data-atlas-ready="loading"])'), null, { timeout: 45000 });

async function instrument(page) {
  await page.addInitScript(() => {
    const counts = { history: 0, frames: new Set(), workers: new Set(), intervals: new Set(), timeouts: new Set(), listeners: new Set() };
    const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if ((this === window || this === document) && listener) {
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        if (!Array.from(counts.listeners).some(x => x.target === this && x.type === type && x.listener === listener && x.capture === capture)) {
          const record = { target: this, type, listener, capture };
          counts.listeners.add(record);
          if (typeof options === 'object' && options?.signal) nativeAdd.call(options.signal, 'abort', () => counts.listeners.delete(record), { once: true });
        }
      }
      return nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      for (const x of counts.listeners) if (x.target === this && x.type === type && x.listener === listener && x.capture === capture) counts.listeners.delete(x);
      return nativeRemove.call(this, type, listener, options);
    };
    const timeout = window.setTimeout, clearTimeoutNative = window.clearTimeout;
    window.setTimeout = (callback, delay, ...args) => {
      let id;
      id = timeout(() => { counts.timeouts.delete(id); if (typeof callback === 'function') callback(...args); else (0, eval)(callback); }, delay);
      counts.timeouts.add(id); return id;
    };
    window.clearTimeout = id => { counts.timeouts.delete(id); return clearTimeoutNative(id); };
    const interval = window.setInterval, clear = window.clearInterval;
    window.setInterval = (...args) => { const id = interval(...args); counts.intervals.add(id); return id; };
    window.clearInterval = id => { counts.intervals.delete(id); return clear(id); };
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) { counts.history++; return original.apply(this, args); };
    }
    const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = callback => {
      let id;
      id = raf.call(window, time => { counts.frames.delete(id); callback(time); });
      counts.frames.add(id);
      return id;
    };
    window.cancelAnimationFrame = id => { counts.frames.delete(id); return cancel.call(window, id); };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); counts.workers.add(this); }
      terminate() { counts.workers.delete(this); return super.terminate(); }
    };
    window.__embedCounts = counts;
  });
}

async function open(browser, mode, extra = '', mobile = false) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await instrument(page);
  await page.goto(`${base}/-/atlas-embed?mode=${mode}${extra}`, { waitUntil: 'domcontentloaded' });
  return { page, errors };
}

let release, browser;
try {
  release = await acquireCaptureLock({ signal: AbortSignal.timeout(60000) });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
  {
    // The bench imports only the entry when lazy=1; scene chunks and data must wait for mount.
    const { page } = await open(browser, 'hero', '&lazy=1');
    await page.waitForFunction(() => window.__atlasBench?.mount, null, { timeout: 15000 });
    await sleep(300);
    const unmounted = await page.evaluate(() => ({ roots: document.querySelectorAll('[data-chatdom-atlas]').length, intervals: window.__embedCounts.intervals.size, frames: window.__embedCounts.frames.size, resources: performance.getEntriesByType('resource').map(x => x.name) }));
    check('entry import is lazy before mount', unmounted.roots === 0 && !unmounted.resources.some(url => /\/map-data\/|\/scene[-.]/.test(url)), unmounted);
    // A synchronous dispose before the dynamic import resolves must never leave a late map behind.
    await page.evaluate(() => { const handle = window.__atlasBench.mount({ mode: 'hero' }); handle.dispose(); handle.dispose(); });
    await sleep(2000);
    const disposed = await page.evaluate(() => ({ roots: document.querySelectorAll('[data-chatdom-atlas]').length, workers: window.__embedCounts.workers.size, intervals: window.__embedCounts.intervals.size, frames: window.__embedCounts.frames.size }));
    check('dispose before asynchronous mount completes leaves no map or resources', disposed.roots === 0 && disposed.workers === 0 && disposed.intervals <= unmounted.intervals && disposed.frames <= unmounted.frames, { before: unmounted, after: disposed });
    await page.close();
  }
  {
    // A non-default base is routed to the same real local service, while two hosts have different sizes.
    const { page } = await open(browser, 'hero', '&lazy=1');
    const customRequests = [];
    await page.route('**/embed-check-data/**', async route => {
      const url = route.request().url();
      customRequests.push(url);
      await route.continue({ url: url.replace('/embed-check-data/', '/map-data/') });
    });
    await page.waitForFunction(() => window.__atlasBench?.mount);
    await sleep(500);
    const baseline = await page.evaluate(() => ({ listeners: window.__embedCounts.listeners.size, intervals: window.__embedCounts.intervals.size, timeouts: window.__embedCounts.timeouts.size, frames: window.__embedCounts.frames.size, workers: window.__embedCounts.workers.size }));
    await page.evaluate(() => {
      for (const [id, width, height] of [['embed-a', 520, 310], ['embed-b', 310, 220]]) {
        const el = document.createElement('div'); el.id = id; Object.assign(el.style, { width: `${width}px`, height: `${height}px` }); document.body.append(el);
      }
      window.__embedA = window.__atlasBench.mount({ mode: 'hero', base: '/embed-check-data' }, document.getElementById('embed-a'));
      window.__embedB = window.__atlasBench.mount({ mode: 'hero' }, document.getElementById('embed-b'));
    });
    const results = await Promise.race([page.evaluate(() => Promise.all([window.__embedA.ready, window.__embedB.ready])), sleep(45000).then(() => { throw new Error('two map readiness timed out'); })]);
    const sizes = await page.evaluate(() => ['embed-a', 'embed-b'].map(id => {
      const root = document.querySelector(`#${id} [data-chatdom-atlas]`), canvas = root?.querySelector('canvas');
      const rect = root?.getBoundingClientRect(), drawn = canvas?.getBoundingClientRect();
      return { root: rect && [rect.width, rect.height], canvas: drawn && [drawn.width, drawn.height] };
    }));
    check('custom base loads a coherent map from that base', customRequests.length > 0 && ['map', 'still'].includes(results[0]), { requests: customRequests.slice(0, 4), results });
    check('two maps render in their own differently sized hosts', results.every(x => ['map', 'still'].includes(x)) && JSON.stringify(sizes.map(x => x.root)) === JSON.stringify([[520, 310], [310, 220]]) && sizes.every(x => x.canvas && Math.abs(x.canvas[0] - x.root[0]) < 2 && Math.abs(x.canvas[1] - x.root[1]) < 2), sizes);
    await page.evaluate(() => window.__embedA.dispose());
    check('disposing one map leaves the other mounted', await page.evaluate(() => !document.querySelector('#embed-a [data-chatdom-atlas]') && !!document.querySelector('#embed-b [data-chatdom-atlas] canvas')));
    await page.evaluate(() => { window.__embedB.dispose(); window.__embedB.dispose(); });
    await sleep(2000);
    const after = await page.evaluate(() => ({ listeners: window.__embedCounts.listeners.size, listenerTypes: [...window.__embedCounts.listeners].map(x => x.type), intervals: window.__embedCounts.intervals.size, timeouts: window.__embedCounts.timeouts.size, frames: window.__embedCounts.frames.size, workers: window.__embedCounts.workers.size }));
    check('disposal releases global listeners, timers, frames and workers', Object.keys(baseline).every(key => after[key] <= baseline[key]), { baseline, after });
    await page.close();
  }
  {
    const { page } = await open(browser, 'hero', '&lazy=1');
    let releaseWorld, sawWorld;
    const worldSeen = new Promise(resolve => { sawWorld = resolve; });
    const hold = new Promise(resolve => { releaseWorld = resolve; });
    await page.route('**/map-data/v1/preview/*/world.json', async route => {
      sawWorld(); await hold; await route.continue().catch(() => {});
    });
    await page.waitForFunction(() => window.__atlasBench?.mount);
    const baseline = await page.evaluate(() => ({ listeners: window.__embedCounts.listeners.size, intervals: window.__embedCounts.intervals.size, timeouts: window.__embedCounts.timeouts.size, frames: window.__embedCounts.frames.size, workers: window.__embedCounts.workers.size }));
    await page.evaluate(() => { window.__atlasBench.mount({ mode: 'hero' }); });
    const observed = await Promise.race([worldSeen.then(() => true), sleep(20000).then(() => false)]);
    await page.evaluate(() => { window.__atlasBench.dispose(); window.__atlasBench.dispose(); });
    releaseWorld();
    await sleep(2000);
    const after = await page.evaluate(() => ({ roots: document.querySelectorAll('[data-chatdom-atlas]').length, listeners: window.__embedCounts.listeners.size, intervals: window.__embedCounts.intervals.size, timeouts: window.__embedCounts.timeouts.size, frames: window.__embedCounts.frames.size, workers: window.__embedCounts.workers.size }));
    check('dispose during world fetch cancels the late mount and releases resources', observed && after.roots === 0 && Object.keys(baseline).every(key => after[key] <= baseline[key]), { observed, baseline, after });
    await page.close();
  }
  {
    const { page, errors } = await open(browser, 'hero', '&lazy=1');
    await page.waitForFunction(() => window.__atlasBench?.mount);
    await page.evaluate(() => { window.__chatdomReady = 'host sentinel'; window.__atlasBench.mount({ mode: 'hero' }); });
    await ready(page);
    const state = await page.evaluate(async () => ({ ready: await window.__atlasBench.handle.ready, history: window.__embedCounts.history, global: window.__chatdomReady, root: document.querySelector('[data-chatdom-atlas]')?.dataset.atlasMode }));
    check('hero reaches a coherent map or still', ['map', 'still'].includes(state.ready) && state.root === 'hero', state);
    check('hero does not write history or set page-wide readiness', state.history === 0 && state.global === 'host sentinel', state);
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 0); });
    const box = await page.locator('[data-chatdom-atlas]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    await page.mouse.wheel(0, 450);
    await sleep(500);
    check('hero wheel scrolls its host page', await page.evaluate(() => scrollY > 0), { scrollY: await page.evaluate(() => scrollY) });
    const before = await page.evaluate(() => { window.__canvasBefore = document.querySelector('[data-chatdom-atlas] canvas'); window.__atlasBench.handle.setMode('explore'); return window.__canvasBefore !== null; });
    await sleep(300);
    check('setMode preserves the canvas', before && await page.evaluate(() => document.querySelector('[data-chatdom-atlas] canvas') === window.__canvasBefore && window.__atlasBench.handle.mode === 'explore'));
    await page.evaluate(() => { window.__atlasBench.dispose(); window.__atlasBench.dispose(); });
    await sleep(1000);
    const after = await page.evaluate(() => ({ roots: document.querySelectorAll('[data-chatdom-atlas]').length, canvases: document.querySelectorAll('canvas').length, frames: window.__embedCounts.frames.size, workers: window.__embedCounts.workers.size }));
    check('dispose is idempotent and removes its map and workers', after.roots === 0 && after.canvases === 0 && after.workers === 0, after);
    check('hero has no uncaught page errors', errors.length === 0, errors);
    await page.close();
  }
  {
    const { page, errors } = await open(browser, 'explore');
    await ready(page);
    await page.waitForFunction(() => document.querySelector('[data-atlas-ready="map"]'), null, { timeout: 45000 });
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 0); });
    const box = await page.locator('[data-chatdom-atlas]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    const before = await page.evaluate(() => window.__atlasBench.handle.view());
    await page.mouse.wheel(0, 400);
    await sleep(500);
    const first = await page.evaluate(() => ({ scroll: scrollY, view: window.__atlasBench.handle.view(), history: window.__embedCounts.history }));
    check('memory explore initially passes wheel to the page', first.scroll > 0 && Math.abs(first.view.scale - before.scale) < 1e-8, { before, first });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    const activated = await page.evaluate(() => window.__atlasBench.handle.view());
    await page.mouse.wheel(0, -300);
    await sleep(1000);
    const zoomed = await page.evaluate(() => ({ view: window.__atlasBench.handle.view(), history: window.__embedCounts.history }));
    check('memory explore wheel zooms after activation', Math.abs(zoomed.view.scale - activated.scale) > 1e-5, { activated, zoomed });
    check('memory explore never writes history', zoomed.history === 0, zoomed.history);
    check('explore has no uncaught page errors', errors.length === 0, errors);
    await page.close();
  }
  {
    const { page } = await open(browser, 'hero', '', true);
    await ready(page);
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 0); });
    const box = await page.locator('[data-chatdom-atlas]').boundingBox();
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + Math.min(box.height / 2, 400));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 25, id: 1 }] }); await sleep(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(600);
    check('hero one-finger gesture scrolls its host page', await page.evaluate(() => scrollY > 0), { scrollY: await page.evaluate(() => scrollY) });
    await page.close();
  }
} catch (error) {
  check('suite completes', false, String(error?.stack ?? error));
} finally {
  await browser?.close();
  await release?.();
  console.log(`${checks - failures.length}/${checks} checks passed`);
  if (failures.length) process.exitCode = 1;
}
