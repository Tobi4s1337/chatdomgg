// The panel and stream lane's browser review. Captures every surface at its real size,
// exercises the interactions that matter and fails on overflow, page errors or a
// payload over budget. Build first (`pnpm build`), then:
//
//   node apps/panel/scripts/look.mjs [--base-url http://127.0.0.1:5190] [--panel-url http://127.0.0.1:5195/nested/]
//                                    [--only <name prefix>[,<prefix>…]]
//
// Without --base-url it serves this checkout's apps/web build on a free port. Without
// --panel-url it serves apps/panel/dist under a nested, versioned path, the way
// Twitch's CDN serves an Extension zip, so relative assets are really exercised.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
// A viewer who already shared their identity, whose token Twitch then refreshes. Any request to share again is recorded.
// Twitch says Bits work on this channel, and records any attempt to use them: the real panel must still offer no shelf.
const BITS_HELPER = `window.__bitsUsed=0;window.__shareAsked=0;window.Twitch={ext:{onAuthorized(cb){setTimeout(()=>cb({channelId:'1',clientId:'look',token:'look-token',helixToken:'look-helix',userId:'ULOOK'}),40)},onContext(){},onVisibilityChanged(){},viewer:{isLinked:true,role:'viewer',onChanged(){}},features:{isBitsEnabled:true,onChanged(){}},bits:{useBits(){window.__bitsUsed++},onTransactionComplete(){},onTransactionCancelled(){},getProducts(){return Promise.resolve([])}},actions:{requestIdShare(){window.__shareAsked++}}}};`;
const SHARED_HELPER = `window.__shareAsked=0;window.Twitch={ext:{onAuthorized(cb){setTimeout(()=>cb({channelId:'1',clientId:'look',token:'look-token',helixToken:'look-helix',userId:'ULOOK'}),40);setTimeout(()=>cb({channelId:'1',clientId:'look',token:'look-token-refreshed',helixToken:'look-helix-2',userId:'ULOOK'}),400)},onContext(){},onVisibilityChanged(){},viewer:{isLinked:true,role:'viewer',onChanged(){}},actions:{requestIdShare(){window.__shareAsked++}}}};`;

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
    const errors = [], missing = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });
    page.on('request', request => requests.push(request.url()));
    await page.route(HELPER, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: helper }));
    await page.goto(url);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, missing, requests };
  };
  const check = async (name, { page, errors, missing }, { settle = true } = {}) => {
    const { width, height } = page.viewportSize();
    const layout = await page.evaluate(() => {
      const scroller = document.scrollingElement;
      const clipped = [...document.querySelectorAll('.cp-light-words strong, .cp-choice strong, .cp-tab span, .cp-back span, .cp-tag, .cp-act-button strong, .cp-bits strong, .cp-signpost strong, .cp-walk a, .cp-table-name')]
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
    // `settle: false` keeps a moment in motion, like the window kindling.
    await page.screenshot({ path, animations: settle ? 'disabled' : 'allow' });
    console.log(`Captured ${path}`);
    return path;
  };
  // Many same-sized captures on one sheet, in rows, for a single look.
  const contactSheet = (name, paths, columns, [cellW, cellH] = [318, 496], scaled = false) => {
    const layout = paths.map((_, i) => `${(i % columns) * cellW}_${Math.floor(i / columns) * cellH}`).join('|');
    const path = join(out, `${name}.png`);
    const scale = scaled ? `${paths.map((_, i) => `[${i}:v]scale=${cellW}:${cellH}[c${i}]`).join(';')};${paths.map((_, i) => `[c${i}]`).join('')}` : '';
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...paths.flatMap(file => ['-i', file]),
      '-filter_complex', `${scale}xstack=inputs=${paths.length}:layout=${layout}:fill=#120c08`, '-frames:v', '1', path]);
    console.log(`Contact sheet ${path}`);
  };
  const expect = async (page, name, selector, attribute, value) => {
    const actual = await page.locator(selector).first().getAttribute(attribute);
    if (actual !== value) failures.push(`${name}: expected ${selector} ${attribute}=${value}, got ${actual}`);
  };
  const simulatedTag = async (page, name) => {
    if (!(await page.locator('.cp-tag.simulated').innerText()).toUpperCase().includes('SIMULATED')) failures.push(`${name}: SIMULATED mark missing`);
  };
  const actStatus = (page, status, timeout = 5000) => page.waitForSelector(`.cp-act[data-act-status="${status}"]`, { timeout });
  const focusedText = page => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  const smallTargets = page => page.evaluate(() => [...document.querySelectorAll('.cp button, .cp a')].filter(el => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map(el => el.textContent));

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
    // A capture under SwiftShader can outlast a beat; the director's clock waits for it, the scene does not.
    await page.evaluate(() => window.__chatdomStream?.hold?.(true));
    const { width, height } = page.viewportSize();
    const found = await page.evaluate(() => {
      const output = document.querySelector('[data-chatdom-stream]');
      const visible = el => { const box = el.getBoundingClientRect(), style = window.getComputedStyle(el); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'; };
      const curtain = document.querySelector('.stream-curtain');
      const words = [...output.querySelectorAll('.stream-signature, .stream-seam, .stream-name, .stream-mark, .stream-curtain')].filter(el => visible(el) && !(el === curtain && curtain.classList.contains('open'))).map(el => el.innerText).join(' ');
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
    await page.evaluate(() => window.__chatdomStream?.hold?.(false));
    console.log(`Captured ${path}`);
    return found;
  };
  // The stream stays quiet: no broadcast mix exists, so nothing may open an audio context.
  const QUIET = () => {
    window.__audioContexts = 0;
    for (const key of ['AudioContext', 'webkitAudioContext']) {
      const Real = window[key];
      if (Real) window[key] = class extends Real { constructor(...args) { super(...args); window.__audioContexts++; } };
    }
  };
  const director = page => page.evaluate(() => window.__chatdomStream.director);
  // Wait until the director has opened a given shot (its shutters fully open) after `cuts` earlier cuts.
  const shotOpens = (page, shot, cuts, timeout = 240_000) => page.waitForFunction(([shot, cuts]) => {
    const d = window.__chatdomStream.director;
    return d.cuts.length > cuts && d.cuts.at(-1).shot === shot && d.curtain === 'open';
  }, [shot, cuts], { timeout, polling: 100 });
  const holdsKept = async (page, name) => {
    const { cuts } = await director(page);
    for (let i = 1; i < cuts.length; i++) if (cuts[i].at - cuts[i - 1].at < 8000) failures.push(`${name}: cut after ${((cuts[i].at - cuts[i - 1].at) / 1000).toFixed(1)} s, under the eight-second hold`);
    return cuts;
  };
  const quiet = async (page, name) => {
    const contexts = await page.evaluate(() => window.__audioContexts);
    if (contexts !== 0) failures.push(`${name}: the stream opened ${contexts} audio context(s)`);
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
    // Calm holds one shot and drifts; it never cuts.
    ['stream-calm', async () => {
      const view = await openStream({ path: `/stream?${STREAM}`, width: 1280, height: 720, init: QUIET });
      await view.page.waitForTimeout(12_000);
      const state = await director(view.page);
      if (state.cuts.length || state.shot !== 'hero') failures.push(`stream-calm: calm cut away (${JSON.stringify(state)})`);
      if (!await view.page.locator('.stream-output.drifting').count()) failures.push('stream-calm: the held picture does not drift');
      if (await view.page.locator('.stream-name').count()) failures.push('stream-calm: calm showed a name');
      await quiet(view.page, 'stream-calm');
      await view.page.close();
    }],
    // Show: motivated cuts behind shutters, each shot held at least eight seconds, one public name at the window.
    ['stream-show', async () => {
      const view = await openStream({ path: `/stream?${STREAM}&mood=show`, width: 1920, height: 1080, init: QUIET });
      const { page } = view;
      await expect(page, 'stream-show', '[data-chatdom-stream]', 'data-mood', 'show');
      await checkStream('stream-show-town', view);
      await page.waitForSelector('[data-curtain=shut]', { timeout: 120_000 });
      await checkStream('stream-show-shutter', view);
      await shotOpens(page, 'window', 0);
      await page.waitForSelector('.stream-name.shown', { timeout: 30_000 }).catch(() => failures.push('stream-show: no name at the window climax'));
      await page.waitForTimeout(900);
      const name = await page.locator('.stream-name').innerText().catch(() => '');
      if (!name.trim()) failures.push('stream-show: the climax name is empty');
      await simulatedMark(page, 'stream-show');
      await checkStream('stream-show-window', view);
      await page.waitForSelector('.stream-name:not(.shown)', { timeout: 30_000 }).catch(() => failures.push('stream-show: the name stayed past its climax'));
      await shotOpens(page, 'citizen', 1);
      await page.waitForTimeout(1200);
      await checkStream('stream-show-street', view);
      // The same director at the smaller broadcast size: back to the town, then the window again.
      await page.setViewportSize({ width: 1280, height: 720 });
      await shotOpens(page, 'hero', 2);
      await page.waitForTimeout(1500);
      await checkStream('stream-show-town', view);
      await shotOpens(page, 'window', 3);
      await page.waitForSelector('.stream-name.shown', { timeout: 30_000 }).catch(() => failures.push('stream-show 720: no name at the window climax'));
      await page.waitForTimeout(900);
      await checkStream('stream-show-window', view);
      await holdsKept(page, 'stream-show');
      await quiet(page, 'stream-show');
      await page.close();
    }],
    // The seams: starting turns the sky to dusk from the street, a break tours, ending settles on the night town.
    ['stream-seams', async () => {
      const shots = [];
      for (const seam of ['starting', 'break', 'ending']) {
        const view = await openStream({ path: `/stream?${STREAM}&seam=${seam}&mood=show`, width: 1280, height: 720, init: QUIET });
        await expect(view.page, `stream-seam-${seam}`, '[data-chatdom-stream]', 'data-seam', seam);
        const card = await view.page.locator('.stream-seam').innerText().catch(() => '');
        if (!card.trim()) failures.push(`stream-seam-${seam}: no seam card`);
        if (/\d|countdown/i.test(card)) failures.push(`stream-seam-${seam}: the card counts ("${card}")`);
        const state = await director(view.page);
        const first = { starting: 'citizen', break: 'hero', ending: 'hero' }[seam];
        if (state.shot !== first) failures.push(`stream-seam-${seam}: opened on ${state.shot}, expected ${first}`);
        if (seam === 'ending') {
          await view.page.waitForTimeout(10_000);
          const later = await director(view.page);
          if (later.cuts.length || !(later.hour > 19.5)) failures.push(`stream-seam-ending: expected a held town settling into night (${JSON.stringify(later)})`);
        }
        if (seam === 'starting') {
          const before = (await director(view.page)).hour;
          if (!(before < 19)) failures.push(`stream-seam-starting: the sky should begin before dusk (hour ${before})`);
        }
        await simulatedMark(view.page, `stream-seam-${seam}`);
        shots.push(await checkStream(`stream-seam-${seam}`, view).then(() => join(out, `stream-seam-${seam}@1280x720.png`)));
        await quiet(view.page, `stream-seam-${seam}`);
        await view.page.close();
      }
      contactSheet('stream-seams@1280x720', shots, 2, [640, 360], true);
    }],
    // The small shapes in show: slower cuts between close shots only; the name is the only words but the mark.
    ['stream-small-show', async () => {
      const corner = await openStream({ path: `/stream?${STREAM}&layout=window&mood=show`, width: 480, height: 270, init: QUIET });
      await corner.page.waitForSelector('.stream-name.shown', { timeout: 30_000 }).catch(() => failures.push('stream-window-show: no name at the window climax'));
      await corner.page.waitForTimeout(900);
      await checkStream('stream-window-name', corner);
      await shotOpens(corner.page, 'citizen', 0);
      await corner.page.waitForTimeout(1200);
      await simulatedMark(corner.page, 'stream-window-show');
      await checkStream('stream-window-street', corner);
      if ((await director(corner.page)).beats.includes('hero')) failures.push('stream-window-show: a whole-town shot in the corner');
      await corner.page.close();
      // The strip under reduced motion: the cut still happens, without shutters.
      const strip = await openStream({ path: `/stream?${STREAM}&layout=strip&mood=show`, width: 1280, height: 180, init: QUIET });
      await strip.page.emulateMedia({ reducedMotion: 'reduce' });
      await strip.page.evaluate(() => {
        window.__curtains = new Set();
        new window.MutationObserver(() => window.__curtains.add(document.querySelector('[data-chatdom-stream]').dataset.curtain))
          .observe(document.querySelector('[data-chatdom-stream]'), { attributes: true, attributeFilter: ['data-curtain'] });
      });
      await checkStream('stream-strip-name', strip);
      await shotOpens(strip.page, 'citizen', 0);
      await strip.page.waitForTimeout(1200);
      if ((await strip.page.evaluate(() => [...window.__curtains])).some(state => state !== 'open')) failures.push('stream-strip-show: reduced motion still closed the shutters');
      await checkStream('stream-strip-street', strip);
      await strip.page.close();
    }],
    // A kept-clear rectangle: the kingdom and its words fit the chosen part; the rest of the source is transparent.
    ['stream-safe', async () => {
      const view = await openStream({ path: `/stream?${STREAM}&mood=show&safe=chat`, width: 1920, height: 1080, init: QUIET });
      const box = await view.page.locator('[data-chatdom-stream]').boundingBox();
      if (Math.abs(box.width - 1920 * .74) > 2 || box.x !== 0 || box.height !== 1080) failures.push(`stream-safe: the kingdom sits at ${JSON.stringify(box)}`);
      await shotOpens(view.page, 'window', 0);
      await view.page.waitForSelector('.stream-name.shown', { timeout: 30_000 }).catch(() => {});
      const outside = await view.page.evaluate(() => {
        const area = document.querySelector('[data-chatdom-stream]').getBoundingClientRect();
        return [...document.querySelectorAll('.stream-signature, .stream-name, .stream-mark, .stream-canvas')].filter(el => {
          const b = el.getBoundingClientRect();
          return b.width && (b.left < area.left - .5 || b.right > area.right + .5 || b.top < area.top - .5 || b.bottom > area.bottom + .5);
        }).map(el => el.className.baseVal ?? el.className);
      });
      if (outside.length) failures.push(`stream-safe: outside the kept rectangle ${JSON.stringify(outside)}`);
      const path = join(out, 'stream-safe@1920x1080.png');
      await view.page.screenshot({ path, animations: 'disabled', omitBackground: true, timeout: 120_000 });
      console.log(`Captured ${path}`);
      await checkStream('stream-safe-check', view);
      await view.page.close();
      const preview = await openStream({ path: `/stream?${STREAM}&preview=1&safe=chat`, width: 1440, height: 900 });
      if (!(await preview.page.locator('.stream-bench-sound').innerText()).includes('Broadcast mix unavailable')) failures.push('stream-preview-safe: the preview must say the broadcast mix is unavailable');
      if (!(await preview.page.locator('.stream-bench-foot code').innerText()).includes('safe=chat')) failures.push('stream-preview-safe: the browser-source path lost the kept-clear choice');
      await checkStream('stream-preview-safe', preview, { clean: false });
      await preview.page.locator('.stream-bench-choice button', { hasText: 'Show' }).click();
      await preview.page.locator('.stream-bench-choice button', { hasText: 'Starting' }).click();
      await preview.page.waitForTimeout(3000);
      await expect(preview.page, 'stream-preview-safe', '[data-chatdom-stream]', 'data-seam', 'starting');
      if (!(await preview.page.locator('.stream-bench-foot code').innerText()).includes('seam=starting')) failures.push('stream-preview-safe: the path lost the seam');
      await checkStream('stream-preview-starting', preview, { clean: false });
      await preview.page.close();
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
      const view = await openStream({ path: '/stream?seed=willowmere&tier=town&hour=19.5&time=30&mood=show', width: 1280, height: 720, tolerate: /presence-data|EventSource|Failed to load resource/ });
      await view.page.waitForFunction(() => window.__chatdomStream.source === 'lost', null, { timeout: 60_000 });
      if (await view.page.locator('.source-ribbon').innerText().then(text => text.includes('SIMULATED'))) failures.push('stream-live-lost: a real source must never say SIMULATED');
      // Show with a lost source: no subject for a close shot and no name to place, so the town holds.
      await view.page.waitForTimeout(20_000);
      const state = await director(view.page);
      if (state.cuts.length || state.shot !== 'hero' || state.name) failures.push(`stream-live-lost: a stale source cut or named someone (${JSON.stringify(state)})`);
      if (await view.page.locator('.stream-name').count()) failures.push('stream-live-lost: a personal label on a stale projection');
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
      // The simulated journey, step by step: Twitch shares who you are, the kingdom answers, the window kindles.
      // On a busy host one capture can outlast a whole step, so the steps after sharing are taken on a fresh panel.
      const kindle = [await check('panel-light-sharing', view)];
      await view.page.close();
      Object.assign(view, await open({ url: `${base}/panel?source=simulated`, width: 318, height: 496 }));
      await view.page.locator('.cp-light-button').click();
      await view.page.locator('.cp-choice').first().click();
      await view.page.waitForSelector('.cp-light-note .cp-light-words strong:text("Lighting your window")', { timeout: 5000 });
      kindle.push(await check('panel-light-confirming', view));
      await view.page.close();
      Object.assign(view, await open({ url: `${base}/panel?source=simulated`, width: 318, height: 496 }));
      await view.page.locator('.cp-light-button').click();
      await view.page.locator('.cp-choice').first().click();
      await view.page.waitForSelector('[data-light="lit"] .cp-light-button.kindling', { timeout: 5000 });
      await view.page.waitForTimeout(650);
      kindle.push(await check('panel-light-kindling', view, { settle: false }));
      await view.page.waitForTimeout(450);
      kindle.push(await check('panel-light-kindled', view, { settle: false }));
      await view.page.waitForFunction(() => !document.querySelector('.kindling'), null, { timeout: 5000 });
      kindle.push(await check('panel-lit-named', view));
      contactSheet('panel-light-sequence@318x496', kindle, kindle.length);
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
    // Every fixture state at the panel's real size, on one sheet: the first view and the drawer that explains it.
    ['panel-states', async () => {
      const states = [
        ['logged-out', 'logged-out', null], ['unshared', 'unshared', 'home'], ['refused', 'refused', null],
        ['named', 'lit', 'home'], ['unnamed', 'lit', 'home'], ['guest', 'lit', 'home'],
        ['resting', 'resting', 'tonight'], ['disconnected', 'out-of-reach', 'home'], ['missing', 'unshared', 'tonight'],
      ];
      const shots = [];
      for (const [state, light, drawer] of states) {
        const view = await open({ url: `${base}/panel?source=simulated&state=${state}`, width: 318, height: 496 });
        await expect(view.page, `panel-state-${state}`, '[data-chatdom-panel]', 'data-light', light);
        if (!(await view.page.locator('.cp-tag.simulated').innerText()).toUpperCase().includes('SIMULATED')) failures.push(`panel-state-${state}: SIMULATED mark missing`);
        shots.push(await check(`panel-state-${state}`, view));
        if (drawer) {
          await view.page.locator('.cp-tab', { hasText: drawer === 'home' ? 'Home' : 'Tonight' }).click();
          await view.page.waitForTimeout(300);
          shots.push(await check(`panel-state-${state}-${drawer}`, view));
        }
        if (state === 'unshared') {
          // A home that is not known yet offers the way forward: lighting the window opens the choice.
          await view.page.locator('.cp-empty .cp-inline-action', { hasText: 'Light your window' }).click();
          await expect(view.page, 'panel-state-unshared', '[data-chatdom-panel]', 'data-drawer', 'light');
        }
        if (state === 'guest' && !(await view.page.locator('.cp-plaque.guest').count())) failures.push('panel-state-guest: the guest plaque is missing');
        if (state === 'resting' && !(await view.page.locator('.cp-ballad blockquote p').count())) failures.push('panel-state-resting: the supplied Ballad is missing');
        if (state === 'disconnected' && !(await view.page.locator('.cp-picture.stale .cp-stale').count())) failures.push('panel-state-disconnected: a stale picture must say so');
        await view.page.close();
      }
      contactSheet('panel-states@318x496', shots, 5);
    }],
    // Tonight's shared moments: one tap is one command under chat's limits, and every answer is the kingdom's.
    ['panel-acts', async () => {
      const shots = [];
      const vote = await open({ url: `${base}/panel?source=simulated&state=vote`, width: 318, height: 496 });
      await simulatedTag(vote.page, 'panel-act-vote');
      shots.push(await check('panel-act-vote', vote));
      await vote.page.locator('.cp-act-button', { hasText: 'Lanterns' }).click();
      await actStatus(vote.page, 'pending', 1000);
      shots.push(await check('panel-act-vote-pending', vote));
      await actStatus(vote.page, 'accepted');
      if (!(await vote.page.evaluate(() => document.activeElement?.classList.contains('cp-act-wrap')))) failures.push('panel-act-vote: focus did not wait on the act after the tap');
      if (await vote.page.locator('.cp-act-button').count()) failures.push('panel-act-vote: a counted vote must not offer a second vote');
      shots.push(await check('panel-act-vote-counted', vote));
      await vote.page.close();

      const errand = await open({ url: `${base}/panel?source=simulated&state=errand`, width: 318, height: 496 });
      shots.push(await check('panel-act-errand', errand));
      const fill = () => errand.page.locator('.cp-act .cp-meter i').evaluate(el => parseFloat(el.style.width));
      const before = await fill();
      await errand.page.locator('.cp-act-button').click();
      await actStatus(errand.page, 'accepted');
      await errand.page.waitForTimeout(4000);
      // In motion on purpose: the groove drains through chat's twenty-second pause.
      shots.push(await check('panel-act-errand-hauled', errand, { settle: false }));
      if (await fill() <= before) failures.push('panel-act-errand: the simulated stone did not raise the fixture building');
      await errand.page.close();

      const dragon = await open({ url: `${base}/panel?source=simulated&state=dragon`, width: 318, height: 496 });
      shots.push(await check('panel-act-dragon', dragon));
      await dragon.page.locator('.cp-act-button').click();
      // The simulated viewer struck from chat a moment ago: the panel meets the same pause.
      await actStatus(dragon.page, 'limited');
      shots.push(await check('panel-act-dragon-limited', dragon, { settle: false }));
      await actStatus(dragon.page, 'open', 8000);
      await dragon.page.locator('.cp-act-button').click();
      await actStatus(dragon.page, 'accepted');
      shots.push(await check('panel-act-dragon-struck', dragon, { settle: false }));
      await dragon.page.close();

      const ended = await open({ url: `${base}/panel?source=simulated&state=act-ended`, width: 318, height: 496 });
      await expect(ended.page, 'panel-act-ended', '.cp-act', 'data-act-status', 'ended');
      if (await ended.page.locator('.cp-act-button').count()) failures.push('panel-act-ended: a closed vote must not be offered');
      shots.push(await check('panel-act-ended', ended));
      await ended.page.close();

      // Not yet known to the kingdom: the vote waits for a light, and lighting it opens the vote.
      const unshared = await open({ url: `${base}/panel?source=simulated&state=act-unshared`, width: 318, height: 496 });
      await expect(unshared.page, 'panel-act-unshared', '.cp-act', 'data-act-status', 'unavailable');
      shots.push(await check('panel-act-unshared', unshared));
      await unshared.page.locator('.cp-act-gate .cp-inline-action').click();
      await expect(unshared.page, 'panel-act-unshared', '[data-chatdom-panel]', 'data-drawer', 'light');
      await unshared.page.locator('.cp-choice').nth(1).click();
      await actStatus(unshared.page, 'open', 6000);
      shots.push(await check('panel-act-unshared-lit', unshared));
      await unshared.page.close();
      contactSheet('panel-acts@318x496', shots, 6);
    }],
    // The tavern, the forge signpost and the shelf, each a drawer at the panel's real size.
    ['panel-places', async () => {
      const shots = [];
      const view = await open({ url: `${base}/panel?source=simulated&state=named`, width: 318, height: 496 });
      const { page } = view;
      await page.locator('.cp-tab', { hasText: 'Tavern' }).click();
      await expect(page, 'panel-tavern', '[data-chatdom-panel]', 'data-drawer', 'tavern');
      if (await page.locator('.cp-table').count() < 2) failures.push('panel-tavern: the tavern should name its tables');
      if (await page.getByText(/joined|your seat/i).count()) failures.push('panel-tavern: the panel must never claim a seat');
      shots.push(await check('panel-tavern', view));
      await page.locator('.cp-drawer-page').evaluate(el => { el.scrollTop = el.scrollHeight; });
      const walk = page.locator('.cp-walk a');
      const link = { href: await walk.getAttribute('href'), target: await walk.getAttribute('target'), rel: await walk.getAttribute('rel') };
      if (!link.href?.includes('seed=willowmere') || link.target !== '_blank' || !link.rel?.includes('noopener')) failures.push(`panel-tavern: Walk in must open the kingdom's gate in a new tab (${JSON.stringify(link)})`);
      shots.push(await check('panel-tavern-foot', view));
      await page.locator('.cp-tab', { hasText: 'Forge' }).click();
      await expect(page, 'panel-forge', '[data-chatdom-panel]', 'data-drawer', 'forge');
      if (await page.locator('.cp-drawer input, .cp-drawer textarea, .cp-drawer [contenteditable]').count()) failures.push('panel-forge: the panel takes no words for the forge');
      shots.push(await check('panel-forge', view));
      await page.locator('.cp-drawer-page').evaluate(el => { el.scrollTop = el.scrollHeight; });
      shots.push(await check('panel-forge-foot', view));
      // Tonight, then the shelf inside it: Back returns to Tonight and its signpost, then to the first view.
      await page.locator('.cp-tab', { hasText: 'Tonight' }).click();
      await page.locator('.cp-drawer-page').evaluate(el => { el.scrollTop = el.scrollHeight; });
      shots.push(await check('panel-tonight-raised', view));
      await page.locator('.cp-signpost').click();
      await expect(page, 'panel-shelf', '[data-chatdom-panel]', 'data-drawer', 'shelf');
      if (!(await focusedText(page)).includes('Tonight')) failures.push(`panel-shelf: focus went to "${await focusedText(page)}", not Back to Tonight`);
      if (await page.getByText(/\b(buy|purchase|price|cost|spend|donate|cheer)/i).count()) failures.push('panel-shelf: Bits words must be use, get or exchange');
      shots.push(await check('panel-shelf', view));
      await page.locator('.cp-bits').nth(1).click();
      await page.waitForSelector('.cp-product[data-request="confirming"]', { timeout: 1000 });
      shots.push(await check('panel-shelf-confirming', view));
      await page.waitForSelector('.cp-product[data-request="cancelled"]', { timeout: 5000 });
      shots.push(await check('panel-shelf-cancelled', view));
      await page.locator('.cp-back').click();
      await expect(page, 'panel-shelf-back', '[data-chatdom-panel]', 'data-drawer', 'tonight');
      if (!(await focusedText(page)).includes('The shelf')) failures.push(`panel-shelf-back: focus went to "${await focusedText(page)}", not the shelf signpost`);
      await page.keyboard.press('Escape');
      await expect(page, 'panel-shelf-back', '[data-chatdom-panel]', 'data-drawer', 'none');
      if (!(await focusedText(page)).includes('Tonight')) failures.push(`panel-shelf-back: focus went to "${await focusedText(page)}", not the Tonight tab`);
      await page.close();
      // Between streams the forge is banked and the shelf is put away; a guest forges where they live.
      for (const [state, drawers] of [['resting', ['Forge', 'Tavern']], ['guest', ['Forge']], ['missing', ['Tavern', 'Forge']]]) {
        const other = await open({ url: `${base}/panel?source=simulated&state=${state}`, width: 318, height: 496 });
        for (const drawer of drawers) {
          await other.page.locator('.cp-tab', { hasText: drawer }).click();
          shots.push(await check(`panel-${drawer.toLowerCase()}-${state}`, other));
        }
        if (state === 'resting') {
          await other.page.locator('.cp-tab', { hasText: 'Tonight' }).click();
          if (await other.page.locator('.cp-signpost').count()) failures.push('panel-resting: the shelf must be put away between streams');
        }
        await other.page.close();
      }
      contactSheet('panel-places@318x496', shots, 6);
    }],
    // The real panel on a channel where Twitch says Bits work: still no shelf, no act, no request anywhere.
    ['ext-panel-bits', async () => {
      const view = await open({ url: `${panelBase}panel.html?anchor=panel&platform=web&mode=viewer&state=released`, width: 318, height: 496, helper: BITS_HELPER });
      await view.page.waitForTimeout(800);
      if (await view.page.locator('.cp-act, .cp-signpost, .cp-bits').count()) failures.push('ext-panel-bits: production offered an act or the shelf without a service to answer it');
      for (const drawer of ['Tonight', 'Tavern', 'Forge']) {
        await view.page.locator('.cp-tab', { hasText: drawer }).click();
        if (await view.page.locator('.cp-drawer .cp-bits, .cp-drawer .cp-signpost, .cp-drawer .cp-walk').count()) failures.push(`ext-panel-bits: ${drawer} offered something production cannot deliver`);
        if (drawer === 'Forge') await check('ext-panel-forge-unavailable', view);
      }
      const outside = view.requests.filter(url => !url.startsWith(panelBase) && url !== HELPER && !url.startsWith('data:'));
      if (outside.length) failures.push(`ext-panel-bits: requests beyond the Extension's own files ${JSON.stringify(outside)}`);
      if (await view.page.evaluate(() => window.__bitsUsed + window.__shareAsked) !== 0) failures.push('ext-panel-bits: Bits or identity sharing were asked for');
      await view.page.close();
      // The simulated shelf in the real Extension frame: its demonstration never reaches Twitch's Bits.
      const fixture = await open({ url: `${panelBase}panel.html?source=simulated&state=named&anchor=panel&platform=web&mode=viewer`, width: 318, height: 496, helper: BITS_HELPER });
      await fixture.page.locator('.cp-tab', { hasText: 'Tonight' }).click();
      await fixture.page.locator('.cp-signpost').click();
      await fixture.page.locator('.cp-bits').first().click();
      await fixture.page.waitForSelector('.cp-product[data-request="cancelled"]', { timeout: 5000 });
      if (await fixture.page.evaluate(() => window.__bitsUsed) !== 0) failures.push('ext-panel-bits: the simulated shelf reached Twitch\'s useBits');
      const walk = await fixture.page.locator('.cp-tab', { hasText: 'Tavern' }).click().then(() => fixture.page.locator('.cp-walk a').getAttribute('href'));
      if (!walk?.startsWith('https://chatdom.gg/')) failures.push(`ext-panel-bits: Walk in from the Extension must lead to chatdom.gg (${walk})`);
      await fixture.page.close();
    }],
    // A viewer who already shared their identity, after Twitch refreshed the token: connected, never lit, never asked again.
    ['ext-panel-shared', async () => {
      const view = await open({ url: `${panelBase}panel.html?anchor=panel&platform=web&mode=viewer&state=released`, width: 318, height: 496, helper: SHARED_HELPER });
      await view.page.waitForTimeout(800);
      await expect(view.page, 'ext-panel-shared', '[data-chatdom-panel]', 'data-light', 'unavailable');
      if (!(await view.page.locator('.cp-light-note').innerText()).includes('Twitch connected')) failures.push('ext-panel-shared: expected "Twitch connected"');
      if (await view.page.locator('.cp-light-button').count()) failures.push('ext-panel-shared: an unconfirmable light must not be offered as a button');
      if (await view.page.evaluate(() => document.documentElement.outerHTML.includes('look-token') || window.location.href.includes('look-token') || JSON.stringify({ ...window.localStorage, ...window.sessionStorage }).includes('look-token'))) failures.push('ext-panel-shared: a Helper token reached the page, URL or storage');
      if (await view.page.evaluate(() => window.__shareAsked) !== 0) failures.push('ext-panel-shared: asked Twitch to share identity with no kingdom to answer');
      await view.page.locator('.cp-tab', { hasText: 'Home' }).click();
      await check('ext-panel-shared', view);
      await view.page.locator('.cp-back').click();
      await check('ext-panel-shared-first', view);
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
        const small = await smallTargets(view.page);
        if (small.length) failures.push(`${name}: targets under 44 px ${JSON.stringify(small)}`);
        await view.page.close();
      }
      // A phone with chat closed: the act under the thumb, then a drawer opened and closed by touch alone.
      for (const [width, height, state, name] of [[390, 844, 'vote', 'ext-mobile-vote'], [844, 390, 'errand', 'ext-mobile-landscape-errand']]) {
        const view = await open({ url: `${panelBase}mobile.html?source=simulated&state=${state}&platform=mobile&mode=viewer`, width, height });
        await check(name, view);
        const small = await smallTargets(view.page);
        if (small.length) failures.push(`${name}: targets under 44 px ${JSON.stringify(small)}`);
        await view.page.close();
      }
      const view = await open({ url: `${panelBase}mobile.html?source=simulated&state=named&platform=mobile&mode=viewer`, width: 390, height: 844 });
      for (const drawer of ['Tavern', 'Forge']) {
        await view.page.locator('.cp-tab', { hasText: drawer }).click();
        if (!(await focusedText(view.page)).includes('The kingdom')) failures.push(`ext-mobile-${drawer}: the drawer did not take focus on Back`);
        const small = await smallTargets(view.page);
        if (small.length) failures.push(`ext-mobile-${drawer}: targets under 44 px ${JSON.stringify(small)}`);
        await check(`ext-mobile-${drawer.toLowerCase()}`, view);
        await view.page.locator('.cp-back').click();
        if (!(await focusedText(view.page)).includes(drawer)) failures.push(`ext-mobile-${drawer}: Back left focus on "${await focusedText(view.page)}"`);
      }
      await view.page.close();
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
    if (only && !only.split(',').some(prefix => name.startsWith(prefix))) continue;
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
