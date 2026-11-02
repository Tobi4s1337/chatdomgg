// Every name renders: the names bench in a real browser. It proves the Latin page fetches no other script's faces,
// that every world name's faces arrive and draw (seal, footer, slip, canvas) without overflow or clipped marks, and
// takes the stills.
// node packages/ui/src/bench/names-check.mjs [--out work/evidence/front-door/fd11]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const benchRoot = fileURLToPath(new URL('./', import.meta.url));
const { default: solid } = await import(createRequire(`${repo}apps/web/package.json`).resolve('vite-plugin-solid'));
const out = `${repo}${option('--out') ?? 'work/evidence/front-door/fd11'}`;
const sizes = [[1440, 900], [390, 844]];
const report = { bench: 'names in every script the kit serves; typed bench names, no session or feed', port: 0, checks: [] };

/** Font files a Latin page may fetch: IM Fell and Alegreya's Latin cuts. Anything else is another script's face. */
const LATIN_FONT = /\/(im-fell-english[a-z-]*|alegreya-(roman|italic)-latin|alegreya-latin(-ext)?-wght-(normal|italic))[.-][^/]*woff2/;

async function serve() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ root: benchRoot, configFile: false, plugins: [solid()], logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [`${repo}packages`] } } });
    try { await server.listen(); report.port = port; return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (error?.code !== 'EADDRINUSE' && !/already in use/.test(error?.message ?? '')) throw error; }
  }
  throw new Error('No free capture port');
}

function watch(page) {
  const errors = [], fonts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/api\/realm\/session/.test(message.text()) && !/404/.test(message.text())) errors.push(message.text()); });
  page.on('request', request => { if (request.resourceType() === 'font' || /\.woff2(\?|$)/.test(request.url())) fonts.push(request.url()); });
  page.on('response', response => { if (response.status() >= 400 && !/\/api\/realm\/session/.test(response.url())) errors.push(`${response.status()} ${response.url()}`); });
  return { errors, fonts };
}

/** Facts read from the drawn page: overflow, clipped names, faces loaded for each name, the smallest text. */
const readFacts = page => page.evaluate(() => {
  const names = [...document.querySelectorAll('.cd-name')];
  const clipped = names.filter(el => {
    const style = window.getComputedStyle(el);
    // A name may end in an ellipsis on one line; it must never be cut vertically or spill past its box unmarked.
    const vertical = style.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1;
    const spills = style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible';
    return vertical || spills;
  }).map(el => el.textContent);
  // Each name's own stack (its lang has already put the right CJK face first), up to the first CJK face: the later
  // CJK faces also cover Han but are never used for it, so they need not load.
  const ownStack = el => {
    const families = window.getComputedStyle(el).fontFamily.split(',').map(family => family.trim());
    const cjk = families.findIndex(family => /Chatdom (JP|KR|TC|SC)/.test(family));
    return (cjk >= 0 ? families.slice(0, cjk + 1) : families).join(', ');
  };
  const unloaded = names.filter(el => !document.fonts.check(`16px ${ownStack(el)}`, el.textContent)).map(el => `${el.textContent} (${ownStack(el)})`);
  // The header seal's card is let down outside the seal on purpose; every other box must hold its words.
  const leaks = [...document.querySelectorAll('.nb-slip, .cd-signin:not([data-size="header"]), .cd-foot-who, .nb-line')].filter(el => el.scrollWidth > el.clientWidth + 1 && window.getComputedStyle(el).overflowX === 'visible').map(el => el.className);
  const smallest = Math.min(...[...document.querySelectorAll('body *')].filter(el => el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length)
    .map(el => parseFloat(window.getComputedStyle(el).fontSize)));
  const rtl = document.querySelector('.cd-foot-name');
  return { overflow: document.documentElement.scrollWidth > window.innerWidth, clipped, unloaded, leaks, smallest, names: names.length,
    footName: rtl ? { dir: rtl.getAttribute('dir'), bidi: window.getComputedStyle(rtl).unicodeBidi } : null };
});

const release = await acquireCaptureLock();
let server, browser;
try {
  await mkdir(out, { recursive: true });
  ({ server } = await serve());
  const base = `http://127.0.0.1:${report.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });

  // 1. A Latin page with every kit piece fetches only Latin faces.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), seen = watch(page);
    await page.goto(`${base}/latin.html`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const foreign = seen.fonts.filter(url => !LATIN_FONT.test(url));
    if (!seen.fonts.length) throw new Error('latin: the page fetched no font at all');
    if (foreign.length) throw new Error(`latin: a Latin page fetched other scripts' faces:\n${foreign.join('\n')}`);
    if (seen.errors.length) throw new Error(`latin: ${seen.errors.join('\n')}`);
    await page.screenshot({ path: `${out}/latin-bench@1440x900.png` });
    report.checks.push(`latin 1440x900: ${seen.fonts.length} font files, all Latin (${[...new Set(seen.fonts.map(url => url.split('/').pop().replace(/\?.*/, '')))].join(', ')})`);
    await page.close();
  }

  // 2. Names in every script, at both sizes.
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } }), seen = watch(page);
    await page.goto(`${base}/names.html`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 90_000 });
    const facts = await readFacts(page);
    const problems = [];
    if (facts.overflow) problems.push('horizontal overflow');
    if (facts.clipped.length) problems.push(`clipped names: ${facts.clipped.join(', ')}`);
    if (facts.unloaded.length) problems.push(`faces not loaded for: ${facts.unloaded.join(', ')}`);
    if (facts.leaks.length) problems.push(`boxes overflowing: ${facts.leaks.join(', ')}`);
    if (facts.smallest < 12) problems.push(`text at ${facts.smallest}px`);
    if (facts.footName?.dir !== 'auto' || facts.footName?.bidi !== 'isolate') problems.push(`footer name not isolated: ${JSON.stringify(facts.footName)}`);
    if (seen.errors.length) problems.push(...seen.errors);
    if (problems.length) throw new Error(`names ${width}x${height}: ${problems.join('\n')}`);
    const world = [...new Set(seen.fonts.map(url => url.match(/world\/([^/]+)\//)?.[1]).filter(Boolean))];
    await page.screenshot({ path: `${out}/names-bench@${width}x${height}.png`, fullPage: true });
    report.checks.push(`names ${width}x${height}: ${facts.names} drawn names, all faces loaded, none clipped, no overflow, smallest text ${facts.smallest}px, footer name isolated; world faces fetched: ${world.join(', ')}`);
    await page.close();
  }
  await writeFile(`${out}/names-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(report.checks.join('\n'));
} finally {
  await browser?.close();
  await server?.close();
  await release();
}
