// Forge ritual presentation captures. Run from the repository root after `pnpm build`:
//   node apps/web/src/forge-ritual-bench/capture.mjs [--base-url http://127.0.0.1:5176]
// Holds the shared host capture lock before any preview or browser starts, and releases it in `finally`.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const OUT = 'shots/forge-ritual';
const argBase = (() => { const i = process.argv.indexOf('--base-url'); return i > 0 ? process.argv[i + 1] : null; })();
const report = { port: null, checks: [], errors: [], shots: [] };

/** 5190 is main's preview and 5193/5194 are reserved services; the rest of 5170–5199 is shared. */
async function freePort() {
  for (let port = 5175; port <= 5199; port++) {
    if ([5190, 5191, 5192, 5193, 5194].includes(port)) continue;
    const free = await new Promise(resolve => { const s = createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true))).listen(port, '127.0.0.1'); });
    if (free) return port;
  }
  throw new Error('No free capture port in 5170–5199.');
}

const release = await acquireCaptureLock();
let server, browser;
try {
  let base = argBase;
  if (!base) {
    if (!existsSync('apps/web/dist/index.html')) throw new Error('Run `pnpm build` first; the capture previews the built app.');
    process.env.CHATDOM_SHOT_PORT = String(await freePort());
    const preview = await startCapturePreview();
    server = preview.server; base = preview.base;
  }
  report.port = new URL(base).port;
  console.log(`[forge-ritual] capturing from ${base}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(`${OUT}/sheet`, { recursive: true });

  async function open(query, viewport, media = {}) {
    const page = await browser.newPage({ viewport });
    await page.emulateMedia({ reducedMotion: 'no-preference', ...media });
    page.on('pageerror', e => report.errors.push(`${query}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(`${query}: ${m.text()}`); });
    page.on('worker', worker => worker.on('error', e => report.errors.push(`${query} worker: ${e.message ?? e}`)));
    await page.goto(`${base}/-/forge-ritual?${query}`);
    await page.waitForFunction(() => window.__chatdomReady || window.__chatdomForgeRitualError, null, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomForgeRitualError);
    if (failure) throw new Error(`Bench failed: ${failure}`);
    return page;
  }
  const settle = page => page.evaluate(() => new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r))));
  const seek = async (page, t) => { const state = await page.evaluate(t => window.__chatdomForgeRitual.seek(t), t); await settle(page); return state; };
  const shoot = async (page, name) => {
    const { width, height } = page.viewportSize(), path = `${OUT}/${name}@${width}x${height}.png`;
    await page.screenshot({ path, timeout: 180_000 }); report.shots.push(path); return path;
  };

  // Desktop dusk: each finished stage, then the pending blueprint hold.
  const desk = await open('part=chimney&family=hearth&hour=19.5&t=0', { width: 1440, height: 900 });
  for (const [name, t] of [['words', 1.7], ['words-gather', 2.75], ['blueprint', 3.9], ['blueprint-drawn', 4.75]]) {
    const state = await seek(desk, t); await shoot(desk, name);
    assert.equal(state.pieceShown, false, `${name}: the clone stays hidden until molten metal fills it`);
  }
  const pending0 = await seek(desk, 5), shot0 = await shoot(desk, 'pending-0s');
  const pending30 = await seek(desk, 35), shot30 = await shoot(desk, 'pending-30s');
  for (const state of [pending0, pending30]) {
    assert.equal(state.phase, 'blueprint'); assert.equal(state.pieceShown, false);
    assert.deepEqual(state.shown.filter(n => !['forge-blueprint', 'forge-motes'].includes(n)), [], `pending blueprint shows only the blueprint and calm motes: ${state.shown}`);
  }
  assert.ok(pending30.held >= 29.9, 'held thirty seconds at the blueprint');
  report.checks.push(`Pending blueprint held ${pending30.held.toFixed(1)} s: phase stayed blueprint, clone hidden, no seal or strike drawn (${shot0}, ${shot30})`);
  const cleared = await desk.evaluate(() => window.__chatdomForgeRitual.clear()); await settle(desk); await shoot(desk, 'cleared');
  assert.deepEqual(cleared.shown, []); assert.equal(cleared.pieceShown, true, 'clear restores the borrowed clone visibility');
  report.checks.push('Clear removes every owned effect and restores the clone');

  // Timed contact sheet through the finished stages.
  await desk.setViewportSize({ width: 720, height: 450 }); await settle(desk);
  const times = [.3, .8, 1.3, 1.8, 2.3, 2.8, 3.2, 3.6, 4.1, 4.6];
  for (const [i, t] of times.entries()) { await seek(desk, t); await desk.screenshot({ path: `${OUT}/sheet/${String(i).padStart(2, '0')}.png`, timeout: 180_000 }); }
  const sheet = `${OUT}/stages@1440x900.png`;
  const tile = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', `${OUT}/sheet/%02d.png`, '-vf', 'scale=360:225,tile=5x2:padding=0', '-frames:v', '1', sheet], { encoding: 'utf8' });
  assert.equal(tile.status, 0, tile.stderr); report.shots.push(sheet);
  await desk.close();

  // Phone and stream framings.
  const phone = await open('part=chimney&family=hearth&hour=19.5&t=1.7', { width: 390, height: 844 });
  await shoot(phone, 'words'); await seek(phone, 4.4); await shoot(phone, 'blueprint'); await seek(phone, 35); await shoot(phone, 'pending-30s');
  await phone.close();
  const stream = await open('part=chimney&family=hearth&hour=19.5&t=4.4', { width: 1920, height: 1080 });
  await shoot(stream, 'blueprint'); await stream.setViewportSize({ width: 1280, height: 720 }); await settle(stream); await seek(stream, 2.2); await shoot(stream, 'words');
  await stream.close();

  // A smaller part, and the reduced-motion presentation chosen by the system preference.
  const lantern = await open('part=lantern&family=tide&hour=19.5&t=4.6', { width: 1440, height: 900 });
  await shoot(lantern, 'lantern-blueprint'); await lantern.close();
  const reduced = await open('part=chimney&family=hearth&hour=19.5&t=1.7', { width: 1440, height: 900 }, { reducedMotion: 'reduce' });
  assert.equal((await reduced.evaluate(() => window.__chatdomForgeRitual.report())).reduced, true, 'system reduced motion is honoured');
  await shoot(reduced, 'reduced-words'); await seek(reduced, 4.1); await shoot(reduced, 'reduced-blueprint');
  await reduced.close();
  report.checks.push('Reduced motion follows prefers-reduced-motion');

  assert.deepEqual(report.errors, []);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release();
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
