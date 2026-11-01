// Captures the growth sequence: stills at chosen seconds of the score, plus same-view before/after pairs.
//   node apps/web/src/growth/capture.mjs --only hut,cottage-street   # the lock is taken once per still
//   node apps/web/src/growth/capture.mjs --only hall --size 390x844
//   node apps/web/src/growth/capture.mjs --only none --frames 12 --part 0   # frame 0 of the whole run in 12
//   node apps/web/src/growth/capture.mjs --base-url http://127.0.0.1:5190/-/growth
// Without --base-url it serves this checkout on an OS-assigned capture port for the duration of the run.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { clearTimeout } from 'node:timers';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const only = option('--only')?.split(',');
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/growth`;
/** The longest this script may hold the shared capture lock. */
const HOLD_LIMIT = 240_000;

// Seconds are resolved against the score in the page: `act:<kind>[:index]@<offset>` or `end`.
const SHOTS = [
  { name: 'open', at: 'act:open@4.6' },
  { name: 'hut-raising', at: 'act:grow:0@5.2' },
  { name: 'hut', at: 'act:grow:0@end' },
  { name: 'cottage-scaffold', at: 'act:grow:1@3.6' },
  { name: 'house-building', at: 'act:grow:2@5.0' },
  { name: 'house-warming', at: 'act:grow:2@end' },
  { name: 'manor-building', at: 'act:grow:3@5.2' },
  { name: 'hall-warming', at: 'act:grow:4@end' },
  { name: 'street', at: 'act:rise@end' },
  { name: 'quarter-streets', at: 'act:quarter@6' },
  { name: 'quarter-rising', at: 'act:quarter@10.5' },
  { name: 'quarter-lit', at: 'act:quarter@end' },
  // The checkpoint pair: the same camera across the lane, in the same light, before and after the cottage.
  { name: 'hut-street', at: 'act:grow:0@end', view: 'street' },
  { name: 'cottage-street', at: 'act:grow:1@end', view: 'street' },
  { name: 'before-close', at: 'act:open@4.6', view: 'close' },
  { name: 'after-close', at: 'end', view: 'close' },
  { name: 'before-wide', at: 'act:rise@end', view: 'wide' },
  { name: 'after-wide', at: 'end', view: 'wide' },
].filter(shot => !only || only.includes(shot.name));
// `--frames N` adds N evenly spaced frames across the whole score: the sequence as one continuous run.
const frames = Number(option('--frames') ?? 0);
if (!Number.isInteger(frames) || frames < 0 || frames === 1 || frames > 48) throw new Error('--frames takes 0 or 2 to 48.');
// `--part k` takes one frame of the N.
const part = option('--part') === undefined ? null : Number(option('--part'));
for (let i = 0; i < frames; i++) if (part === null || i === part) SHOTS.push({ name: `sequence/${String(i).padStart(2, '0')}`, at: `frame:${i}/${frames - 1}` });

let server, browser, release, enforcer;
// Never leave the enforcer behind to signal a process ID that may since have been reused.
process.on('exit', () => { enforcer?.kill(); });
try {
  if (!SHOTS.length) throw new Error('No growth shot matches --only or --frames.');
  if (frames) await mkdir(`${output}/sequence`, { recursive: true });
  let url = option('--base-url');
  if (!url) {
    const port = assertCapturePort(0, { allowZero: true, name: 'Growth capture port' });
    server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, optimizeDeps: { entries: ['src/growth/bench.html'] } });
    await server.listen();
    const address = server.httpServer.address();
    url = `http://127.0.0.1:${address.port}/src/growth/bench.html`;
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
  const started = Date.now();
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}seed=hearthmoor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomGrowthError === 'string', {}, { timeout: 600_000 });
  const failed = await page.evaluate(() => window.__chatdomGrowthError ?? null);
  if (failed) throw new Error(failed);
  console.log(`Growth stage ready in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  // Everything expensive happens before the shared lock: the stage loads and meshes once, then each shot is sought,
  // its shaders compiled, its light fields solved and its frame drawn into the preserved canvas. The bench draws
  // nothing while paused, so each lock covers only checks and reading back a picture that already exists, and it is
  // given back before the next shot is drawn: one still per acquisition. On a loaded host a single SwiftShader frame
  // at 1080p has taken minutes; none of that time may be spent holding the lock.
  for (const shot of SHOTS) {
    const t0 = Date.now();
    const result = await page.evaluate(async ({ at, view }) => {
      const control = window.__chatdomGrowth, frame = /^frame:(\d+)\/(\d+)$/.exec(at);
      if (frame) return control.seek(control.report().duration * Number(frame[1]) / Math.max(1, Number(frame[2])) - (frame[1] === frame[2] ? .01 : 0));
      return control.seekTo(at, view ?? null);
    }, shot);
    // Reading one pixel back makes the software GPU finish the frame now, rather than inside the locked screenshot.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas.growth-canvas'), gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    });
    const label = `${shot.name}@${width}x${height}`;
    if (errors.length) throw new Error(`${label}: ${errors.join('\n')}`);
    if (result.origin !== 'SIMULATED' || !(await page.locator('.growth-seal').innerText()).includes('SIMULATED')) throw new Error(`${label}: the history must be labelled SIMULATED.`);
    const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - window.innerWidth, y: document.documentElement.scrollHeight - window.innerHeight }));
    if (overflow.x > 0 || overflow.y > 0) throw new Error(`${label}: the page overflows by ${overflow.x}×${overflow.y}px.`);
    console.log(`${label} drawn · t=${result.t.toFixed(2)} ${result.act} · ${result.heroShown} · lit quarter ${result.quarterHomesLit} · ${result.drawCalls} draws · light ${result.lightingSettled ? 'settled' : 'UNSETTLED'} · ${((Date.now() - t0) / 1000).toFixed(1)} s · ${result.caption}`);

    release = await acquireCaptureLock();
    const held = Date.now();
    const watchdog = setTimeout(() => {
      console.error(`Gave the capture lock back after ${HOLD_LIMIT / 1000} s without finishing.`);
      void release?.().finally(() => process.exit(2));
    }, HOLD_LIMIT);
    // A frame stuck in software WebGL can starve this process's event loop, so the limit is also enforced from
    // outside: killing this process closes the lock guard's pipe, which gives the lock back.
    enforcer = spawn('sh', ['-c', `sleep ${HOLD_LIMIT / 1000 + 15}; kill -9 ${process.pid}`], { stdio: 'ignore', detached: true });
    enforcer.unref();
    const still = await page.evaluate(() => window.__chatdomGrowth.report());
    if (Math.abs(still.t - result.t) > 1e-6 || still.playing) throw new Error(`${label}: the drawn frame moved before it was read.`);
    await page.screenshot({ path: `${output}/${label}.png`, timeout: 180_000 });
    clearTimeout(watchdog); enforcer.kill(); enforcer = undefined;
    const done = release; release = undefined; await done();
    console.log(`${label} written · held the capture lock for ${((Date.now() - held) / 1000).toFixed(0)} s`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await server?.close(); } finally { await release?.(); }
  }
}
