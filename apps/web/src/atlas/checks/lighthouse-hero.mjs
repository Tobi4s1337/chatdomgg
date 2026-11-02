/* global AbortSignal, clearTimeout */
// One Lighthouse run of the front page's hero bench, under the shared capture lock, niced. Lighthouse is not a
// dependency of the repo: point LIGHTHOUSE_BIN at an installed CLI (`npx lighthouse` puts one in the npx cache).
//   ATLAS_CHECK_URL=http://127.0.0.3:5173 LIGHTHOUSE_BIN=…/node_modules/.bin/lighthouse \
//   node src/atlas/checks/lighthouse-hero.mjs [mobile|desktop]
// Writes work/evidence/atlas-map/am13-lighthouse-hero-<form>.json (the full report) and prints the scores. On a
// SwiftShader host the performance score is a floor, not a forecast: the CPU is shared and there is no GPU.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.3:5173';
const bin = process.env.LIGHTHOUSE_BIN;
if (!bin) throw new Error('LIGHTHOUSE_BIN is required');
const form = process.argv[2] === 'desktop' ? 'desktop' : 'mobile';
const out = new URL(`../../../../../work/evidence/atlas-map/am13-lighthouse-hero-${form}.json`, import.meta.url).pathname;
const url = `${base}/-/atlas-embed?mode=hero`;

const release = await acquireCaptureLock({ signal: AbortSignal.timeout(900_000) });
let code;
try {
  code = await new Promise((resolve) => {
    const child = spawn('nice', ['-n', '10', 'taskset', '-c', '0-8', bin, url,
      '--only-categories=performance,accessibility,best-practices',
      ...(form === 'desktop' ? ['--preset=desktop'] : []),
      '--chrome-flags=--headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist',
      '--max-wait-for-load=90000', '--output=json', `--output-path=${out}`, '--quiet'], { stdio: 'inherit' });
    const watchdog = setTimeout(() => child.kill('SIGTERM'), 240_000);
    child.on('exit', (exit) => { clearTimeout(watchdog); resolve(exit); });
  });
} finally {
  await release();
}
if (code !== 0) throw new Error(`lighthouse exited ${code}`);
const report = JSON.parse(await readFile(out, 'utf8'));
const audit = (id) => report.audits[id]?.numericValue;
console.log(JSON.stringify({
  url, form, lighthouse: report.lighthouseVersion,
  scores: Object.fromEntries(Object.entries(report.categories).map(([id, c]) => [id, Math.round(c.score * 100)])),
  fcpMs: Math.round(audit('first-contentful-paint')), lcpMs: Math.round(audit('largest-contentful-paint')),
  tbtMs: Math.round(audit('total-blocking-time')), cls: audit('cumulative-layout-shift'), speedIndexMs: Math.round(audit('speed-index')),
  transferBytes: audit('total-byte-weight'),
}, null, 2));
