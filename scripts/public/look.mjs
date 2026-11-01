// One still per capture-lock hold, for the public entry and the panel.
//
//   node scripts/public/look.mjs --url <url> --size 1440x900 --out shots/try-it/door@1440x900.png
//        [--ready flag|selector:<css>|ms:<n>] [--click <css>]… [--between <ms>] [--after-ms <n>] [--helper <file.js>] [--block <url prefix>] [--timeout <ms>]
//
// The lock is shared with main's captures: it is taken just before the page opens and released as soon as the
// still is written. `--helper` injects a script before the page's own (a stand-in Twitch Helper for the panel), and
// `--block` refuses requests starting with a prefix (Twitch's real Helper, which would replace the stand-in).
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { acquireCaptureLock } from '../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const all = name => args.flatMap((value, i) => (value === name ? [args[i + 1]] : []));
const url = option('--url');
const [width, height] = option('--size', '1440x900').split('x').map(Number);
const out = resolve(option('--out', 'shots/try-it/shot.png'));
const ready = option('--ready', 'flag');
const timeout = Number(option('--timeout', '90000'));
const helper = option('--helper');
if (!url || !width || !height) throw new Error('Pass --url and --size WxH');
if (!Number.isFinite(timeout) || timeout < 1 || timeout > 240_000) throw new Error('--timeout must be 1–240000 ms');

let release, browser, deadline;
try {
  release = await acquireCaptureLock({ signal: AbortSignal.timeout(20 * 60_000) });
  // A stuck browser cannot retain the pipe-owned capture guard indefinitely.
  deadline = setTimeout(() => {
    console.error('Public still exceeded its eight-minute active deadline.');
    process.exit(124);
  }, 8 * 60_000);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 300)}`); });
  for (const prefix of all('--block')) await page.route(request => request.href.startsWith(prefix), route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  if (helper) await page.addInitScript({ content: await readFile(resolve(helper), 'utf8') });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  if (ready === 'flag') await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout });
  else if (ready.startsWith('selector:')) await page.waitForSelector(ready.slice(9), { timeout, state: 'visible' });
  else if (ready.startsWith('ms:')) await page.waitForTimeout(Number(ready.slice(3)));
  const between = Number(option('--between', '400'));
  for (const selector of all('--click')) { await page.click(selector, { timeout: 15_000 }); await page.waitForTimeout(between); }
  await page.waitForTimeout(Number(option('--after-ms', '600')));
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, timeout: 120_000 });
  console.log(`wrote ${out}`);
  for (const line of problems) console.log(line);
} finally {
  try { await browser?.close(); }
  finally { clearTimeout(deadline); await release?.(); }
}
