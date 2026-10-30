/* global URLSearchParams:readonly */
// Captures the forge's public mood through the built /-/forge-refusal route with Chrome/SwiftShader.
// node apps/web/src/forge-refusal-bench/capture.mjs [--base-url http://127.0.0.1:5187]
// Every frame is SIMULATED: the bench previews an already-admitted beat; nothing is requested or judged.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const OUT = 'shots/forge-refusals';
const LINES = ['The forge is in a mood tonight.', 'The bellows need a little breather.', 'Even the anvil has its moments.'];
// Lane ports inside 5170–5199; 5190 belongs to main, 5193/5194 to the map and presence services.
const PORTS = [5186, 5187, 5188, 5189, 5195, 5196, 5197, 5198, 5199];
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
/** Anticipation, cough, cough-with-line, sulk, sigh, recovery, settle, and two clean frames after the beat. */
const TIMES = [0.18, 0.42, 0.7, 1.2, 1.68, 2.55, 3.2, 3.62, 4.0];

async function preview() {
  for (const port of PORTS) {
    process.env.CHATDOM_FORGE_REFUSAL_PORT = String(port);
    try { return await startCapturePreview('CHATDOM_FORGE_REFUSAL_PORT'); }
    catch (error) { if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
  }
  throw new Error(`No free lane port among ${PORTS.join(', ')}.`);
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await preview());
  console.log(`[forge-refusals] preview ${base}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const taken = [];
  for (const [label, [width, height]] of Object.entries(SIZES)) {
    for (const t of TIMES) {
      const query = { variant: '0', hour: '19', t: String(t) };
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
      page.on('worker', worker => worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); }));
      await page.goto(`${base}/-/forge-refusal?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomForgeRefusalError === 'string', {}, { timeout: 240_000 });
      const failure = await page.evaluate(() => window.__chatdomForgeRefusalError);
      if (failure) throw new Error(`${label}@${t}: ${failure}`);
      if (errors.length) throw new Error(`${label}@${t}: ${errors.join('\n')}`);
      const report = await page.evaluate(() => window.__chatdomForgeRefusal);
      if (!report || report.at !== t || report.variant !== 0 || report.width !== width || report.height !== height) throw new Error(`${label}@${t}: the bench reported a different state.`);
      const shouldShow = t >= 0.38 && t < 3.3;
      if (shouldShow && (report.caption.hidden || report.caption.text !== LINES[0])) throw new Error(`${label}@${t}: the line is missing (${JSON.stringify(report.caption)}).`);
      if (!shouldShow && (!report.caption.hidden || (t >= 3.6 && report.caption.text !== ''))) throw new Error(`${label}@${t}: a stale line remains (${JSON.stringify(report.caption)}).`);
      if (report.caption.overflow) throw new Error(`${label}@${t}: the line is clipped.`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight);
      if (overflow) throw new Error(`${label}@${t}: the page overflows its viewport.`);
      if (!(await page.getByText('SIMULATED', { exact: false }).first().isVisible())) throw new Error(`${label}@${t}: the SIMULATED label is not visible.`);
      await mkdir(`${OUT}/sequence`, { recursive: true });
      const path = `${OUT}/sequence/${label}-t${t.toFixed(2)}@${width}x${height}.png`;
      await page.screenshot({ path });
      await page.close();
      taken.push({ label, t, path, report });
      console.log(`[forge-refusals] ${path} · ${report.phase} · ${report.draws} draws`);
    }
  }
  // One timed sheet per size: the whole beat left to right.
  for (const label of Object.keys(SIZES)) {
    const tiles = await Promise.all(taken.filter(s => s.label === label).map(async s => ({ ...s, data: (await readFile(s.path)).toString('base64') })));
    const phone = label === 'phone';
    const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await sheet.setContent(`<html><body style="margin:0;background:#292830;color:#eadfc8;font:13px Georgia"><h1 style="font-weight:normal;font-size:20px;margin:16px 20px 4px">Chatdom · the forge’s mood · ${label}</h1><p style="margin:0 20px 12px;color:#c6b493">SIMULATED public beat preview · variant 0 · dusk 19:00 · seconds since the beat was admitted</p><div style="display:flex;flex-wrap:wrap;gap:10px;padding:0 20px 20px">${tiles.map(t => `<figure style="margin:0;width:${phone ? 165 : 380}px"><img style="width:100%;display:block" src="data:image/png;base64,${t.data}"><figcaption style="padding-top:4px">${t.t.toFixed(2)} s · ${t.report.phase}${t.report.caption.hidden ? '' : ' · line shown'}</figcaption></figure>`).join('')}</div></body></html>`);
    await sheet.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await sheet.screenshot({ path: `${OUT}/sequence-${label}-sheet.png`, fullPage: true });
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
