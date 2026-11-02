// Captures the raid road (RR10): stills of each act and the whole journey as one sequence, at 1920×1080 by default.
// Run from the repo root after `pnpm build`:
//   node apps/web/src/raid-gate/road/capture.mjs [--stills] [--sequence] [--fps 8] [--size 1920x1080] [--reduced]
// The presentation clock is frozen (`capture=1`) and seeked frame by frame, so every frame is exact however slowly
// SwiftShader draws. Each frame waits for what it shows to be really drawn: the kingdom's light, the map's tiles, the
// destination's world. Uses the shared capture lock, one Chromium at a time. Private fixtures retain simulated origins without visible provenance chips.
import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../../packages/testing/preview.mjs';

const run = promisify(execFile);
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
// One still per lease: the gate gathering, the whole road, or the welcome.
const STILLS = ['gate', 'road', 'welcome'];
const only = arg('--only', 'welcome');
if (only !== null && !STILLS.includes(only)) throw new Error(`--only takes one of ${STILLS.join(', ')}`);
if (only && process.argv.includes('--sequence')) throw new Error('--only cannot be combined with --sequence');
const stills = process.argv.includes('--stills') || !process.argv.includes('--sequence');
const sequence = process.argv.includes('--sequence');
const reduced = process.argv.includes('--reduced');
const fps = Number(arg('--fps', '8'));
const [width, height] = arg('--size', '1920x1080').split('x').map(Number);
const OUT = 'shots/raid-road';
const tag = `${width}x${height}${reduced ? '-reduced' : ''}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const report = { size: tag, errors: [], stills: [], sequence: null };
let base = process.env.CHATDOM_RAID_GATE_URL, server, browser, page;
const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(20 * 60_000) });
const holdDeadline = setTimeout(() => { console.error('[capture] lease exceeded 20 minutes'); process.kill(-process.pid, 'SIGTERM'); }, 20 * 60_000);
try {
  if (!base) {
    for (const port of CAPTURE_PORTS) {
      process.env.CHATDOM_RAID_ROAD_PORT = String(port);
      try { ({ base, server } = await startCapturePreview('CHATDOM_RAID_ROAD_PORT')); break; }
      catch (error) { if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
    }
    if (!base) throw new Error('No safe capture port available');
  }
  console.log(`[capture] preview ${base}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(OUT, { recursive: true });
  page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  // The kingdoms' own moments (the destination's raid arrival) run on the page's Date.now; pin it to the presentation
  // clock so a seek moves them exactly as it moves the road, however long SwiftShader takes over a frame.
  const EPOCH = Date.UTC(2026, 10, 1, 19, 40);
  await page.clock.setFixedTime(EPOCH);
  const opened = Date.now();
  await page.goto(`${base}/-/raid-gate?bench=simulated&road=1&capture=1${reduced ? '&motion=reduced' : ''}`);
  await page.waitForFunction(() => (window.__chatdomReady === true && !!window.__raidRoad) || !!window.__raidRoad?.state().worldError, null, { timeout: 400_000 });
  await page.evaluate(() => document.fonts.ready);
  console.log(`[capture] the road is ready after ${((Date.now() - opened) / 1000).toFixed(1)}s`);
  // From here on the page draws only the frames the capture asks for.
  await page.evaluate(() => window.__raidRoad.frames.hold(true));
  const state = async () => {
    const s = await page.evaluate(() => window.__raidRoad.state());
    if (s.worldError || s.mapError) throw new Error(`Road error: ${s.worldError ?? s.mapError}${s.mapCause ? ` (${s.mapCause})` : ""}`);
    if (s.snapshot?.journey?.refusal) throw new Error(`Journey refused: ${JSON.stringify(s.snapshot.journey)}`);
    return s;
  };
  const spans = () => page.evaluate(() => window.__raidRoad.spans());

  /** Let the page draw `count` frames through the capture's frame gate, then hold it again. */
  const drawn = count => page.evaluate(n => window.__raidRoad.frames.frames(n), count);
  /** Let frames run freely (while something loads) or hold them (between pictures). */
  const hold = value => page.evaluate(v => window.__raidRoad.frames.hold(v), value);
  /** Wait for a condition on the route's state, letting frames run meanwhile: worlds and tiles load by drawing. */
  async function until(test, ms = 300_000) {
    let last = await state();
    if (test(last)) return;
    await hold(false);
    const deadline = Date.now() + ms;
    let nextLog = Date.now();
    while (!test(last) && Date.now() < deadline) {
      if (Date.now() >= nextLog) {
        console.log(`[capture] waiting: ${JSON.stringify(last)}`);
        nextLog = Date.now() + 30_000;
      }
      await sleep(200);
      last = await state();
    }
    await hold(true);
    if (!test(last)) throw new Error(`Timed out waiting for route state after ${ms} ms: ${JSON.stringify(last)}`);
  }
  const ON_MAP = ['rise', 'ride', 'hold', 'wake'];
  const drawnFor = s => (s.sourceReady && (!ON_MAP.includes(s.act) || s.mapSettled || s.mapError)
    && (!(s.act === 'wake' || s.act === 'welcome') || s.destReady));

  /**
   * Seek the presentation clock. Passing through, nothing is drawn: cues and facts only need the clock to move.
   * Otherwise wait until what this act shows is loaded, then draw `frames` frames.
   */
  async function seek(t, passing = false, frames = 2) {
    const began = Date.now();
    await page.clock.setFixedTime(EPOCH + Math.round(t * 1000));
    await page.evaluate(value => window.__raidRoad.seek(value), t);
    if (passing) return state();
    await until(drawnFor);
    if (frames > 0) await drawn(frames);
    const s = await state();
    if (Date.now() - began > 5000) console.log(`[seek] t=${t.toFixed(2)} ${s.act} took ${((Date.now() - began) / 1000).toFixed(1)}s`);
    return s;
  }
  /** Walk the clock forward to `t` in steps, so cues and facts happen in order, waiting for the destination in time. */
  async function walkTo(t, step = 0.5, settle = true) {
    let now = (await state()).t;
    while (now < t) {
      now = Math.min(t, now + step);
      const ride = (await spans()).find(span => span.act === 'ride');
      // The destination's world is drawn while the column rides; give it the real time it needs before arriving.
      if (ride && now >= ride.start + ride.length - 1) await until(s => s.destReady);
      await seek(now, !(settle && now >= t));
    }
  }

  // The Atlas reads the survey and draws its first view while the gate gathers; it says it is ready from a drawn frame.
  const mapDrawn = s => s.facts.mapReadyAt !== null || s.mapError !== null;
  await until(mapDrawn);
  const first = await state();
  if (first.mapError) throw new Error(`map: ${first.mapError}`);
  // The gathering takes its own facts (preview, joins, Twitch's countdown and witness) at fixed points on the clock.
  await walkTo(0.1);
  if (stills) {
    const take = async (name, t) => {
      if (t === null) { report.errors.push(`${name}: its act never began`); console.log(`skipped ${name}: its act never began`); return; }
      await walkTo(t, 0.5, false);
      const s = await seek(t);
      const path = `${OUT}/${name}@${tag}.png`;
      await page.screenshot({ path, timeout: 240_000 });
      report.stills.push({ name, path, t: s.t, act: s.act, progress: s.progress, holding: s.holding });
      console.log(`still ${name} t=${s.t.toFixed(2)} ${s.act} ${s.progress.toFixed(2)}`);
    };
    if (only === 'gate') {
      await take('1-gate-gathers', reduced ? 2.5 : 5.2);
    } else if (only === 'road') {
      await walkTo(reduced ? 4.1 : 9.1, 0.5, false);
      await until(s => s.facts.departedAt !== null);
      const all = await spans();
      const rise = all.find(span => span.act === 'rise');
      await walkTo((rise ? rise.start + rise.length : (await state()).t + 6) + 0.2, 0.5, false);
      const ride = (await spans()).find(span => span.act === 'ride');
      if (!ride) throw new Error('Ride act never began');
      await take('6-road-whole', ride.start + ride.length * 0.5);
    } else if (only === 'welcome') {
      // Facts come from asynchronous authority work; do not race the clock past them.
      await walkTo(reduced ? 4.1 : 9.1, 0.5, false);
      await until(s => s.facts.departedAt !== null);
      const departureFacts = (await state()).facts;
      const setoutAt = Math.max(reduced ? 4 : 9, departureFacts.departedAt);
      const riseAt = Math.max(setoutAt + (reduced ? 1 : 3.4), departureFacts.mapReadyAt);
      await walkTo(riseAt + (reduced ? 0.7 : 1.7), 0.5, false);
      console.log(`[capture] entered ride: ${JSON.stringify(await state())}`);
      const ride = (await spans()).find(span => span.act === 'ride');
      if (!ride) throw new Error('Ride act never began');
      await walkTo(ride.start + ride.length, 0.5, false);
      await until(s => s.facts.arrivedAt !== null && s.facts.welcomedAt !== null);
      const facts = (await state()).facts;
      // Reconstruct the director's minimum times without advancing past the
      // welcome frame (which would trigger later gift cues).
      const rideEnd = ride.start + ride.length;
      const welcomeStart = Math.max(Math.max(rideEnd, facts.arrivedAt) + (reduced ? 0.8 : 2.2), facts.welcomedAt);
      await take('9-welcome', welcomeStart + 2.4);
    } else {
    await take('1-gate-gathers', reduced ? 2.5 : 5.2);
    await take('2-countdown', reduced ? 3.4 : 7.6);
    let all = await spans();
    const at = (act, f) => { const span = all.find(each => each.act === act); return span ? span.start + span.length * f : null; };
    await walkTo((at('setout', 0) ?? 9) + 0.01);
    all = await spans();
    await take('3-setout', at('setout', 0.55));
    all = await spans();
    await take('4-rise', at('rise', 0.55));
    all = await spans();
    await take('5-road-leaves', at('ride', 0.12));
    await take('6-road-whole', at('ride', 0.5));
    await take('7-road-arrives', at('ride', 0.9));
    all = await spans();
    if (at('wake', 0) !== null) {
      await take('8-wake', at('wake', 0.5));
      all = await spans();
    }
    const welcome = all.find(each => each.act === 'welcome');
    if (welcome) {
      await take('9-welcome', welcome.start + 2.4);
      await take('10-gift', welcome.start + 7.5);
    }
    }
  }
  if (sequence) {
    // Start again from a fresh page, so the sequence is one take from the first frame.
    await page.goto(`${base}/-/raid-gate?bench=simulated&road=1&capture=1${reduced ? '&motion=reduced' : ''}`);
    await page.waitForFunction(() => window.__chatdomReady === true && !!window.__raidRoad, null, { timeout: 400_000 });
    await page.evaluate(() => document.fonts.ready);
    await until(mapDrawn);
    await hold(true);
    const dir = `${OUT}/frames-${tag}`;
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    let frame = 0, t = 0, end = Infinity;
    while (t <= end) {
      await walkTo(t, 1 / fps, false);
      // The map moves every frame; the kingdoms' cameras stand still, so their worlds are redrawn every fourth frame
      // while the tableaux, the board and the light over them change every frame.
      const act = (await state()).act;
      await seek(t, false, ON_MAP.includes(act) ? 2 : frame % 4 === 0 ? 1 : 0);
      await page.screenshot({ path: `${dir}/${String(frame).padStart(5, '0')}.png`, timeout: 240_000 });
      const welcome = (await spans()).find(each => each.act === 'welcome');
      if (welcome && end === Infinity) end = welcome.start + 10;
      frame++;
      t = frame / fps;
      if (frame % 20 === 0) console.log(`frame ${frame} t=${t.toFixed(2)} ${(await state()).act}`);
      if (t > 120) break;
    }
    const video = `${OUT}/raid-road@${tag}.mp4`;
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.png`, '-vf', 'scale=1920:-2,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-r', '24', video]);
    const sheet = `${OUT}/raid-road-sheet@${tag}.png`;
    const every = Math.max(1, Math.floor(frame / 24));
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${dir}/%05d.png`, '-vf', `select='not(mod(n\\,${every}))',scale=480:-1,tile=6x4`, '-frames:v', '1', sheet]);
    report.sequence = { frames: frame, fps, seconds: frame / fps, video, sheet };
  }
  report.result = report.errors.length ? 'errors' : 'passed';
} catch (error) {
  if (page) {
    try { await page.screenshot({ path: `${OUT}/failure@${tag}.png`, timeout: 30_000 }); console.log(`[capture] failure screenshot ${OUT}/failure@${tag}.png`); }
    catch (screenshotError) { console.error('[capture] failure screenshot unavailable:', screenshotError.message); }
  }
  throw error;
} finally {
  globalThis.clearTimeout(holdDeadline);
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release();
}
await writeFile(`${OUT}/report-${tag}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ result: report.result, errors: report.errors.slice(0, 8), stills: report.stills.length, sequence: report.sequence }, null, 2));
