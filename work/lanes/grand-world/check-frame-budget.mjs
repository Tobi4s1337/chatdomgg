// GW12's per-pass budget check: draw calls and triangles of the real stream on tobi4s_'s grand land, per render
// pass, at fixed poses, against spec 56's high budgets. Counts are exact on the software renderer (SwiftShader);
// its times are not performance evidence and are not reported.
//
//   node work/lanes/grand-world/check-frame-budget.mjs [--label after] [--hour 17.5] [--size 1920x1080] [--pc]
//
// --pc counts the same poses in Tobias's real-GPU Chrome instead (inside chatdom-pc-lease, with this lane's preview
// on 127.0.0.1:5192 and land server on 5191): the counts are the same, and the grand land settles in seconds rather
// than minutes. Only the page this run opens is closed.
//
// Under the shared capture lock: this lane's baked store behind its own read server and this branch's build in a
// vite preview, both on free capture ports; the founded receipt and scene are read from the live realm's public
// GET routes (nothing is written). The stream opens at the director's hero shot; the land must settle and the
// reflection's level-2 set fill in, then each pose is held and a few drawn frames are counted (frame-probe.mjs).
// Exit 1 when any pose exceeds a budget; the record is written either way.
/* global AbortSignal -- Node 22 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { preview as createPreview } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../packages/testing/capture-ports.mjs';
import { closeCapturePreview } from '../../../packages/testing/preview.mjs';
import { FRAME_PROBE_SOURCE, summariseProbe } from './frame-probe.mjs';

const { values } = parseArgs({ options: {
  label: { type: 'string', default: 'after' }, hour: { type: 'string', default: '17.5' }, size: { type: 'string', default: '1920x1080' },
  poses: { type: 'string', default: 'hero,door,forge,castle,pier,high' }, out: { type: 'string', default: 'work/evidence/grand-world' },
  pc: { type: 'boolean', default: false },
  // Also save a still of each pose (`<record>-<pose>.png`): the before/after comparison of the same views.
  stills: { type: 'boolean', default: false },
  // The pier pose recorded by an earlier run, for a build whose page does not offer it (the build before GW12).
  'pier-from': { type: 'string' },
  // Far land error in pixels instead of the high setting's own (evidence for the LOD target).
  detail: { type: 'string' },
  // The setting to measure: high against spec 56's gaming budgets, balanced or low against its everyday laptop ones.
  quality: { type: 'string', default: 'high' },
} });
/** Spec 56 "Budgets and acceptance measurements", gaming / high quality. */
export const HIGH = { frameDraws: 500, frameTriangles: 6_000_000, mainTriangles: 3_000_000 };
/** Spec 56, everyday laptop: what the balanced and low settings answer to. */
export const LAPTOP = { frameDraws: 300, frameTriangles: 2_000_000, mainTriangles: 1_500_000 };
if (!['high', 'balanced', 'low'].includes(values.quality)) throw new Error(`--quality must be high, balanced or low, not ${values.quality}`);
const BUDGET = values.quality === 'high' ? HIGH : LAPTOP, BUDGET_NAME = values.quality === 'high' ? 'high' : 'laptop';
const POSES = {
  hero: null,
  // Home 0 (Hearthward Lane) at its door, the Forge square toward the castle, and the castle approach (GW10 poses).
  door: { eye: [-58, 10.6, 24.5], target: [-46, 10.2, 21.5], fov: 52 },
  forge: { eye: [0, 11.2, 24], target: [0, 11.5, -8], fov: 52 },
  castle: { eye: [40, 21.7, -27], target: [0, 24, -44], fov: 52 },
  // The director's pier shot over the water: the reflection's whole land set in view.
  pier: 'pier',
  // A high orbit over the town toward the western range and the mere: the most land in one view.
  high: { eye: [180, 140, 160], target: [-60, 20, -40], fov: 45 },
};
const hour = Number(values.hour), [width, height] = values.size.split('x').map(Number);
const poses = values.poses.split(',');
for (const name of poses) assert.ok(Object.hasOwn(POSES, name), `unknown pose ${name}`);
const host = '127.0.0.1';
process.env.CHATDOM_REALM_TARGET = 'http://127.0.0.1:5197';
process.env.CHATDOM_API_TARGET = 'http://127.0.0.1:5196';
const directory = resolve(process.env.GRAND_LAND_STORE ?? 'shots/grand-world/land-bake-g3');
const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
const receipt = await (await fetch('http://127.0.0.1:5197/api/realm/founded/129634568', { signal: AbortSignal.timeout(5000) })).json();
const stem = `${values.out}/gw12-budget-${values.label}-${hour}@${width}x${height}`;
const report = { label: values.label, renderer: values.pc ? null : 'Chrome SwiftShader (counts only)', hour, viewport: { width, height }, receipt, budgets: BUDGET, budgetName: BUDGET_NAME, poses: {}, errors: [], passed: false };
let release, server, preview, browser, page;
async function listenFirst(bind, taken) {
  for (const port of CAPTURE_PORTS) {
    if (taken.includes(port)) continue;
    try { return { port, value: await bind(port) }; }
    catch (error) { if (error?.code !== 'EADDRINUSE' && !/already in use/i.test(String(error?.message))) throw error; }
  }
  throw new Error('No free capture port');
}
try {
  let base = 'http://localhost:5192';
  if (values.pc) {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 15_000 });
    page = await browser.contexts()[0].newPage();
    await page.setViewportSize({ width, height });
    await page.bringToFront();
  } else {
    release = await acquireCaptureLock({ signal: AbortSignal.timeout(900_000) });
    server = createLandReadServer(directory);
    const land = await listenFirst(port => new Promise((done, fail) => { server.once('error', fail); server.listen({ port, host, exclusive: true }, () => { server.off('error', fail); done(); }); }), []);
    process.env.CHATDOM_LAND_TARGET = `http://${host}:${land.port}`;
    const served = await listenFirst(port => createPreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', preview: { host, port, strictPort: true } }), [land.port]);
    preview = served.value; base = `http://${host}:${served.port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  }
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(FRAME_PROBE_SOURCE);
  const started = Date.now();
  await page.goto(`${base}/stream?source=realm&kingdom=${receipt.kingdomId}&hour=${hour}`, { timeout: 30_000 });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 300_000, polling: 1000 });
  report.readySeconds = Math.round((Date.now() - started) / 1000);
  if (values.pc) report.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'), e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  // The high budgets are for the high setting: the governor never moves a chosen quality.
  // A build from before GW12 has no governor and opens high at this width.
  report.quality = await page.evaluate(q => { const k = window.__chatdomKingdom; if (!k.setQuality) return 'high (ungoverned build)'; k.setQuality(q); return k.quality(); }, values.quality);
  if (values.detail) { report.landDetail = Number(values.detail); await page.evaluate(px => window.__chatdomKingdom.landDetail(px), report.landDetail); }
  const landState = () => page.evaluate(() => { const l = window.__chatdomKingdom?.inspect?.().land;
    return l && { phase: l.startupPhase, queued: l.queued, busy: l.busy, covered: l.covered, regions: l.regions, exact: l.exactRegions, reflection: l.reflectionMeshes, levels: l.displayedLevels }; });
  const progress = setInterval(() => { landState().then(state => console.log(`[land] ${Math.round((Date.now() - started) / 1000)} s ${JSON.stringify(state)}`)).catch(() => {}); }, 30_000);
  try {
    await page.waitForFunction(() => {
      const land = window.__chatdomKingdom?.inspect?.().land;
      // A build from before GW12 has no reflection set to wait for.
    return land?.startupPhase === 'settled' && land.queued === 0 && land.busy === 0 && (land.reflectionMeshes ?? Infinity) >= land.regions - land.exactRegions;
    }, null, { timeout: 600_000, polling: 1000 });
  } catch (error) { report.landAtTimeout = await landState().catch(() => null); throw error; }
  finally { clearInterval(progress); }
  report.settledSeconds = Math.round((Date.now() - started) / 1000);
  for (const name of poses) {
    const recordedPier = values['pier-from'] ? JSON.parse(await readFile(values['pier-from'], 'utf8')).poses?.pier?.pose ?? null : null;
    const pose = POSES[name] === 'pier' ? recordedPier ?? await page.evaluate(() => window.__chatdomKingdom.pierShot?.() ?? null) : POSES[name];
    if (POSES[name] === 'pier' && !pose) { report.poses[name] = { absent: 'no pier in this scene' }; continue; }
    if (pose) await page.evaluate(p => { window.__chatdomStream?.hold(true); window.__chatdomKingdom.pose(p.eye, p.target, p.fov); }, pose);
    // Refinement for the new view (the land's own waves) settles before counting.
    await page.waitForFunction(() => { const land = window.__chatdomKingdom.inspect().land; return land.queued === 0 && land.busy === 0 && land.fadingRegions === 0; },
      null, { timeout: 240_000, polling: 1000 }).catch(() => { report.poses[name] = { unsettled: true }; });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__frameProbe.start(3));
    await page.waitForFunction(() => { window.__frameProbe.flush(); return window.__frameProbe.recording === 0; }, null, { timeout: 240_000, polling: 500 });
    const summary = summariseProbe(await page.evaluate(() => window.__frameProbe.report()));
    const state = await page.evaluate(() => { const s = window.__chatdomKingdom.inspect(); return { land: { displayedLevels: s.land.displayedLevels, mainQuads: s.land.mainQuads,
      reflectionQuads: s.land.reflectionQuads, reflectionMeshes: s.land.reflectionMeshes, covered: s.land.covered }, water: s.water?.reflection?.pass ?? null, shadow: { drawCalls: s.shadow.drawCalls, triangles: s.shadow.triangles, updates: s.shadow.updates } }; });
    // The main view is the largest scene pass (more than a few draws, so never a post pass). At high it is the
    // viewport's size; balanced and low draw it below the viewport, still larger than the half-size reflection.
    const scenes = summary.passes.filter(p => p.draws.median > 4).sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1] || b.draws.median - a.draws.median);
    const main = scenes[0], others = summary.passes.filter(p => p !== main).sort((a, b) => b.draws.median - a.draws.median);
    const result = { frameDraws: summary.draws.max, frameTriangles: summary.triangles.max, mainDraws: main?.draws.max ?? null, mainTriangles: main?.triangles.max ?? null,
      reflection: others[0] ? { size: others[0].size, draws: others[0].draws.max, triangles: others[0].triangles.max } : null, state, passes: summary.passes };
    result.withinBudget = result.frameDraws <= BUDGET.frameDraws && result.frameTriangles <= BUDGET.frameTriangles && (result.mainTriangles ?? Infinity) <= BUDGET.mainTriangles;
    if (values.quality === 'high') result.withinHigh = result.withinBudget;
    if (pose) result.pose = { eye: pose.eye, target: pose.target, fov: pose.fov };
    if (values.stills) { result.png = `${stem}-${name}.png`; await page.screenshot({ path: result.png, timeout: 60_000 }); }
    report.poses[name] = { ...report.poses[name], ...result };
    console.log(`${name}: frame ${result.frameDraws} draws / ${(result.frameTriangles / 1e6).toFixed(2)} M · main ${result.mainDraws} / ${(result.mainTriangles / 1e6).toFixed(2)} M`
      + ` · reflection ${result.reflection?.draws ?? '-'} / ${result.reflection ? (result.reflection.triangles / 1e6).toFixed(2) : '-'} M · levels ${state.land.displayedLevels} · ${result.withinBudget ? 'within' : 'OVER'} ${BUDGET_NAME}`);
  }
  assert.deepEqual(report.errors, []);
  report.passed = Object.values(report.poses).every(pose => pose.withinBudget || pose.absent);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  console.error(report.failure);
} finally {
  if (values.pc) await page?.close().catch(() => {});
  else await browser?.close().catch(() => {});
  try { if (preview) await closeCapturePreview(preview); } catch { /* closed */ }
  if (server?.listening) await new Promise(done => server.close(done));
  await release?.();
  await mkdir(values.out, { recursive: true });
  await writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`);
  setTimeout(() => process.exit(report.passed ? 0 : 1), 200).unref();
}
