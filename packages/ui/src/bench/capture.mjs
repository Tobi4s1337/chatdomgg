// The kit's own look: the isolated SIMULATED seal bench, and the real kingdom hero wearing the seal.
// node packages/ui/src/bench/capture.mjs [--kingdom] [--base-url http://127.0.0.1:<port>]
// Without --base-url, --kingdom starts this checkout's web dev server on the first free port in 5170–5199.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const benchRoot = fileURLToPath(new URL('./', import.meta.url));
// The web app's own Solid compiler; the kit adds no dependency of its own.
const { default: solid } = await import(createRequire(`${repo}apps/web/package.json`).resolve('vite-plugin-solid'));
const out = `${repo}shots/first-look/kit`;
const sizes = [[1440, 900], [390, 844]];
const report = { bench: 'SIMULATED typed seal states; no real feed', ports: [], checks: [] };

async function serve(config) {
  for (let port = 5170; port <= 5199; port++) {
    const server = await createServer({ ...config, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, ...config.server } });
    try { await server.listen(); report.ports.push(port); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (error?.code !== 'EADDRINUSE' && !/already in use/.test(error?.message ?? '')) throw error; }
  }
  throw new Error('No free port in 5170–5199');
}

const settle = page => page.evaluate(() => document.fonts.ready.then(() => new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r)))));
function watch(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  return errors;
}

const release = await acquireCaptureLock();
const servers = [];
let browser;
try {
  await mkdir(out, { recursive: true });
  const bench = await serve({ root: benchRoot, configFile: false, plugins: [solid()], server: { fs: { allow: [`${repo}packages/ui`] } } });
  servers.push(bench.server);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });

  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = watch(page);
    await page.goto(`${bench.base}/index.html`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    // Keyboard focus, the way a person reaches it: Tab until the brass key holds focus.
    for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement?.hasAttribute('data-bench-focus'))); i++) await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => document.activeElement?.hasAttribute('data-bench-focus')))) throw new Error('bench: Tab never reached the brass key');
    await settle(page);
    const facts = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      smallest: Math.min(...[...document.querySelectorAll('.cd-provenance *')].filter(e => e.textContent.trim() && !e.children.length).map(e => parseFloat(window.getComputedStyle(e).fontSize))),
      lostWords: [...document.querySelectorAll('[data-provenance="lost"] .cd-provenance-word')].map(e => e.textContent),
    }));
    if (facts.overflow) throw new Error(`bench ${width}x${height}: horizontal overflow`);
    if (facts.smallest < 12) throw new Error(`bench ${width}x${height}: seal text at ${facts.smallest}px`);
    if (errors.length) throw new Error(`bench ${width}x${height}: ${errors.join('\n')}`);
    await page.screenshot({ path: `${out}/seal-bench@${width}x${height}.png`, fullPage: true });
    report.checks.push(`bench ${width}x${height}: no overflow, smallest seal text ${facts.smallest}px, lost seals read ${facts.lostWords.join(' / ')}, brass focus reached by Tab`);
    await page.close();
  }

  let base = option('--base-url');
  if (!base && args.includes('--kingdom')) {
    const web = await serve({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts` });
    servers.push(web.server); base = web.base;
  }
  if (base) {
    const page = await browser.newPage({ viewport: { width: sizes[0][0], height: sizes[0][1] } }), errors = watch(page);
    await page.goto(`${base.replace(/\/$/, '')}/?source=simulated&seed=willowmere&tier=town&hour=19.5&time=30&camera=hero`);
    await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 300_000 });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settle(page);
      await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
      const seal = await page.evaluate(() => {
        const element = document.querySelector('.kingdom-seal'), box = element.getBoundingClientRect();
        const heading = document.querySelector('.kingdom-heading').getBoundingClientRect();
        const clear = (box.left >= heading.right || box.top >= heading.bottom) && box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight * 0.25;
        return { text: element.innerText, provenance: element.dataset.provenance, role: element.getAttribute('role'), share: box.width * box.height / (window.innerWidth * window.innerHeight), clear, box: [box.left, box.top, box.width, box.height].map(Math.round) };
      });
      if (seal.text !== 'SIMULATED' || seal.provenance !== 'simulated' || seal.role !== 'status') throw new Error(`kingdom ${width}x${height}: seal reads ${JSON.stringify(seal)}`);
      if (width >= 1440 && seal.share > 0.03) throw new Error(`kingdom ${width}x${height}: seal covers ${(seal.share * 100).toFixed(2)}% of the canvas`);
      if (!seal.clear) throw new Error(`kingdom ${width}x${height}: seal is off its top corner or overlaps the heading`);
      if (errors.length) throw new Error(`kingdom ${width}x${height}: ${errors.join('\n')}`);
      await page.screenshot({ path: `${out}/kingdom-hero-dusk@${width}x${height}.png`, timeout: 120_000 });
      report.checks.push(`kingdom hero dusk ${width}x${height}: seal reads ${seal.text}, ${(seal.share * 100).toFixed(2)}% of canvas at ${seal.box.join(',')}, in the top corner, clear of the heading`);
    }
    await page.close();
  }
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(report.checks.join('\n'));
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
  await release();
}
