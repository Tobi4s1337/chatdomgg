// Captures the Raid Gate's states at spec sizes (spec 23, Acceptance). Run from the repo root after `pnpm build`:
//   node apps/web/src/raid-gate/capture.mjs [--only name,name]
// Uses the shared capture lock, one Chromium at a time. Bench frames are SIMULATED and say so on screen.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../packages/testing/preview.mjs';

const DESKTOP = { width: 1440, height: 900 }, PHONE = { width: 390, height: 844 }, STREAM = { width: 1920, height: 1080 };
const FERN = '41000002', OAKEN = '41000003';
const FRAMES = [
  { name: 'gate-desktop', size: DESKTOP, query: `bench=simulated&pick=${FERN}&walkers=3`, expect: { phase: 'preview', optedIn: 3 } },
  { name: 'gate-phone', size: PHONE, query: `bench=simulated&viewer=walker&pick=${FERN}&walkers=4`, expect: { phase: 'gathering', optedIn: 4, joined: false } },
  { name: 'gate-joined-phone', size: PHONE, query: `bench=simulated&viewer=walker&pick=${FERN}&walkers=2&join=1`, expect: { phase: 'gathering', optedIn: 3, joined: true } },
  { name: 'gate-waiting-phone', size: PHONE, query: `bench=simulated&pick=${OAKEN}&walkers=1`, expect: { phase: 'preview', optedIn: 1 } },
  { name: 'gate-idle-desktop', size: DESKTOP, query: 'bench=simulated', expect: { phase: 'idle' } },
  { name: 'gate-finder-desktop', size: DESKTOP, query: 'bench=simulated', open: true, expect: { phase: 'choosing' } },
  { name: 'gate-quiet-phone', size: PHONE, query: 'bench=simulated&viewer=walker', expect: { phase: 'quiet' } },
  { name: 'authority-desktop', size: DESKTOP, query: 'bench=simulated&authority=not-connected', expect: { phase: 'authority', authority: 'not-connected' } },
  { name: 'authority-revoked-phone', size: PHONE, query: 'bench=simulated&authority=revoked', expect: { phase: 'authority', authority: 'revoked' } },
  { name: 'unbound-phone', size: PHONE, query: '', expect: { phase: 'unbound' } },
  { name: 'gate-preview-stream', size: STREAM, query: `bench=simulated&pick=${FERN}&walkers=5`, expect: { phase: 'preview', optedIn: 5 } },
  { name: 'gate-closed-stream', size: STREAM, query: `bench=simulated&viewer=walker&pick=${FERN}&walkers=4&join=1&close=1`, expect: { phase: 'quiet', optedIn: 0, joined: false } },
  { name: 'countdown-stream', size: STREAM, query: `bench=simulated&pick=${FERN}&walkers=4&join=1&start=1`, expect: { phase: 'countdown', state: 'pending', optedIn: 5, joined: true } },
  { name: 'departure-stream', size: STREAM, query: `bench=simulated&viewer=walker&pick=${FERN}&walkers=4&join=1&start=1&witness=1`, expect: { phase: 'departed', state: 'landed', optedIn: 5, joined: true } },
  { name: 'checking-phone', size: PHONE, query: `bench=simulated&pick=${FERN}&walkers=2&start=1&twitch=lose`, expect: { phase: 'checking', state: 'unknown' } },
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const report = { errors: [], frames: [] };
let base = process.env.CHATDOM_RAID_GATE_URL, server, browser;
const release = await acquireCaptureLock();
try {
  if (!base) ({ base, server } = await startCapturePreview());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir('shots/raid-gate', { recursive: true });
  for (const frame of FRAMES.filter(each => !only || only.includes(each.name))) {
    const page = await browser.newPage({ viewport: frame.size });
    page.on('pageerror', error => report.errors.push(`${frame.name}: ${error.message}`));
    await page.goto(`${base}/-/raid-gate${frame.query ? `?${frame.query}` : ''}`);
    await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomRaidGate?.ready === true, null, { timeout: 300_000 });
    if (frame.open) {
      await page.getByRole('button', { name: 'Choose where to ride' }).click();
      await page.waitForFunction(() => window.__chatdomRaidGate.snapshot().phase === 'choosing');
    }
    await page.evaluate(() => document.fonts.ready);
    const snapshot = await page.evaluate(() => window.__chatdomRaidGate?.snapshot() ?? null);
    for (const [key, value] of Object.entries(frame.expect)) assert.equal(snapshot?.[key], value, `${frame.name}: ${key}`);
    const simulated = await page.getByText('SIMULATED', { exact: false }).count();
    assert.ok(simulated > 0, `${frame.name}: SIMULATED must be visible`);
    const clipped = await page.evaluate(() => {
      const board = document.querySelector('.rg-board')?.getBoundingClientRect();
      return board ? board.left < 0 || board.top < 0 || board.right > window.innerWidth || board.bottom > window.innerHeight : false;
    });
    assert.equal(clipped, false, `${frame.name}: the gate board must fit the viewport`);
    const path = `shots/raid-gate/${frame.name}.png`;
    await page.screenshot({ path, timeout: 120_000 });
    report.frames.push({ name: frame.name, path, phase: snapshot?.phase, optedIn: snapshot?.optedIn });
    await page.close();
  }
  assert.deepEqual(report.errors, []);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.failure = String(error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release();
  await mkdir('shots/raid-gate', { recursive: true });
  await writeFile('shots/raid-gate/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
