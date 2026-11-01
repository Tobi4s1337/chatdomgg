/* global requestAnimationFrame:readonly, URLSearchParams:readonly */
// Captures a cheer over the stream's own picture of the real town (SIMULATED source). Each still takes the shared
// host capture lock on its own: one owned Vite server and one Chromium open the stream bench (`?stage=stream`) for the
// rung, rest on the town, step through the beat to the still and shoot it; both close and the lock is released before
// the next still, so main and the other lanes capture between this run's frames.
//   node apps/web/src/twitch-moments-bench/sky-capture.mjs --rung skyfire [--beats rest,aurora] [--tag after] [--wired] [--size 1920x1080] [--port 5198]
//   node apps/web/src/twitch-moments-bench/sky-capture.mjs --ladder --wired [--rungs skyfire,kites]   (each rung at its high point, one row)
// --before serves the committed sky light layer (HEAD), for the before of a before/after.
// --wired previews main's side of the seam (the town's light, the stream's captions) from wiring.mjs, in memory only.
// Frames land in shots/sky-moments/<rung>-<beat>[-<tag>]@<w>x<h>.png; a row per run in shots/sky-moments/row-<rung>[-<tag>]@<w>x<h>.png.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { wiringPreview } from './wiring.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5198);
assertCapturePort(port, { name: '--port' });
const rung = option('--rung') ?? 'skyfire', tag = option('--tag'), hour = option('--hour'), wired = args.includes('--wired'), before = args.includes('--before');
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
/** Each rung's beats, ms after the cheer arrives: `rest` is the town just before it. */
const BEATS = {
  spark: [['rest', -500], ['rise', 1300], ['peak', 2400], ['fade', 3700]],
  'street-fireworks': [['rest', -500], ['launch', 1500], ['burst', 3500], ['willow', 5600]],
  'castle-volley': [['rest', -500], ['launch', 1700], ['burst', 4300], ['fade', 8200]],
  hearthbeast: [['rest', -500], ['enter', 2600], ['overhead', 4800], ['exit', 8400]],
  skyfire: [['rest', -500], ['hush', 1800], ['aurora', 3600], ['name', 7600], ['procession', 11200], ['return', 21000]],
  kites: [['rest', -500], ['rise', 3000], ['sway', 9000], ['drift', 15500]],
};
/** --ladder: the whole cheer ladder at its high point, one rung after another over the same picture. */
const LADDER = [['spark', 'peak'], ['street-fireworks', 'burst'], ['castle-volley', 'burst'], ['hearthbeast', 'overhead'], ['skyfire', 'name'], ['kites', 'sway']];
const ladder = args.includes('--ladder');
if (!ladder && !BEATS[rung]) throw new Error(`--rung must be one of ${Object.keys(BEATS).join(', ')}`);
const only = option('--beats')?.split(',');
const rungs = option('--rungs')?.split(',');
const runs = ladder
  ? LADDER.filter(([r]) => !rungs || rungs.includes(r)).map(([r, beat]) => ({ rung: r, beats: BEATS[r].filter(([b]) => b === beat) }))
  : [{ rung, beats: BEATS[rung].filter(([beat]) => !only || only.includes(beat)) }];
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/sky-moments`;
const name = (r, beat) => `${output}/${r}-${beat}${tag ? `-${tag}` : ''}@${width}x${height}.png`;

/**
 * --before: the sky as it was before this lane's work, for a before/after of the same view. Serves the committed
 * sky light layer (git HEAD) in place of the working one, in memory only; everything else is today's tree.
 */
function committedSky() {
  const file = 'apps/web/src/twitch-moments/sky-light-view.ts';
  const committed = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' });
  return { name: 'sky-moments-before', enforce: 'pre', load(id) { return id.split('?')[0].endsWith(file) ? committed : null; } };
}

/** Transforms the bench's whole module graph once on the server, so dependency discovery settles before Chrome asks. */
async function warm(server, entry) {
  const seen = new Set();
  const visit = async url => {
    if (seen.has(url)) return;
    seen.add(url);
    await server.transformRequest(url);
    const mod = await server.moduleGraph.getModuleByUrl(url);
    for (const next of mod?.importedModules ?? []) if (next.url.startsWith('/src') || next.url.startsWith('/@fs')) await visit(next.url);
  };
  await visit(entry);
}

const started = Date.now(), log = message => console.log(`[sky ${((Date.now() - started) / 1000).toFixed(0)}s] ${message}`);
const problems = [], row = [];

/**
 * One still under the shared host lock: its own Vite server and Chromium, the town opened fresh, the beat reached by
 * stepping from the cheer, one screenshot, then everything closed and the lock released before the next still, so
 * main and the other lanes can capture between this run's frames.
 */
async function still(rungName, beat, offset) {
  let server, browser, release;
  try {
    release = await acquireCaptureLock();
    log(`lock held (${rungName} ${beat})`);
    // --wired: main's files are served with the lane's wiring applied in memory (wiring.mjs), exactly as the patch reads.
    server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', plugins: [...(wired ? [wiringPreview()] : []), ...(before ? [committedSky()] : [])],
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    await server.listen();
    await warm(server, '/src/twitch-moments-bench/index.tsx');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await scope.newPage();
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', error => problems.push(error.message));
    const query = new URLSearchParams({ stage: 'stream', rung: rungName, at: '0', ...(hour ? { hour } : {}) });
    // A first visit can race the dependency optimiser (the repo-wide scan cannot pre-bundle everything), which reloads
    // under it and fails the bench's lazy import; the town is only judged once the page has loaded whole.
    for (let attempt = 0; ; attempt++) {
      const stale = new Promise(resolve => page.once('pageerror', error => { if (/dynamically imported module/.test(error.message)) resolve('stale'); }));
      await page.goto(`http://127.0.0.1:${port}/-/twitch-moments?${query}`, { waitUntil: 'domcontentloaded' });
      const outcome = await Promise.race([stale, page.waitForFunction(() => window.__chatdomSky?.ready() === true || window.__chatdomSky?.failed() === true, {}, { timeout: 600_000 })
        .then(() => page.evaluate(() => window.__chatdomSky.failed() ? 'failed' : 'ready'))]);
      if (outcome === 'ready') { log(`town ready (${rungName})`); break; }
      if (outcome === 'failed') throw new Error(`The kingdom could not open:\n${problems.join('\n')}`);
      log('stale first load; reloading');
      if (attempt >= 2) throw new Error('The stream bench did not load after the dependency optimiser settled.');
      problems.length = 0;
    }
    await page.evaluate(() => document.fonts.ready);
    // The seek steps in quarter seconds from the rest, so every cut and ease is seen as a viewer would.
    await page.evaluate(async at => { await window.__chatdomSky.seek(at); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, Math.max(0, offset));
    if (await page.evaluate(() => window.__chatdomSky.failed())) throw new Error(`The kingdom failed at ${beat}:\n${problems.join('\n')}`);
    await page.waitForTimeout(500);
    const path = name(rungName, beat);
    await page.screenshot({ path, timeout: 240_000 });
    row.push(path);
    console.log(`Captured ${rungName} ${beat}${tag ? ` (${tag})` : ''} @${width}x${height}`);
    await scope.close();
  } finally {
    try { await browser?.close(); } finally {
      try { await server?.close(); } finally { await release?.(); }
    }
  }
}

await mkdir(output, { recursive: true });
for (const run of runs) for (const [beat, offset] of run.beats) await still(run.rung, beat, offset);
if (row.length > 1 && (!ladder || !rungs)) {
  const H = 360, w = Math.round(width * H / height / 2) * 2, sheet = `${output}/row-${ladder ? 'ladder' : rung}${tag ? `-${tag}` : ''}@${width}x${height}.png`;
  const filter = row.map((_, i) => `[${i}:v]scale=${w}:${H}[t${i}]`).join(';') + `;${row.map((_, i) => `[t${i}]`).join('')}hstack=inputs=${row.length}[out]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...row.flatMap(p => ['-i', p]), '-filter_complex', filter, '-map', '[out]', sheet]);
  console.log(`Row ${sheet.slice(root.length)}`);
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
