// The panel and stream lane's browser review. Captures every surface at its real size,
// exercises the interactions that matter and fails on overflow, page errors or a
// payload over budget. Build first (`pnpm build`), then:
//
//   node apps/panel/scripts/look.mjs [--base-url http://127.0.0.1:5190] [--panel-url http://127.0.0.1:5195/nested/]
//                                    [--only <name prefix>]
//
// Without --base-url it serves this checkout's apps/web build on a free port. Without
// --panel-url it serves apps/panel/dist under a nested, versioned path, the way
// Twitch's CDN serves an Extension zip, so relative assets are really exercised.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = option('--only');
const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const out = resolve(root, '../../shots/panel-stream');
const NESTED = '/ext-look/0.0.1/b7e1c0/';
const PAYLOAD_LIMIT = 1024 * 1024;

const HELPER = 'https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js';
// Test doubles for the Twitch Helper. They live only in this review script: one is a
// plain browser (no Helper), the other a logged-in viewer whose panel Twitch authorized.
const NO_HELPER = '';
const AUTHORIZED_HELPER = `window.Twitch={ext:{onAuthorized(cb){setTimeout(()=>cb({channelId:'1',clientId:'look',token:'look-token',helixToken:'look-helix',userId:'ULOOK'}),40)},onContext(){},onVisibilityChanged(){},viewer:{isLinked:false,role:'viewer',onChanged(){}},actions:{requestIdShare(){}}}};`;

