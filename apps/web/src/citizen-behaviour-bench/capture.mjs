/* global URLSearchParams:readonly */
// Captures the citizen-behaviour bench: the first doorstep-street encounter at web sizes, a midday
// grounding frame, and timed contact sheets (look → gesture → settle; walker takeover; departure).
//   node apps/web/src/citizen-behaviour-bench/capture.mjs --base-url http://127.0.0.1:5196
// Without --base-url it starts its own preview (port from CHATDOM_BEHAVIOUR_PORT, default any free port).
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/citizen-behaviour`;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_BEHAVIOUR_PORT'));
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const errors = [];
  const open = async (query, width, height) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(`${query}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${query}: ${message.text()}`); });
    await page.goto(`${base}/-/citizen-behaviour?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomBehaviourError === 'string', {}, { timeout: 300_000 });
    const failure = await page.evaluate(() => window.__chatdomBehaviourError);
    if (failure) throw new Error(`${JSON.stringify(query)}: ${failure}`);
    if (errors.length) throw new Error(errors.join('\n'));
    return page;
  };
  const seek = async (page, seconds) => {
    await page.evaluate(t => window.__chatdomBehaviourSeek(t), seconds);
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 300_000 });
    if (errors.length) throw new Error(errors.join('\n'));
    const report = await page.evaluate(() => window.__chatdomBehaviour);
    if (!report.lightSettled) console.warn(`[capture] window light still refining at ${seconds.toFixed(2)} s`);
    return report;
  };

  // Read the story's real encounter times from the bench itself.
  const probe = await open({ t: '0', frame: 'still' }, 320, 240);
  const { encounter } = await probe.evaluate(() => window.__chatdomBehaviour);
  await probe.close();
  console.log(`[capture] encounter: slot ${encounter.greeter} ${encounter.gesture}s to slot ${encounter.recipient}, ${encounter.start.toFixed(1)}–${encounter.end.toFixed(1)} s`);

  // Representative full frames.
  const nodDeepest = encounter.pose + Math.PI / 6;
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const hour of width === 1440 ? ['19', '12'] : ['19']) {
    const page = await open({ t: String(nodDeepest), hour, view: 'doorstep' }, width, height);
    const report = await page.evaluate(() => window.__chatdomBehaviour);
    if (!report.overlays.some(o => o.slot === encounter.greeter && o.gesture === encounter.gesture)) throw new Error('The greeting gesture is not visible at its own pose time.');
    await page.screenshot({ path: `${output}/doorstep-${hour === '12' ? 'midday' : 'dusk'}@${width}x${height}.png` });
    await page.close();
    console.log(`[capture] doorstep ${hour}:00 ${width}×${height}`);
  }

  // Timed contact sheets on the close camera: one still page, sought through the story.
  const sheet = async (name, scenario, frames, title) => {
    const page = await open({ t: String(frames[0].t), view: 'close', frame: 'still', scenario }, 560, 420);
    const tiles = [];
    for (const frame of frames) {
      const report = await seek(page, frame.t);
      const path = `${output}/${name}-${frame.t.toFixed(2)}.png`;
      await page.screenshot({ path });
      const greeter = report.overlays.find(o => o.slot === encounter.greeter), recipient = report.overlays.find(o => o.slot === encounter.recipient);
      tiles.push({ ...frame, data: (await readFile(path)).toString('base64'),
        detail: `noticer ${greeter ? `${greeter.gesture} · yaw ${greeter.lookYaw.toFixed(2)}` : 'at rest'} · other ${recipient ? `yaw ${recipient.lookYaw.toFixed(2)}` : 'at rest'}` });
    }
    await page.close();
    const columns = 4, tile = 560 / 1.4, rows = Math.ceil(tiles.length / columns), width = columns * tile + (columns + 1) * 10;
    const html = `<body style="margin:0;background:#28232a;font-family:Georgia;color:#efe3c8"><div style="padding:14px 14px 4px"><div style="font-size:20px">Chatdom · citizens at ease · ${escape(title)}</div><div style="font-size:12px;letter-spacing:.14em;color:#e8bd62;margin-top:4px">SIMULATED neighbours · real motion and citizen renderer · times in kingdom seconds</div></div><div style="display:grid;grid-template-columns:repeat(${columns},${tile}px);gap:10px;padding:10px">${tiles.map(t => `<figure style="margin:0"><img style="width:${tile}px;height:${tile * .75}px;display:block;border:1px solid #8d7650" src="data:image/png;base64,${t.data}"><figcaption style="font-size:12px;padding:4px 2px"><b style="color:#f2c56b;font-weight:normal">${escape(t.label)}</b> · ${t.t.toFixed(2)} s<br><span style="font-size:10px;color:#c9b48e">${escape(t.detail)}</span></figcaption></figure>`).join('')}</div></body>`;
    const composer = await browser.newPage({ viewport: { width: Math.ceil(width), height: 80 + rows * (tile * .75 + 60) } });
    await composer.setContent(html); await composer.screenshot({ path: `${output}/${name}-sheet.png`, fullPage: true }); await composer.close();
    console.log(`[capture] ${name}-sheet.png`);
  };
  const e = encounter, lookEnd = e.poseEnd + (e.end - e.poseEnd) * .4;
  await sheet('greeting', 'encounter', [
    { t: e.start - .6, label: 'walking' }, { t: e.start + (e.pose - e.start) * .5, label: 'head turns' }, { t: e.pose + .05, label: 'gesture begins' },
    { t: nodDeepest, label: 'deepest' }, { t: e.poseEnd - .08, label: 'gesture ends' }, { t: lookEnd, label: 'holds the look' },
    { t: e.end - .2, label: 'settling' }, { t: e.end + .4, label: 'at ease' },
  ], `${e.gesture} · look, pose, settle`);
  const cut = e.pose + .3;
  await sheet('takeover', 'takeover', [
    { t: cut - .1, label: 'mid-gesture' }, { t: cut + .1, label: 'walker control' }, { t: cut + .3, label: 'glance easing' }, { t: cut + .6, label: 'released' },
  ], 'walker takeover');
  await sheet('departure', 'departure', [
    { t: cut - .1, label: 'mid-gesture' }, { t: cut + .15, label: 'neighbour left' }, { t: e.poseEnd + .05, label: 'dip finished' }, { t: e.poseEnd + .6, label: 'settled' },
  ], 'neighbour leaves');
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release?.();
}
