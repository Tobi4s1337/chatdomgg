// Forge ritual presentation captures. Run from the repository root after `pnpm build`:
//   node apps/web/src/forge-ritual-bench/capture.mjs [--base-url http://127.0.0.1:5176]
//   node apps/web/src/forge-ritual-bench/capture.mjs --at 8,12.4 [--size 390x844] [--query part=lantern]
// The second form only shoots the given ritual seconds into /tmp/chatdom-forge-ritual for quick review.
// Holds the shared host capture lock before any preview or browser starts, and releases it in `finally`.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { URL, URLSearchParams } from 'node:url';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const argBase = arg('--base-url'), at = arg('--at');
const OUT = at ? '/tmp/chatdom-forge-ritual' : 'shots/forge-ritual';
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
  const tile = (pattern, out, columns, rows) => {
    const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', pattern, '-vf', `scale=360:225,tile=${columns}x${rows}:padding=0`, '-frames:v', '1', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr); report.shots.push(out);
  };
  const crop = (input, out, w, h, x, y) => {
    const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vf', `crop=${w}:${h}:${x}:${y}`, out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr); report.shots.push(out);
  };

  if (at) {
    const [width, height] = (arg('--size') ?? '1440x900').split('x').map(Number);
    const query = new URLSearchParams('part=chimney&family=hearth&hour=19.5&t=0');
    for (const [key, value] of new URLSearchParams(arg('--query') ?? '')) query.set(key, value);
    const page = await open(query.toString(), { width, height });
    for (const t of at.split(',').map(Number)) { const state = await seek(page, t); await shoot(page, `at-${t}`); console.log(JSON.stringify(state)); }
    await page.close();
  } else {
    await rm(`${OUT}/sheet`, { recursive: true, force: true }); await mkdir(`${OUT}/sheet`, { recursive: true });
    // Desktop dusk: one frame per stage, with the ownership facts the bench reports.
    const desk = await open('part=chimney&family=hearth&hour=19.5&t=0', { width: 1440, height: 900 });
    const stages = [['words', 1.7], ['blueprint', 4.4], ['pour', 8], ['seal', 11.9], ['strike', 12.42], ['cool', 13.6], ['flight', 17.2], ['landed', 19.8]];
    for (const [name, t] of stages) {
      const state = await seek(desk, t); await shoot(desk, name);
      assert.equal(state.phase, name, `${t} s presents ${name}`);
      assert.equal(state.pieceShown, ['cool', 'flight', 'landed'].includes(name), `${name}: the clone is shown only once it has been struck`);
      assert.ok(state.draws <= 40, `${name}: ${state.draws} draws in the whole bench frame`);
    }
    report.checks.push('Eight stages presented in order; the clone stays hidden until it cools on the anvil');
    const cleared = await desk.evaluate(() => window.__chatdomForgeRitual.clear()); await settle(desk); await shoot(desk, 'cleared');
    assert.deepEqual(cleared.shown, []); assert.equal(cleared.pieceShown, true, 'clear restores the borrowed clone visibility');
    report.checks.push('Clear removes every owned effect and restores the clone');

    // A timed contact sheet through all eight stages, shot at full desktop size so the controls stay small.
    const times = [.8, 2.2, 3.8, 4.8, 6.5, 9, 10.8, 11.5, 12.0, 12.42, 13.2, 14.6, 16.2, 17.6, 18.9, 20.2];
    for (const [i, t] of times.entries()) { await seek(desk, t); await desk.screenshot({ path: `${OUT}/sheet/${String(i).padStart(2, '0')}.png`, timeout: 180_000 }); }
    tile(`${OUT}/sheet/%02d.png`, `${OUT}/stages@1440x900.png`, 4, 4);
    await desk.close();

    // Observed gates that never resolve: the blueprint and the seal each hold thirty seconds without moving on.
    for (const [name, gate, phase] of [['pending-blueprint', 5, 'blueprint'], ['pending-seal', 12.2, 'seal']]) {
      const page = await open(`part=chimney&family=hearth&hour=19.5&t=${gate}&gate=${gate}`, { width: 1440, height: 900 });
      const start = await page.evaluate(() => window.__chatdomForgeRitual.report()); await shoot(page, `${name}-0s`);
      const held = await seek(page, gate + 30); await shoot(page, `${name}-30s`);
      for (const state of [start, held]) {
        assert.equal(state.phase, phase); assert.equal(state.pieceShown, false);
        assert.ok(!state.shown.includes('forge-flash') && !state.shown.includes('forge-crucible'), `${name}: nothing strikes or pours while held: ${state.shown}`);
        if (phase === 'blueprint') assert.ok(!state.shown.includes('forge-seal') && !state.shown.includes('forge-hammer'), `${name}: no seal or hammer: ${state.shown}`);
      }
      assert.ok(held.held >= 29.9, `${name} held thirty seconds`);
      report.checks.push(`${name}: held ${held.held.toFixed(1)} s at ${phase}; no strike, flash or arrival; clone hidden`);
      await page.close();
    }

    // Phone and stream framings, with close crops of the pour, strike and arrival.
    const phone = await open('part=chimney&family=hearth&hour=19.5&t=8', { width: 390, height: 844 });
    for (const [name, t] of [['pour', 8], ['seal', 11.9], ['strike', 12.42], ['cool', 13.6], ['flight', 17.2], ['landed', 19.8]]) { await seek(phone, t); await shoot(phone, name); }
    await phone.close();
    const stream = await open('part=chimney&family=hearth&hour=19.5&t=8', { width: 1920, height: 1080 });
    for (const [name, t] of [['pour', 8], ['strike', 12.42], ['cool', 14.2], ['flight', 17.2], ['landed', 19.3]]) { await seek(stream, t); await shoot(stream, name); }
    crop(`${OUT}/pour@1920x1080.png`, `${OUT}/close-pour@760x760.png`, 760, 760, 700, 120);
    crop(`${OUT}/strike@1920x1080.png`, `${OUT}/close-strike@760x760.png`, 760, 760, 700, 120);
    crop(`${OUT}/landed@1920x1080.png`, `${OUT}/close-arrival@760x760.png`, 760, 760, 580, 160);
    await stream.setViewportSize({ width: 1280, height: 720 }); await settle(stream);
    for (const [name, t] of [['seal', 11.9], ['cool', 13.6]]) { await seek(stream, t); await shoot(stream, name); }
    await stream.close();

    // Another part and kit, a midday strike, and the reduced-motion ceremony chosen by the system preference.
    const lantern = await open('part=lantern&family=tide&hour=19.5&t=12.42', { width: 1440, height: 900 });
    await shoot(lantern, 'lantern-strike'); await seek(lantern, 19.8); await shoot(lantern, 'lantern-landed'); await lantern.close();
    const midday = await open('part=weathervane&family=grove&hour=12.5&t=8', { width: 1440, height: 900 });
    await shoot(midday, 'midday-pour'); await seek(midday, 12.42); await shoot(midday, 'midday-strike'); await midday.close();
    const reduced = await open('part=chimney&family=hearth&hour=19.5&t=8', { width: 1440, height: 900 }, { reducedMotion: 'reduce' });
    assert.equal((await reduced.evaluate(() => window.__chatdomForgeRitual.report())).reduced, true, 'system reduced motion is honoured');
    for (const [name, t] of [['reduced-pour', 8], ['reduced-strike', 12.42], ['reduced-dissolve', 16.4], ['reduced-settle', 18.3], ['reduced-landed', 19.8]]) {
      const state = await seek(reduced, t); await shoot(reduced, name);
      assert.ok(!state.shown.includes('forge-flash'), `${name}: no flash with reduced motion`);
    }
    await reduced.close();
    report.checks.push('Reduced motion follows prefers-reduced-motion: no flash, no streak, a dissolve and settle home');
  }

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
