/* global URLSearchParams:readonly */
// Captures the forge's public mood through the built /-/forge-refusal route with Chrome/SwiftShader.
// node apps/web/src/forge-refusal-bench/capture.mjs [--base-url http://127.0.0.1:5187]
// Every frame is SIMULATED: the bench previews an already-admitted beat; nothing is requested or judged.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const OUT = 'shots/forge-refusals';
const LINES = ['The forge is in a mood tonight.', 'The bellows need a little breather.', 'Even the anvil has its moments.'];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
/** Each run is one timed sequence. Full motion is forced so headless defaults cannot change the shot. */
const RUNS = [
  { label: 'desktop', size: SIZES.desktop, motion: 'full' },
  { label: 'phone', size: SIZES.phone, motion: 'full' },
  { label: 'desktop-reduced', size: SIZES.desktop, motion: 'reduced' },
];
/** Anticipation, cough, cough-with-line, sulk, sigh, recovery, settle, and two clean frames after the beat. */
const TIMES = [0.18, 0.42, 0.7, 1.2, 1.68, 2.55, 3.2, 3.62, 4.0];

async function preview() {
  for (const port of CAPTURE_PORTS) {
    process.env.CHATDOM_FORGE_REFUSAL_PORT = String(port);
    try { return await startCapturePreview('CHATDOM_FORGE_REFUSAL_PORT'); }
    catch (error) { if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error('No safe capture port available.');
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await preview());
  console.log(`[forge-refusals] preview ${base}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const taken = [];
  /** Opens one fixed frame, checks it honestly and returns its report and the canvas pixels. */
  async function frame({ size: [width, height], motion, t, emulate }) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: emulate ?? 'no-preference' });
    const where = `${width}x${height}/${motion}@${t}`;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    page.on('worker', worker => worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); }));
    try {
      await page.goto(`${base}/-/forge-refusal?${new URLSearchParams({ variant: '0', hour: '19', t: String(t), motion })}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomForgeRefusalError === 'string', {}, { timeout: 240_000 });
      const failure = await page.evaluate(() => window.__chatdomForgeRefusalError);
      if (failure) throw new Error(`${where}: ${failure}`);
      if (errors.length) throw new Error(`${where}: ${errors.join('\n')}`);
      const report = await page.evaluate(() => window.__chatdomForgeRefusal);
      if (!report || report.at !== t || report.variant !== 0 || report.motion !== motion || report.width !== width || report.height !== height) throw new Error(`${where}: the bench reported a different state.`);
      const shouldShow = t >= 0.38 && t < 3.3;
      if (shouldShow && (report.caption.hidden || report.caption.text !== LINES[0])) throw new Error(`${where}: the line is missing (${JSON.stringify(report.caption)}).`);
      if (!shouldShow && (!report.caption.hidden || (t >= 3.6 && report.caption.text !== ''))) throw new Error(`${where}: a stale line remains (${JSON.stringify(report.caption)}).`);
      if (report.caption.overflow) throw new Error(`${where}: the line is clipped.`);
      const transform = await page.evaluate(() => document.querySelector('.forge-mood-line')?.style.transform ?? '');
      if (motion === 'auto' && report.prefersReduced !== (emulate === 'reduce')) throw new Error(`${where}: the reduced-motion preference did not reach the page.`);
      if ((motion === 'reduced' || emulate === 'reduce') && transform !== '') throw new Error(`${where}: the line still moves under reduced motion (${transform}).`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight);
      if (overflow) throw new Error(`${where}: the page overflows its viewport.`);
      if (!(await page.getByText('SIMULATED', { exact: false }).first().isVisible())) throw new Error(`${where}: the SIMULATED label is not visible.`);
      const pixels = await page.evaluate(() => document.querySelector('.frb-stage canvas')?.toDataURL('image/png') ?? '');
      return { page, report, pixels };
    } catch (error) { await page.close(); throw error; }
  }

  await mkdir(`${OUT}/sequence`, { recursive: true });
  for (const run of RUNS) {
    for (const t of TIMES) {
      const { page, report } = await frame({ ...run, t });
      const path = `${OUT}/sequence/${run.label}-t${t.toFixed(2)}@${run.size.join('x')}.png`;
      await page.screenshot({ path });
      await page.close();
      taken.push({ label: run.label, t, path, report });
      console.log(`[forge-refusals] ${path} · ${report.phase} · ${report.draws} draws`);
    }
  }
  // The viewer's own setting: with motion=auto and the browser asking for less motion, the forge
  // draws exactly the forced reduced frame.
  for (const t of [0.7, 1.2]) {
    const auto = await frame({ size: SIZES.desktop, motion: 'auto', t, emulate: 'reduce' });
    const forced = await frame({ size: SIZES.desktop, motion: 'reduced', t });
    await Promise.all([auto.page.close(), forced.page.close()]);
    if (!auto.pixels || auto.pixels !== forced.pixels) throw new Error(`auto@${t}: the browser's reduced-motion setting did not give the reduced frame.`);
    console.log(`[forge-refusals] auto motion under prefers-reduced-motion matches the reduced frame at ${t} s`);
  }

  // One timed sheet per run, the whole beat left to right, and full against reduced motion row by row.
  const sheets = [
    ...RUNS.map(run => ({ name: `sequence-${run.label}`, title: run.label, rows: [run.label] })),
    { name: 'motion-compare', title: 'full motion (top) · reduced motion (bottom)', rows: ['desktop', 'desktop-reduced'] },
  ];
  for (const { name, title, rows } of sheets) {
    const phone = rows.includes('phone');
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const figures = await Promise.all(rows.map(async row => {
      const tiles = await Promise.all(taken.filter(s => s.label === row).map(async s => ({ ...s, data: (await readFile(s.path)).toString('base64') })));
      const width = phone ? 165 : rows.length > 1 ? 168 : 380;
      return `<div style="display:flex;flex-wrap:${rows.length > 1 ? 'nowrap' : 'wrap'};gap:8px;padding:0 20px 14px">${tiles.map(t => `<figure style="margin:0;width:${width}px"><img style="width:100%;display:block" src="data:image/png;base64,${t.data}"><figcaption style="padding-top:4px;font-size:${rows.length > 1 ? 11 : 13}px">${t.t.toFixed(2)} s · ${t.report.phase}${t.report.caption.hidden ? '' : ' · line'}</figcaption></figure>`).join('')}</div>`;
    }));
    await sheet.setContent(`<html><body style="margin:0;background:#292830;color:#eadfc8;font:13px Georgia"><h1 style="font-weight:normal;font-size:20px;margin:16px 20px 4px">Chatdom · the forge’s mood · ${title}</h1><p style="margin:0 20px 12px;color:#c6b493">SIMULATED public beat preview · variant 0 · dusk 19:00 · seconds since the beat was admitted</p>${figures.join('')}</body></html>`);
    await sheet.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await sheet.screenshot({ path: `${OUT}/${name}-sheet.png`, fullPage: true });
    await sheet.close();
  }
  await writeFile(`${OUT}/capture-stats.json`, JSON.stringify(taken.map(({ path, report }) => ({ path, ...report })), null, 2) + '\n');
  console.log(`[forge-refusals] ${taken.length} frames, sheets in ${OUT}/`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
  }
}
