// Stills of the staged pier on the review bench, stepped on its paused clock so each beat is exact.
/* global requestAnimationFrame:readonly */
// Usage: node work/lanes/pier/play-capture.mjs [--sizes=1440x900,390x844] [--only=rest,draw,...] [--view=play|bag|ui]
import { createServer as createProbe } from 'node:net';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { preview as startPreview } from 'vite';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const root = process.cwd(), output = resolve(root, process.env.PIER_SHOTS ?? 'shots/pier');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sizes = (arg('sizes') ?? '1440x900').split(',').map(size => size.split('x').map(Number));
const only = arg('only')?.split(',');
const extra = arg('query') ?? '';
const view = arg('view') ?? 'play';
const hour = arg('hour') ?? '18.6';
const finished = Symbol('finished');
// Beats nobody asked to see are stepped without drawing, so a late still holds the shared lock for seconds, not minutes.
const wants = (...names) => !only || names.some(name => only.includes(name));
const HIDDEN = 1e9;

async function portFree(port) {
  const probe = createProbe();
  try {
    await new Promise((ready, reject) => { probe.once('error', reject); probe.listen(port, '0.0.0.0', ready); });
    await new Promise(ready => probe.close(ready)); return true;
  } catch (error) { if (error.code === 'EADDRINUSE') return false; throw error; }
}
let port = 0;
for (const candidate of [5184, 5185, 5186, 5188, 5189, 5198, 5199, ...Array.from({ length: 14 }, (_, i) => 5170 + i)]) { assertCapturePort(candidate); if (await portFree(candidate)) { port = candidate; break; } }
if (!port) throw new Error('No safe capture port is free.');
const bytes = await readFile(process.env.PIER_FOUNDED_SCENE ?? '/tmp/chatdom-pier-founded/scene.json');
const scene = JSON.parse(bytes), sceneHash = createHash('sha256').update(bytes).digest('hex');
const receipt = { version: 1, kingdomId: scene.kingdomId, origin: scene.origin, layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash };
console.log(`Dev server ${port}; checked free.`);
// Serves a build made beforehand: nice -n 10 npx vite build apps/web --outDir /tmp/chatdom-pier-play-dist
const dist = process.env.PIER_PLAY_DIST ?? '/tmp/chatdom-pier-play-dist';
const server = await startPreview({ root: resolve(root, 'apps/web'), logLevel: 'error', build: { outDir: dist }, preview: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{ name: 'pier-read-only-copy', configurePreviewServer(host) {
    host.middlewares.use((request, response, next) => {
      if (request.url === `/api/realm/founded/${scene.kingdomId}`) { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(receipt)); }
      else if (request.url === `/api/realm/founded/scenes/${sceneHash}`) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(bytes); }
      else next();
    });
  } }] });
let release, browser;
try {
  release = await acquireCaptureLock();
  const started = Date.now();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const url = `http://127.0.0.1:${port}/-/pier?view=${view}&kingdom=${scene.kingdomId}&hour=${hour}&software=1&seed=7&hold=1${extra ? `&${extra}` : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(view => (view === 'ui' ? window.__chatdomReady : window.__chatdomPier?.stats.ready) || window.__chatdomPierError, view, { timeout: 180_000 });
    const failure = await page.evaluate(() => window.__chatdomPierError);
    if (failure) throw new Error(failure);
    const shoot = async name => {
      if (only && !only.includes(name)) return;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const path = resolve(output, `pi10-${view}-${name}-${hour}@${width}x${height}.png`);
      await page.screenshot({ path });
      const stats = await page.evaluate(() => ({ state: window.__chatdomPier?.play?.state(), layer: window.__chatdomPier?.play?.stats(), calls: window.__chatdomPier?.stats.calls, triangles: window.__chatdomPier?.stats.triangles }));
      console.log(`${path.replace(root + '/', '')} ${JSON.stringify(stats)}`);
      // Holding the shared lock only as long as the stills asked for: stop once the last one is taken.
      if (only && name === only.at(-1)) throw finished;
    };
    if (view !== 'play') { try { await shoot('still'); } catch (error) { if (error !== finished) throw error; } await page.close(); continue; }
    try {
    const play = (method, ...args) => page.evaluate(([method, args]) => window.__chatdomPier.play[method](...args), [method, args]);
    const state = () => play('state'), phase = async () => (await play('stats')).phase;
    // A hidden step still lets real time pass: the bench's room ticks on real 50 ms timers, as the realm does.
    const advance = async (ms, every) => {
      if (every !== HIDDEN) return play('advance', ms, every);
      for (let left = ms; left > 0; left -= 50) { await play('advance', Math.min(50, left), HIDDEN); await page.waitForTimeout(55); }
    };
    const until = async (test, step = 100, limit = 30_000, every = 1) => { for (let spent = 0; spent < limit; spent += step) { if (await test()) return true; await advance(step, every); } return false; };
    await play('pause', true);
    await until(async () => (await state()).rod, 50, 3000);
    await advance(400, wants('rest') ? 1 : HIDDEN);
    await shoot('rest');
    await play('press'); await advance(900, wants('draw') ? 1 : HIDDEN);
    await shoot('draw');
    await play('release'); await advance(300, wants('flight') ? 1 : HIDDEN);
    await shoot('flight');
    await advance(700, wants('float') ? 1 : HIDDEN);
    await shoot('float');
    await until(async () => (await state()).cast === 'bite', 400, 30_000, wants('float', 'bite') ? 8 : HIDDEN);
    await advance(150, wants('bite') ? 1 : HIDDEN);
    await shoot('bite');
    await play('press');
    for (let step = 0; step < 900; step++) {
      const now = await page.evaluate(() => window.__chatdomPier.play.state());
      if (now.cast !== 'fighting' && step > 4) break;
      const fight = await page.evaluate(() => window.__chatdomPier.play.fight?.());
      if (fight && (fight.phase === 'run' || fight.tension > 6500)) await play('release'); else await play('press');
      await advance(50, wants('fight', 'fight-side') ? 8 : HIDDEN);
      if (step === 50) { await shoot('fight'); await play('camera', 'side'); await shoot('fight-side'); await play('camera', 'shoulder'); }
    }
    await until(async () => (await phase()) === 'leaping', 50, 6000);
    await play('advance', 450);
    await shoot('leap');
    await until(async () => (await phase()) === 'landed', 50, 3000);
    // The tag runs on real time; shoot it soon after the fish lands.
    await play('advance', 200);
    await shoot('tag');
    } catch (error) { if (error !== finished) throw error; }
    if (errors.length) console.error(errors.join('\n'));
    await page.close();
  }
  console.log(`Held the capture lock ${Math.round((Date.now() - started) / 1000)} s.`);
} finally {
  await browser?.close();
  await release?.();
  await new Promise(done => server.httpServer.close(done));
}
