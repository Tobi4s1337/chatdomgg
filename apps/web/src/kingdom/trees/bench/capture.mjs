// Picture-tree evidence through the production renderer pieces. Run from the repository root:
//   node apps/web/src/kingdom/trees/bench/capture.mjs contact [--styles hearth,tide,grove] [--species oak,pine] [--hour 19]
//   node apps/web/src/kingdom/trees/bench/capture.mjs kingdom [--trees picture|core] [--views hero] [--sizes 1920x1080] [--hour 19.5]
// Takes the machine-wide capture lock, starts its own Vite dev server on a free capture port (the benches are dev-served,
// never shipped), fails on any page, console or shader error, and stops only what it started.
// Outputs: shots/picture-trees/contact/<style>-<species>.png, shots/picture-trees/kingdom/<view>-<trees>@<w>x<h>.png.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../../packages/testing/capture-lock.mjs';

const [mode = 'contact', ...args] = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (!['contact', 'kingdom'].includes(mode)) throw new Error('Choose contact or kingdom.');

async function startBenchServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      optimizeDeps: { entries: ['src/kingdom/trees/bench/contact.html', 'src/kingdom/trees/bench/kingdom.html'] },
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

async function open(browser, url, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url}:${message.location().lineNumber})`); });
  await page.goto(url);
  await page.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 900_000 });
  const failure = await page.evaluate(() => document.body.dataset.error);
  if (failure || errors.length) throw new Error(`Bench failed: ${failure ?? ''}\n${errors.join('\n')}`);
  return { page, errors };
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startBenchServer());
  console.log(`Bench: ${base}${server ? ' (started here)' : ''}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  if (mode === 'contact') {
    const out = 'shots/picture-trees/contact', hour = option('--hour', '19'), cell = 300, report = {};
    await mkdir(out, { recursive: true });
    for (const style of option('--styles', 'hearth,tide,grove').split(',')) for (const species of option('--species', 'oak,pine,birch,willow,elder').split(',')) {
      const rows = { oak: 4, pine: 4, birch: 4, willow: 3, elder: 2 }[species];
      const { page, errors } = await open(browser, `${base}/src/kingdom/trees/bench/contact.html?style=${style}&species=${species}&hour=${hour}&cell=${cell}`, { width: cell * 4, height: cell * rows });
      const path = `${out}/${style}-${species}${hour === '19' ? '' : `-h${hour}`}.png`;
      await page.screenshot({ path, fullPage: true });
      if (errors.length) throw new Error(errors.join('\n'));
      report[`${style}-${species}`] = await page.evaluate(() => window.__treeSheet.stats);
      console.log(`Captured ${path}`);
      await page.close();
    }
    await writeFile(`${out}/stats.json`, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    const out = 'shots/picture-trees/kingdom', hour = option('--hour', '19.5'), trees = option('--trees', 'picture'), report = {};
    await mkdir(out, { recursive: true });
    for (const [width, height] of option('--sizes', '1920x1080').split(',').map(size => size.split('x').map(Number))) {
      const views = option('--views', 'hero').split(',');
      const { page, errors } = await open(browser, `${base}/src/kingdom/trees/bench/kingdom.html?trees=${trees}&hour=${hour}&view=${views[0]}&seed=${option('--seed', 'willowmere')}&style=${option('--style', 'hearth')}`, { width, height });
      const times = option('--times', '30').split(',').map(Number);
      for (const view of views) for (const time of times) {
        await page.evaluate(name => window.__treeKingdom.view(name), view);
        await page.evaluate(value => window.__treeKingdom.time(value), time);
        await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        await page.waitForFunction(() => window.__treeKingdom.stats.lightingReady && window.__treeKingdom.stats.fieldSettled, null, { timeout: 300_000 });
        await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        if (errors.length) throw new Error(errors.join('\n'));
        const path = `${out}/${view}-${trees}-${option('--style', 'hearth')}${times.length > 1 ? `-t${time}` : ''}@${width}x${height}.png`;
        await page.screenshot({ path, timeout: 180_000 });
        report[`${view}-${trees}-t${time}@${width}x${height}`] = await page.evaluate(() => ({ ...window.__treeKingdom.stats }));
        console.log(`Captured ${path}`);
      }
      await page.close();
    }
    await writeFile(`${out}/stats-${trees}.json`, `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
