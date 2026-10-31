// Ground-dressing evidence from the SIMULATED-land bench, through the production renderer pieces.
// Run from the repository root:
//   node apps/web/src/kingdom/ground-dressing/capture.mjs [--views street,hero,market] [--hours dusk] [--sizes 1440x900,390x844]
//     [--dressing on|off] [--base-url http://127.0.0.1:<port>]
// It takes the machine-wide capture lock before any server or browser, starts its own Vite dev server on a free port in
// 5170–5199 unless --base-url is given (the bench page is dev-served, never shipped), waits for the bench's readiness
// and settled light fields, fails on any page, console or shader error, reuses one loaded scene per size, and stops
// only what it started. Outputs: shots/ground-dressing/<view>-<hour>@<w>x<h>.png and stats.json.
//   node apps/web/src/kingdom/ground-dressing/capture.mjs --trees [--base-url …]
// captures the tree-form sheets instead (trees.html: no land, no fixture): the full/LOD-4 sheet in colour and grey, the
// black silhouettes with the tallest form about 160 px high, and the elder oak at dusk at both web sizes, with
// trees-stats.json (meshed triangles per form and level). `--tree-shots trees-sheet,elder-dusk` captures only those
// (refreshing their trees-stats.json entries), and `--tree-query forms=oak-old-a,beech` narrows every tree page (outputs then carry a `-subset` suffix).
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HOURS = { noon: 12, afternoon: 16, dusk: 19.5, night: 23 };
const views = (option('--views') ?? 'street,hero').split(',');
const hours = (option('--hours') ?? 'dusk').split(',');
if (hours.some(hour => !(hour in HOURS))) throw new Error('Expected --hours from noon,afternoon,dusk,night');
const sizes = (option('--sizes') ?? '1440x900,390x844').split(',').map(size => size.split('x').map(Number));
if (sizes.some(size => size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0))) throw new Error('Expected --sizes WxH[,WxH]');
const dressing = option('--dressing') ?? 'on';
const out = 'shots/ground-dressing';

async function startBenchServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error',
      optimizeDeps: { entries: ['src/kingdom/ground-dressing/bench.html', 'src/kingdom/ground-dressing/trees.html'] },
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try { await server.listen(); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

const TREE_SHOTS = [
  { name: 'trees-sheet', query: 'mode=sheet', size: [1920, 1080] },
  { name: 'trees-sheet-grey', query: 'mode=sheet&grey=1', size: [1920, 1080] },
  { name: 'trees-silhouette', query: 'mode=silhouette', size: [1240, 400] },
  { name: 'elder-dusk', query: 'mode=elder&hour=18', size: [1440, 900] },
  { name: 'elder-dusk', query: 'mode=elder&hour=18', size: [390, 844] },
];

/** Opens one page, waits for its readiness, fails on any page or console error, and returns it. */
async function open(base, path, [width, height]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const { url, lineNumber } = message.location();
    const text = `${message.text() || 'console error'}${url ? ` (${url}:${lineNumber})` : ''}`;
    errors.push(text);
    console.error(text);
  });
  await page.goto(`${base}${path}`);
  await page.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
  const failure = await page.evaluate(() => document.body.dataset.error);
  if (failure || errors.length) throw new Error(`Page failed: ${failure ?? ''}\n${errors.join('\n')}`);
  return page;
}

let server, browser, release;
const report = { views: {}, dressing, sizes: sizes.map(size => size.join('x')) };
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startBenchServer());
  console.log(`Bench: ${base}${server ? ' (started here)' : ''}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  if (args.includes('--trees')) {
    const trees = {}, only = option('--tree-shots')?.split(','), extra = option('--tree-query');
    for (const shot of TREE_SHOTS.filter(shot => !only || only.includes(shot.name))) {
      const page = await open(base, `/src/kingdom/ground-dressing/trees.html?${shot.query}${extra ? `&${extra}` : ''}`, shot.size);
      const path = `${out}/${shot.name}${extra ? '-subset' : ''}@${shot.size.join('x')}.png`;
      await page.screenshot({ path, timeout: 180_000 });
      trees[`${shot.name}@${shot.size.join('x')}`] = await page.evaluate(() => window.__chatdomTrees);
      console.log(`Captured ${path}`);
      await page.close();
    }
    // A `--tree-shots` run refreshes its own entries and keeps the others; a narrowed `--tree-query` run writes none.
    const kept = only ? JSON.parse(await readFile(`${out}/trees-stats.json`, 'utf8').catch(() => '{}')) : {};
    if (!extra) await writeFile(`${out}/trees-stats.json`, `${JSON.stringify({ ...kept, ...trees }, null, 2)}\n`);
  }
  for (const [width, height] of args.includes('--trees') ? [] : sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const { url, lineNumber } = message.location();
      const text = `${message.text() || 'console error'}${url ? ` (${url}:${lineNumber})` : ''}`;
      errors.push(text);
      console.error(text);
    });
    await page.goto(`${base}/src/kingdom/ground-dressing/bench.html?seed=willowmere&tier=town&hour=${HOURS[hours[0]]}&view=${views[0]}&dressing=${dressing}`);
    await page.waitForFunction(() => window.__chatdomReady === true || !!document.body.dataset.error, null, { timeout: 600_000 });
    const failure = await page.evaluate(() => document.body.dataset.error);
    if (failure) throw new Error(`Bench failed: ${failure}\n${errors.join('\n')}`);
    for (const label of hours) {
      await page.evaluate(hour => window.__chatdomKingdom.hour(hour), HOURS[label]);
      for (const view of views) {
        await page.evaluate(name => window.__chatdomKingdom.view(name), view);
        await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        await page.waitForFunction(() => window.__chatdomKingdom.stats.lightingReady && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 300_000 });
        await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        if (errors.length) throw new Error(errors.join('\n'));
        const path = `${out}/${view}-${label}${dressing === 'off' ? '-bare' : ''}@${width}x${height}.png`;
        await page.screenshot({ path, timeout: 180_000 });
        const stats = await page.evaluate(() => ({ scene: { ...window.__chatdomKingdom.stats }, dressing: window.__chatdomKingdom.dressing?.stats() ?? null }));
        report.views[`${view}-${label}@${width}x${height}`] = stats;
        console.log(`Captured ${path} (scene draws ${stats.scene.drawCalls}, dressing ${JSON.stringify(stats.dressing)})`);
      }
    }
    report.plan = await page.evaluate(() => window.__chatdomKingdom.dressing ? { report: window.__chatdomKingdom.dressing.report, blockers: window.__chatdomKingdom.dressing.blockers, planMs: window.__chatdomKingdom.stats.planMs } : null);
    await page.close();
  }
  if (!args.includes('--trees')) await writeFile(`${out}/stats${dressing === 'off' ? '-bare' : ''}.json`, `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
