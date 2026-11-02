/* global AbortSignal, clearTimeout, PerformanceObserver, MutationObserver, performance, requestAnimationFrame, innerHeight, innerWidth, NodeFilter */
// Real survey only. Run against an already running built preview and Atlas service.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.1:5178';
const dir = 'work/evidence/atlas-map';
const jitless = process.env.ATLAS_TEST_CSP_JITLESS === '1';
const phoneOnly = process.argv.includes('--phone-only');
const artifact = phoneOnly ? 'am10-phone-final-still' : jitless ? 'am10-phone-final-with-bootstrap' : 'am10-phone-final';
// Mirrors PAGE_HEADERS in apps/api/src/public/main.ts.
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://static-cdn.jtvnw.net; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
if (process.argv.includes('--profile-phone')) {
  await mkdir(dir, { recursive: true });
  const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60000) });
  let browser;
  const deadline = setTimeout(() => { void browser?.close(); }, 110000);
  const report = { iterations: [], errors: [] };
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.on('pageerror', e => report.errors.push(e.message));
    await page.addInitScript(() => {
      window.__longTasks = [];
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration, name: e.name }); }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 60000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    const search = page.getByRole('combobox', { name: 'Find a channel' });
    for (let i = 0; i < 3; i++) {
      await search.fill('squeezie');
      const row = page.getByRole('option').filter({ hasText: /squeezie/i }).first(); await row.waitFor();
      await page.evaluate(() => {
        const p = window.__selectionProfile = { down: null, card: null, paint: null };
        document.addEventListener('pointerdown', e => { if (e.target.closest('.atlas-search-result')) p.down = performance.now(); }, { capture: true, once: true });
        const observer = new MutationObserver(() => { if (p.down !== null && document.querySelector('.atlas-card #atlas-card-title')) { p.card = performance.now(); observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => { p.paint = performance.now(); })); } });
        observer.observe(document.querySelector('.atlas'), { childList: true, subtree: true });
      });
      await cdp.send('Profiler.start'); await row.tap();
      await page.waitForFunction(() => window.__selectionProfile.paint !== null, null, { timeout: 15000 });
      const state = await page.evaluate(() => ({ timing: window.__selectionProfile, longTasks: window.__longTasks, still: Object.fromEntries([...document.querySelector('.atlas-still').attributes].filter(a => a.name.startsWith('data-still')).map(a => [a.name, a.value])) }));
      const { profile } = await cdp.send('Profiler.stop');
      const sampled = profile.nodes.filter(n => n.hitCount).map(n => ({ function: n.callFrame.functionName || '(anonymous)', url: n.callFrame.url, line: n.callFrame.lineNumber + 1, samples: n.hitCount })).sort((a, b) => b.samples - a.samples).slice(0, 30);
      const relevant = state.longTasks.filter(t => t.start + t.duration >= state.timing.down - 250 && t.start <= state.timing.paint);
      report.iterations.push({ ...state, longTasks: relevant, sampled });
      console.log(JSON.stringify(report.iterations.at(-1)));
      await page.getByRole('button', { name: 'Close card' }).click();
    }
  } catch (e) { report.failure = String(e?.stack ?? e); }
  finally {
    clearTimeout(deadline); await browser?.close(); await release();
    await writeFile(`${dir}/am10-phone-final-profile-after-cache.json`, JSON.stringify(report, null, 2) + '\n');
    if (report.failure) { console.error(report.failure); process.exitCode = 1; }
  }
  process.exit(process.exitCode ?? 0);
}
if (process.argv.includes('--diagnostic') || process.argv.includes('--moving-diagnostic')) {
  const moving = process.argv.includes('--moving-diagnostic');
  await mkdir(dir, { recursive: true });
  const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60000) });
  let browser;
  const deadline = setTimeout(() => { void browser?.close(); }, 85000);
  const report = { errors: [], responses: [], failed: [], pending: [], violations: [], attrs: null };
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pending = new Set();
    page.on('request', req => pending.add(req.url()));
    page.on('requestfinished', req => pending.delete(req.url()));
    page.on('requestfailed', req => { pending.delete(req.url()); report.failed.push({ url: req.url(), failure: req.failure() }); });
    page.on('response', res => { if (res.status() >= 400) report.responses.push({ url: res.url(), status: res.status() }); });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
    await page.addInitScript(moving => {
      window.__cspViolations = []; window.__functionProbes = [];
      if (moving) globalThis.__zod_globalConfig = { jitless: true };
      const nativeFunction = window.Function;
      if (!moving) window.Function = new Proxy(nativeFunction, {
        construct(target, args, newTarget) { window.__functionProbes.push({ time: performance.now(), stack: new Error().stack }); return Reflect.construct(target, args, newTarget); },
        apply(target, thisArg, args) { window.__functionProbes.push({ time: performance.now(), stack: new Error().stack }); return Reflect.apply(target, thisArg, args); },
      });
      document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sourceFile: e.sourceFile, lineNumber: e.lineNumber, columnNumber: e.columnNumber }));
    }, moving);
    await page.route('**/*', async route => {
      if (!route.request().isNavigationRequest() || route.request().resourceType() !== 'document') return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (moving) {
      report.samples = [];
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(10000);
        const sample = await page.evaluate(() => {
          const root = document.querySelector('.atlas');
          return { at: performance.now(), outer: document.querySelector('[data-atlas-ready]')?.getAttribute('data-atlas-ready'), inner: root && Object.fromEntries([...root.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])), rect: root?.getBoundingClientRect().toJSON(), visibility: document.visibilityState, stats: window.__chatdomAtlas?.stats?.() ?? null, violations: window.__cspViolations };
        });
        sample.pending = [...pending]; report.samples.push(sample);
        console.log(JSON.stringify(sample));
        if (sample.outer === 'map' && sample.inner?.['data-state'] === 'ready') break;
      }
    } else await page.waitForFunction(() => document.querySelector('[data-atlas-ready="map"]') && document.querySelector('.atlas[data-state="ready"][data-context="ok"][data-names="ready"]'), null, { timeout: 50000 }).catch(e => { report.timeout = e.message; });
    report.attrs = await page.evaluate(() => ({ outer: document.querySelector('[data-atlas-ready]')?.getAttribute('data-atlas-ready'), inner: document.querySelector('.atlas') && Object.fromEntries([...document.querySelector('.atlas').attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])) }));
    report.violations = await page.evaluate(() => window.__cspViolations);
    report.probes = await page.evaluate(() => window.__functionProbes);
    report.resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /scene|atlas|index/.test(e.name)).map(e => ({ name: e.name, start: e.startTime })));
    report.pending = [...pending];
    if (report.attrs.outer === 'map' && report.attrs.inner?.['data-state'] === 'ready') {
      const path = `${dir}/${moving ? 'am10-phone-final-moving-diagnostic' : 'am10-phone-final-provenance'}-map-1440.png`; await page.screenshot({ path }); report.screenshot = path;
    }
  } catch (e) { report.failure = String(e?.stack ?? e); }
  finally {
    clearTimeout(deadline); await browser?.close(); await release();
    await writeFile(`${dir}/${moving ? 'am10-phone-final-moving-diagnostic' : 'am10-phone-final-provenance'}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
  process.exit(0);
}
const checks = [], captures = [], errors = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'ok' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`); };
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(60000) });
let browser;
const deadline = setTimeout(() => { void browser?.close(); }, 240000);
try {
  await mkdir(dir, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 60000 });
  await page.waitForSelector('.atlas-still-mark[data-named="true"]', { timeout: 30000 });
  const labels = () => page.locator('.atlas-still-mark[data-named="true"]').evaluateAll(nodes => nodes.map(n => [n.dataset.settler, n.querySelector('.atlas-still-name')?.textContent]));
  const before = await labels();
  const mark = page.locator('.atlas-still-mark[data-named="true"]').first();
  const selected = await mark.getAttribute('data-settler');
  const markName = await mark.locator('.atlas-still-name').innerText();
  await mark.focus();
  await page.keyboard.press('Enter');
  await page.locator('.atlas-card').waitFor();
  check('keyboard selection opens the selected real holding', (await page.locator('.atlas-card').innerText()).toLowerCase().includes(markName.toLowerCase()) && await mark.getAttribute('aria-pressed') === 'true' && await mark.locator('.atlas-still-ring').count() === 1, { selected, markName });
  check('selecting an existing mark preserves cached base labels', JSON.stringify(before) === JSON.stringify(await labels()), { before, after: await labels() });
  await page.keyboard.press('Escape');
  check('Escape closes card and clears selected ring', await page.locator('.atlas-card').count() === 0 && await mark.getAttribute('aria-pressed') === 'false');

  const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search') && r.ok());
  await page.getByRole('combobox', { name: 'Find a channel' }).fill('squeezie');
  const data = await (await response).json();
  const result = data.results.find(item => item.channel.login === 'squeezie');
  const ids = await page.locator('.atlas-still-mark').evaluateAll(nodes => nodes.map(n => n.dataset.settler));
  check('search uses a real mapped holding absent from the initial still', !!result && result.channel.place === 'mapped' && !ids.includes(String(result.channel.id)), { channel: result?.channel, visibleMarkCount: ids.length });
  const row = page.getByRole('option').filter({ hasText: /squeezie/i }).first();
  await row.waitFor();
  await page.evaluate(() => {
    const probe = window.__phoneProbe = { down: null, click: null, rowPaint: null, cardDom: null, cardPaint: null };
    document.addEventListener('pointerdown', e => { if (e.target.closest('.atlas-search-result')) probe.down = performance.now(); }, true);
    document.addEventListener('click', e => { if (!e.target.closest('.atlas-search-result')) return; probe.click = performance.now(); requestAnimationFrame(() => { probe.rowPaint = performance.now(); }); }, true);
    const observer = new MutationObserver(() => {
      if (probe.down !== null && document.querySelector('.atlas-card #atlas-card-title')) {
        probe.cardDom = performance.now(); observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => { probe.cardPaint = performance.now(); }));
      }
    });
    observer.observe(document.querySelector('.atlas'), { childList: true, subtree: true });
  });
  await row.tap();
  await page.locator('.atlas-card #atlas-card-title').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.__phoneProbe.cardPaint !== null, null, { timeout: 15000 });
  const probe = await page.evaluate(() => window.__phoneProbe);
  check('search row paints after pointer down within 100ms', probe.down !== null && probe.rowPaint !== null && probe.rowPaint - probe.down <= 100, probe);
  check('actual selected card reaches DOM and paint within 100ms of pointer down', probe.down !== null && probe.cardDom !== null && probe.cardPaint !== null && probe.cardPaint - probe.down <= 100, probe);
  check('offscreen selection opens the requested card', /squeezie/i.test(await page.locator('.atlas-card').innerText()));
  check('offscreen selection retains cached base labels', JSON.stringify(before) === JSON.stringify(await labels()), { before, after: await labels() });
  if (phoneOnly) { const path = `${dir}/am10-phone-final-still-card-390.png`; await page.screenshot({ path }); captures.push(path); }
  await page.close();
  await browser.close(); browser = undefined;

  if (!phoneOnly) {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const kind of ['map', 'hero']) {
      const p = await browser.newPage({ viewport: { width, height }, isMobile: width === 390, hasTouch: width === 390 });
      p.on('pageerror', e => errors.push(e.message));
      await p.addInitScript(enabled => { if (enabled) globalThis.__zod_globalConfig = { jitless: true }; window.__cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI })); }, jitless);
      await p.route('**/*', async route => {
        if (!route.request().isNavigationRequest() || route.request().resourceType() !== 'document') return route.continue();
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
      });
      await p.goto(`${base}/${kind === 'map' ? 'map' : '-/atlas-embed?mode=hero'}`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => document.querySelector('[data-atlas-ready="map"]') && document.querySelector('.atlas[data-state="ready"][data-context="ok"][data-names="ready"]'), null, { timeout: 60000 });
      await p.evaluate(() => document.fonts.ready);
      const geometry = await p.locator('.atlas').evaluate(el => { const r = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect(); return { root: r.toJSON(), parent: parent.toJSON() }; });
      check(`${width} ${kind} atlas root covers its host`, geometry.root.width > 0 && geometry.root.height > 0 && Math.abs(geometry.root.width - geometry.parent.width) < 2 && Math.abs(geometry.root.height - geometry.parent.height) < 2, geometry);
      if (kind === 'map') {
        const words = await p.locator('.atlas').evaluate(root => {
          const excluded = '.atlas-map, .atlas-still-marks, canvas, svg, .atlas-visually-hidden, .sr-only, [hidden], [inert], [aria-hidden="true"]';
          const visible = el => { const r = el.getBoundingClientRect(); return !el.closest(excluded) && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
          const parts = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.parentElement && visible(node.parentElement) && node.textContent.trim()) parts.push(node.textContent.trim());
          for (const el of root.querySelectorAll('input[placeholder],textarea[placeholder]')) if (visible(el) && !el.value) parts.push(el.placeholder);
          const text = parts.join(' '); return { text, count: (text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) ?? []).length };
        });
        check(`${width} moving map has at most 25 visible chrome words`, words.count <= 25, words);
      }
      const path = `${dir}/${artifact}-${kind}-${width}.png`;
      await p.screenshot({ path }); captures.push(path);
      if (kind === 'hero') {
        await p.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 100); });
        const visible = await p.locator('.atlas').evaluate(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0; });
        check(`${width} hero remains visible after partial scroll`, visible);
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.setViewportSize({ width, height: height - 120 });
        const resized = await p.locator('.atlas').evaluate(el => { const r = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect(); return { width: r.width, height: r.height, hostWidth: parent.width, hostHeight: parent.height }; });
        check(`${width} hero root follows host resize`, resized.height > 0 && Math.abs(resized.width - resized.hostWidth) < 2 && Math.abs(resized.height - resized.hostHeight) < 2, resized);
        await p.setViewportSize({ width, height });
        await p.getByRole('button', { name: 'Turn the map' }).click();
        check(`${width} hero turns into explore`, await p.locator('[data-chatdom-atlas][data-atlas-mode="explore"]').count() === 1);
        if (width === 390) {
          const beforeView = await p.evaluate(() => window.__atlasBench.handle.view());
          const box = await p.locator('.atlas-map').boundingBox();
          const cdp = await p.context().newCDPSession(p);
          const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
          for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 22, y, id: 1 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await p.waitForTimeout(300);
          const afterView = await p.evaluate(() => window.__atlasBench.handle.view());
          check('phone touch pans the moving explore map', Math.abs(afterView.x - beforeView.x) > 0.00001 || Math.abs(afterView.y - beforeView.y) > 0.00001, { beforeView, afterView });
        }
        await p.evaluate(() => window.__atlasBench.dispose());
        check(`${width} embed disposal removes map and canvas`, await p.locator('[data-chatdom-atlas], canvas').count() === 0);
      }
      const violations = await p.evaluate(() => window.__cspViolations);
      check(`${width} ${kind} has no public CSP violations`, violations.length === 0, violations);
      await p.close();
    }
  }
  }
  check('no uncaught browser errors', errors.length === 0, errors);
} catch (e) { check('script completes', false, String(e?.stack ?? e)); }
finally {
  clearTimeout(deadline); await browser?.close(); await release();
  await writeFile(`${dir}/${artifact}-checks.json`, JSON.stringify({ requiredHostBootstrap: jitless ? 'Set globalThis.__zod_globalConfig = { jitless: true } before loading schema modules.' : null, checks, captures, errors }, null, 2) + '\n');
  if (checks.some(c => !c.pass)) process.exitCode = 1;
}