async function budget() {
  let bytes = 0;
  const files = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else { bytes += (await stat(path)).size; files.push(path); }
    }
  };
  await walk(dist);
  for (const file of files.filter(f => f.endsWith('.js'))) {
    const text = await readFile(file, 'utf8');
    if (/WebGLRenderer|three\.module|REVISION\s*=\s*["']\d+/.test(text)) throw new Error(`three.js reached the panel bundle: ${file}`);
  }
  if (bytes > PAYLOAD_LIMIT) throw new Error(`Panel payload ${bytes} B exceeds ${PAYLOAD_LIMIT} B`);
  console.log(`Panel payload: ${(bytes / 1024).toFixed(1)} KB in ${files.length} files, no three.js`);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
function serveNested() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (!path.startsWith(NESTED)) { response.writeHead(404).end(); return; }
    const file = normalize(join(dist, path.slice(NESTED.length)));
    if (!file.startsWith(dist)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

let web, panelServer, browser, release;
const failures = [];
try {
  await budget();
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server: web, base } = await startCapturePreview());
  let panelBase = option('--panel-url');
  if (!panelBase) { panelServer = await serveNested(); panelBase = `http://127.0.0.1:${panelServer.address().port}${NESTED}`; }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });

  const open = async ({ url, width, height, helper = NO_HELPER }) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });
    await page.route(HELPER, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: helper }));
    await page.goto(url);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, missing };
  };
  const check = async (name, { page, errors, missing }) => {
    const { width, height } = page.viewportSize();
    const layout = await page.evaluate(() => {
      const scroller = document.scrollingElement;
      const clipped = [...document.querySelectorAll('.cp-light-words strong, .cp-choice strong, .cp-tab span, .cp-back span, .cp-tag')]
        .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent);
      const outside = [...document.querySelectorAll('.cp *')].filter(el => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > window.innerWidth + 0.5 || box.left < -0.5) && !el.closest('.cp-defs, .cp-shutters');
      }).map(el => el.className.baseVal ?? el.className);
      return { scrollW: scroller.scrollWidth, scrollH: scroller.scrollHeight, clipped, outside: outside.slice(0, 5) };
    });
    const isConfig = await page.locator('[data-chatdom-panel-config]').count() > 0;
    if (layout.scrollW > width) failures.push(`${name}: page scrolls horizontally (${layout.scrollW} > ${width})`);
    if (!isConfig && layout.scrollH > height) failures.push(`${name}: page scrolls vertically (${layout.scrollH} > ${height})`);
    if (layout.clipped.length) failures.push(`${name}: clipped text ${JSON.stringify(layout.clipped)}`);
    if (layout.outside.length) failures.push(`${name}: elements outside the frame ${JSON.stringify(layout.outside)}`);
    if (errors.length) failures.push(`${name}: ${errors.join(' | ')}`);
    if (missing.length) failures.push(`${name}: ${missing.join(' | ')}`);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    const path = join(out, `${name}@${width}x${height}.png`);
    // Finished transitions: a capture shows the settled state, not a tab halfway through its fade.
    await page.screenshot({ path, animations: 'disabled' });
    console.log(`Captured ${path}`);
  };
  const expect = async (page, name, selector, attribute, value) => {
    const actual = await page.locator(selector).first().getAttribute(attribute);
    if (actual !== value) failures.push(`${name}: expected ${selector} ${attribute}=${value}, got ${actual}`);
  };

  // The stream view: the real renderer under SwiftShader, so each construction is slow.
  // Fixed `time` keeps captures deterministic; `hour=19.5` is the dusk the stage is made for.
  const STREAM = 'source=simulated&seed=willowmere&tier=town&hour=19.5&time=30';
  const streamReady = page => page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready
    && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 400_000 });
  const openStream = async ({ path, width, height, wait = true, init, tolerate = /$^/ }) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [], missing = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !tolerate.test(message.text())) errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400 && !tolerate.test(response.url())) missing.push(`${response.status()} ${response.url()}`); });
    if (init) await page.addInitScript(init);
    await page.goto(`${base}${path}`);
    if (wait) await streamReady(page);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, missing };
  };
  const stream = async (page, key) => page.evaluate(key => {
    const s = window.__chatdomStream;
    return key === 'stats' ? { ...s.stats, phase: s.phase, layout: s.layout, source: s.source, canvases: document.querySelectorAll('.stream-canvas').length, ready: window.__chatdomReady === true, handle: !!window.__chatdomKingdom } : s[key];
  }, key);
  const checkStream = async (name, { page, errors, missing }, { clean = true } = {}) => {
    const { width, height } = page.viewportSize();
    const found = await page.evaluate(() => {
      const output = document.querySelector('[data-chatdom-stream]');
      const visible = el => { const box = el.getBoundingClientRect(), style = window.getComputedStyle(el); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'; };
      const curtain = document.querySelector('.stream-curtain');
      const words = [...output.querySelectorAll('.stream-signature, .stream-mark, .stream-curtain')].filter(el => visible(el) && !(el === curtain && curtain.classList.contains('open'))).map(el => el.innerText).join(' ');
      return {
        scrollW: document.scrollingElement.scrollWidth, scrollH: document.scrollingElement.scrollHeight,
        controls: document.querySelectorAll('.stream-bench, .stream-output button:not(.stream-gate button)').length,
        roots: document.querySelectorAll('[data-chatdom-kingdom]').length, words,
      };
    });
    if (found.roots !== 1) failures.push(`${name}: expected one kingdom root, found ${found.roots}`);
    if (found.scrollW > width || found.scrollH > height) failures.push(`${name}: page scrolls (${found.scrollW}x${found.scrollH})`);
    if (clean && found.controls) failures.push(`${name}: preview controls in the output`);
    // No viewer, light or seat counts and no debug numbers ever reach a broadcast frame.
    if (/\d/.test(found.words)) failures.push(`${name}: numbers on stream: "${found.words}"`);
    if (errors.length) failures.push(`${name}: ${errors.join(' | ')}`);
    if (missing.length) failures.push(`${name}: ${missing.join(' | ')}`);
    const path = join(out, `${name}@${width}x${height}.png`);
    await page.screenshot({ path, animations: 'disabled', timeout: 120_000 });
    console.log(`Captured ${path}`);
    return found;
  };
  const simulatedMark = async (page, name) => {
    const text = await page.locator('.source-ribbon').innerText().catch(() => '');
    if (!text.includes('SIMULATED')) failures.push(`${name}: fixture output lost its SIMULATED mark ("${text}")`);
  };
  const streamCases = [
    ['stream-stage', async () => {
      const view = await openStream({ path: `/stream?${STREAM}`, width: 1920, height: 1080 });
      await expect(view.page, 'stream-stage', '[data-chatdom-stream]', 'data-layout', 'stage');
      await simulatedMark(view.page, 'stream-stage');
      await checkStream('stream-stage', view);
      await view.page.setViewportSize({ width: 1280, height: 720 });
      await view.page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
      await streamReady(view.page);
      await view.page.waitForTimeout(1500);
      await checkStream('stream-stage', view);
      await view.page.close();
    }],
    ['stream-window', async () => {
      const view = await openStream({ path: `/stream?${STREAM}&layout=window`, width: 480, height: 270 });
      await simulatedMark(view.page, 'stream-window');
      if ((await stream(view.page, 'stats')).handle && await view.page.evaluate(() => window.__chatdomKingdom.stats.camera) !== 'window') failures.push('stream-window: the corner must hold the window shot');
      await checkStream('stream-window', view);
      await view.page.close();
    }],
    ['stream-strip', async () => {
      const view = await openStream({ path: `/stream?${STREAM}&layout=strip`, width: 1280, height: 180 });
      await simulatedMark(view.page, 'stream-strip');
      await checkStream('stream-strip', view);
      await view.page.close();
    }],
    // The curtain while the renderer builds: the kingdom's name and crest, never a blank source.
    ['stream-waking', async () => {
      const view = await openStream({ path: `/stream?${STREAM}`, width: 1280, height: 720, wait: false });
      await view.page.waitForTimeout(1500);
      if (await stream(view.page, 'phase') !== 'waking') failures.push('stream-waking: expected the waking curtain');
      if (await view.page.evaluate(() => window.__chatdomReady === true)) failures.push('stream-waking: ready before the renderer');
      await checkStream('stream-waking', view);
      await view.page.close();
    }],
    // The real source with no kingdom service behind it: the town stands, unlit, and says so.
    ['stream-live-lost', async () => {
      const view = await openStream({ path: '/stream?seed=willowmere&tier=town&hour=19.5&time=30', width: 1280, height: 720, tolerate: /presence-data|EventSource|Failed to load resource/ });
      await view.page.waitForFunction(() => window.__chatdomStream.source === 'lost', null, { timeout: 60_000 });
      if (await view.page.locator('.source-ribbon').innerText().then(text => text.includes('SIMULATED'))) failures.push('stream-live-lost: a real source must never say SIMULATED');
      await checkStream('stream-live-lost', view);
      await view.page.close();
    }],
    // WebGL refused: a calm gate that is never reported ready, then a retry that opens the town.
    ['stream-failed', async () => {
      const refuse = () => {
        const real = window.HTMLCanvasElement.prototype.getContext;
        window.__refuseWebgl = true;
        window.HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return window.__refuseWebgl && /webgl/.test(kind) ? null : real.call(this, kind, ...rest); };
      };
      const view = await openStream({ path: `/stream?${STREAM}&layout=window`, width: 480, height: 270, wait: false, init: refuse, tolerate: /WebGL|could not open|THREE/ });
      await view.page.waitForSelector('[data-phase=failed] .kingdom-gate button', { timeout: 60_000 });
      if (await view.page.evaluate(() => window.__chatdomReady === true)) failures.push('stream-failed: a failure gate reported ready');
      await checkStream('stream-failed', view, { clean: false });
      await view.page.setViewportSize({ width: 1280, height: 720 });
      await checkStream('stream-failed', view, { clean: false });
      await view.page.evaluate(() => { window.__refuseWebgl = false; });
      await view.page.locator('.kingdom-gate button').click();
      await streamReady(view.page);
      const stats = await stream(view.page, 'stats');
      if (stats.alive !== 1 || stats.canvases !== 1) failures.push(`stream-failed: retry left ${JSON.stringify(stats)}`);
      await view.page.close();
    }],
    // Hide during construction and after readiness, through OBS's event and the document's.
    ['stream-visibility', async () => {
      const view = await openStream({ path: `/stream?${STREAM}&layout=window`, width: 480, height: 270, wait: false });
      const { page } = view;
      const obs = visible => page.evaluate(visible => window.dispatchEvent(new window.CustomEvent('obsSourceVisibleChanged', { detail: { visible } })), visible);
      const documentVisible = visible => page.evaluate(visible => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
        document.dispatchEvent(new window.Event('visibilitychange'));
      }, visible);
      const expectStats = async (step, wanted) => {
        const stats = await stream(page, 'stats');
        for (const [key, value] of Object.entries(wanted)) if (stats[key] !== value) failures.push(`stream-visibility ${step}: ${key}=${stats[key]}, expected ${value} (${JSON.stringify(stats)})`);
      };
      await page.waitForTimeout(800);
      await obs(false);
      await expectStats('hidden while building', { phase: 'hidden', mounts: 1, alive: 0, cancelled: 1, canvases: 0, ready: false, handle: false });
      await page.waitForTimeout(1500);
      await obs(true);
      await expectStats('shown again', { mounts: 2, alive: 1, canvases: 1 });
      await streamReady(page);
      await expectStats('ready', { phase: 'ready', alive: 1, canvases: 1, ready: true, handle: true, source: 'simulated' });
      await documentVisible(false);
      await expectStats('hidden after ready', { phase: 'hidden', alive: 0, disposed: 2, canvases: 0, ready: false, handle: false });
      await documentVisible(true);
      await streamReady(page);
      await expectStats('reconstructed', { phase: 'ready', mounts: 3, alive: 1, disposed: 2, canvases: 1, ready: true, source: 'simulated' });
      await simulatedMark(page, 'stream-visibility');
      await checkStream('stream-visibility', view);
      await page.close();
    }],
    // The local preview: controls beside the frame, and the selection survives a hidden source.
    ['stream-preview', async () => {
      const view = await openStream({ path: `/stream?${STREAM}&preview=1`, width: 1440, height: 900 });
      await checkStream('stream-preview-stage', view, { clean: false });
      await view.page.locator('.stream-bench-layouts button', { hasText: 'Corner window' }).click();
      await view.page.evaluate(() => window.dispatchEvent(new window.CustomEvent('obsSourceVisibleChanged', { detail: { visible: false } })));
      await view.page.evaluate(() => window.dispatchEvent(new window.CustomEvent('obsSourceVisibleChanged', { detail: { visible: true } })));
      await streamReady(view.page);
      await expect(view.page, 'stream-preview', '[data-chatdom-stream]', 'data-layout', 'window');
      if (await view.page.evaluate(() => window.__chatdomKingdom.stats.camera) !== 'window') failures.push('stream-preview: the remounted scene lost the chosen window shot');
      await checkStream('stream-preview-window', view, { clean: false });
      await view.page.locator('.stream-bench-layouts button', { hasText: 'Bottom street' }).click();
      await view.page.waitForTimeout(2500);
      await checkStream('stream-preview-strip', view, { clean: false });
      await view.page.close();
    }],
  ];

  const cases = [
    ...streamCases,
    // The hero: the simulated night, mounted in the web app.
    ['panel-hero', async () => {
      const view = await open({ url: `${base}/panel?source=simulated`, width: 318, height: 496 });
      await expect(view.page, 'panel-hero', '[data-chatdom-panel]', 'data-view', 'kingdom');
      if (!(await view.page.locator('.cp-tag.simulated').innerText()).toUpperCase().includes('SIMULATED')) failures.push('panel-hero: SIMULATED mark missing');
      await check('panel-hero', view);
      // Light the window with a name: choice, pending, then the fixture's confirmation.
      const light = view.page.locator('.cp-light-button');
      await light.click();
      await check('panel-light-choice', view);
      await view.page.locator('.cp-choice').first().click();
      await expect(view.page, 'panel-light-pending', '[data-chatdom-panel]', 'data-light', 'pending');
      if (!(await view.page.evaluate(() => document.activeElement?.classList.contains('cp-light')))) failures.push('panel-light: focus did not rest on the window after choosing');
      await view.page.waitForSelector('[data-light="lit"]', { timeout: 5000 });
      await view.page.waitForTimeout(1000);
      await check('panel-lit-named', view);
      // One drawer at a time, and back returns focus to the tab that opened it.
      const tab = view.page.locator('.cp-tab', { hasText: 'Tonight' });
      await tab.click();
      await expect(view.page, 'panel-drawer', '[data-chatdom-panel]', 'data-drawer', 'tonight');
      await check('panel-drawer-tonight', view);
      await view.page.locator('.cp-tab', { hasText: 'Home' }).click();
      await expect(view.page, 'panel-drawer', '[data-chatdom-panel]', 'data-drawer', 'home');
      await check('panel-drawer-home', view);
      await view.page.locator('.cp-back').click();
      await expect(view.page, 'panel-drawer-back', '[data-chatdom-panel]', 'data-drawer', 'none');
      const focused = await view.page.evaluate(() => document.activeElement?.textContent ?? '');
      if (!focused.includes('Home')) failures.push(`panel-drawer-back: focus went to "${focused}", not the Home tab`);
      await view.page.close();
    }],
    ['panel-unnamed', async () => {
      const view = await open({ url: `${base}/panel?source=simulated&state=unnamed`, width: 318, height: 496 });
      await check('panel-unnamed', view);
      await view.page.close();
    }],
    // Production, bare: a plain browser without the Helper. Honest, designed, never the fixture.
    ['panel-production-outside', async () => {
      const view = await open({ url: `${base}/panel`, width: 318, height: 496 });
      await expect(view.page, 'panel-production-outside', '[data-chatdom-panel]', 'data-connection', 'outside-twitch');
      if (await view.page.locator('.cp-tag.simulated, .cp-picture img').count()) failures.push('panel-production-outside: production must never show the fixture');
      await check('panel-production-outside', view);
      await view.page.close();
    }],
    // The standalone Extension zip, served from a nested path with Twitch's own query.
    ['ext-panel-fixture', async () => {
      const view = await open({ url: `${panelBase}panel.html?source=simulated&anchor=panel&platform=web&mode=viewer&state=released&language=en`, width: 318, height: 496 });
      await expect(view.page, 'ext-panel-fixture', '[data-chatdom-panel]', 'data-light', 'unshared');
      await check('ext-panel-fixture', view);
      await view.page.close();
    }],
    ['ext-panel-unavailable', async () => {
      const view = await open({ url: `${panelBase}panel.html?anchor=panel&platform=web&mode=viewer&state=released`, width: 318, height: 496, helper: AUTHORIZED_HELPER });
      await expect(view.page, 'ext-panel-unavailable', '[data-chatdom-panel]', 'data-connection', 'kingdom-unavailable');
      await expect(view.page, 'ext-panel-unavailable', '[data-chatdom-panel]', 'data-light', 'unavailable');
      if (await view.page.locator('.cp-light-button').count()) failures.push('ext-panel-unavailable: an unavailable light must not be offered as a button');
      await check('ext-panel-unavailable', view);
      await view.page.close();
    }],
    ['ext-mobile', async () => {
      for (const [width, height, name] of [[390, 844, 'ext-mobile'], [844, 390, 'ext-mobile-landscape']]) {
        const view = await open({ url: `${panelBase}mobile.html?source=simulated&state=named&platform=mobile&mode=viewer`, width, height });
        await check(name, view);
        const small = await view.page.evaluate(() => [...document.querySelectorAll('.cp button, .cp a')].filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent));
        if (small.length) failures.push(`${name}: targets under 44 px ${JSON.stringify(small)}`);
        await view.page.close();
      }
    }],
    ['ext-config', async () => {
      for (const view of ['config', 'live_config']) {
        const opened = await open({ url: `${panelBase}${view}.html?mode=config&state=released`, width: 318, height: 496 });
        await check(`ext-${view}`, opened);
        await opened.page.close();
      }
    }],
  ];
  for (const [name, run] of cases) {
    if (only && !name.startsWith(only)) continue;
    console.log(`— ${name}`);
    await run();
  }
} finally {
  try { await browser?.close(); } finally {
    try { if (web) await closeCapturePreview(web); } finally {
      try { panelServer?.close(); } finally { await release?.(); }
    }
  }
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else console.log('\nThe panel review passed.');
