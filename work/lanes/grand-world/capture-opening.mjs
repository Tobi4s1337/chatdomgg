// The opening's frame sequence: the parchment loader's beats into the first street, one page per size.
//   node work/lanes/grand-world/capture-opening.mjs <base-url> <out-dir> [--gpu]
// Holds the shared capture lock only while the pages are open. Stills are named <surface>-<size>-<ms>.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const [base, out] = process.argv.slice(2);
if (!base || !out) throw new Error('usage: capture-opening.mjs <base-url> <out-dir>');
mkdirSync(out, { recursive: true });
const kingdom = '129634568';
const runs = [
  { name: 'stream', path: `/stream?source=realm&kingdom=${kingdom}&hour=17.5`, width: 1920, height: 1080 },
  { name: 'grand', path: '/-/grand?channel=tobi4s_', width: 1440, height: 900 },
  { name: 'grand', path: '/-/grand?channel=tobi4s_', width: 390, height: 844 },
];
const at = [400, 1500, 3500, 7000, 12000, 20000, 30000, 42000, 56000, 72000];
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(240_000) });
const report = [];
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const run of runs) {
      const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const started = Date.now(), frames = [];
      await page.goto(base + run.path, { waitUntil: 'commit' });
      let gone = null;
      for (const ms of at) {
        const wait = ms - (Date.now() - started);
        if (wait > 0) await page.waitForTimeout(wait);
        const state = await page.evaluate(() => {
          const opening = document.querySelector('.opening');
          return { beat: opening?.getAttribute('data-beat') ?? null, line: document.querySelector('.opening-line')?.textContent ?? null,
            detail: document.querySelector('.opening-detail')?.textContent ?? null,
            steps: performance.getEntriesByType('mark').filter(m => m.name.startsWith('chatdom:open:')).map(m => `${m.name.slice(13)}@${Math.round(m.startTime)}`),
            ready: window.__chatdomReady === true };
        });
        const file = `${out}/${run.name}-${run.width}x${run.height}-${String(ms).padStart(5, '0')}.png`;
        // The software renderer can hold the main thread for seconds while the land installs; record when it really drew.
        const shot = await page.screenshot({ path: file, timeout: 45_000 }).then(() => Date.now() - started, () => null);
        frames.push({ ms, drawnAt: shot, file: shot === null ? null : file, ...state });
        if (!state.beat && gone === null && frames.length > 1) gone = ms;
        if (gone !== null && ms - gone >= 5000) break;
      }
      report.push({ ...run, frames });
      await context.close();
    }
  } finally { await browser.close(); }
} finally { await release(); }
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
for (const run of report) for (const frame of run.frames) console.log(run.name, run.width, frame.ms, frame.drawnAt, frame.beat, '|', frame.line, '|', frame.detail, '|', frame.ready);
