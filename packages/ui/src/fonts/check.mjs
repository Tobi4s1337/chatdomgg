#!/usr/bin/env node
// Real-browser check for the name faces: `node packages/ui/src/fonts/check.mjs`
//
// Serves the fixture pages in ./check with Vite on the first free capture port, opens them in headless Chrome and
// records every font request. Asserts that the Latin page fetches Latin files only, that the scripts page fetches
// and loads the matching world faces for names in eleven scripts, that each world face keeps Alegreya's line box,
// and that marks stay inside .cd-name's leading and are never clipped vertically by .cd-name-line. No screenshots,
// no capture lock. Stops its own server and browser, prints a short report and exits non-zero on failure.
import { chromium } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../testing/capture-ports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'check');
const UI = resolve(HERE, '..', '..');

const LATIN_FILES = /\/fonts\/(im-fell-english-(regular|italic|sc)|alegreya-(roman|italic)-latin)\.woff2$/;
const WORLD_FOLDER = { Arabic: 'arabic', Hebrew: 'hebrew', Devanagari: 'devanagari', Thai: 'thai', 'Chinese (simplified)': 'sc', 'Chinese (traditional)': 'tc', Japanese: 'jp', Korean: 'kr' };
const ALEGREYA_SUBSET = { Cyrillic: 'cyrillic-wght-normal', Greek: 'greek-wght-normal' };

const failures = [];
const lines = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

async function listen() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({
      root: FIXTURES,
      configFile: false,
      logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [UI] } },
    });
    try {
      await server.listen();
      return { server, port };
    } catch (error) {
      await server.close();
      if (!/already in use|EADDRINUSE/i.test(String(error?.message ?? error))) throw error;
    }
  }
  throw new Error('no free capture port');
}

async function visit(browser, base, page) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const tab = await context.newPage();
  const fonts = [];
  const errors = [];
  tab.on('request', (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === 'font' || /\.(woff2?|ttf|otf)$/.test(url.pathname)) fonts.push(url.pathname);
  });
  tab.on('requestfailed', (request) => errors.push(`${request.url()} ${request.failure()?.errorText}`));
  tab.on('pageerror', (error) => errors.push(String(error)));
  await tab.goto(`${base}/${page}`, { waitUntil: 'load' });
  return { context, tab, fonts, errors };
}

const short = (path) => path.replace(/^.*\/fonts\//, '');

async function main() {
  const { server, port } = await listen();
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });

    // The Latin page: only IM Fell and Alegreya's Latin files, whatever the name stack lists.
    const latin = await visit(browser, base, 'latin.html');
    await latin.tab.evaluate(() => document.fonts.ready);
    await latin.tab.waitForTimeout(300);
    const foreign = latin.fonts.filter((path) => !LATIN_FILES.test(path));
    expect(foreign.length === 0, `latin.html fetched non-Latin files: ${foreign.map(short).join(', ')}`);
    expect(latin.fonts.some((path) => path.endsWith('/alegreya-roman-latin.woff2')), 'latin.html did not fetch Alegreya Latin');
    expect(latin.errors.length === 0, `latin.html errors: ${latin.errors.join('; ')}`);
    lines.push(`latin.html   ${latin.fonts.length} font requests: ${[...new Set(latin.fonts.map(short))].join(', ')}`);
    await latin.context.close();

    // The scripts page: every name's own face arrives and loads.
    const scripts = await visit(browser, base, 'scripts.html');
    await scripts.tab.waitForFunction(() => 'nameCheck' in window, null, { timeout: 30_000 });
    const result = await scripts.tab.evaluate(() => window.nameCheck);
    await scripts.tab.waitForTimeout(200);
    expect(!result.error, `scripts.html failed: ${result.error}`);
    expect(scripts.errors.length === 0, `scripts.html errors: ${scripts.errors.join('; ')}`);

    const folders = new Map();
    for (const path of scripts.fonts) {
      const folder = path.match(/\/fonts\/world\/(\w+)\//)?.[1] ?? (path.match(/\/fonts\/alegreya-([\w-]+)\.woff2$/)?.[1]);
      if (folder) folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    for (const { script, family, ok } of result.loaded) {
      const folder = WORLD_FOLDER[script] ?? ALEGREYA_SUBSET[script];
      if (folder) expect(folders.has(folder), `${script}: no request for ${folder}`);
      expect(ok, `${script}: ${family} not loaded for the name (document.fonts)`);
    }
    for (const { text, ok } of result.canvasLoaded) expect(ok, `canvas name ${text}: faces not loaded by loadNameFaces`);
    lines.push(`scripts.html ${scripts.fonts.length} font requests: ${[...folders].map(([folder, count]) => `${folder} ${count}`).join(', ')}`);
    lines.push(`  loaded: ${result.loaded.map(({ script, ok }) => `${script} ${ok ? 'yes' : 'NO'}`).join(', ')}`);
    lines.push(`  canvas via loadNameFaces: ${result.canvasLoaded.filter(({ ok }) => ok).length}/${result.canvasLoaded.length}`);

    // No layout shift: with line-height normal, every script's line is Alegreya's line.
    const latinBox = result.lineBoxes.find(({ script }) => script === 'Latin').height;
    for (const { script, height } of result.lineBoxes) {
      expect(Math.abs(height - latinBox) < 0.5, `${script}: line box ${height}px, Alegreya ${latinBox}px`);
    }
    // Each world face's own line, with the space strut zeroed, is Alegreya's line; the unadjusted control is not.
    const fmt = (box) => `${box.above.toFixed(3)}/${box.below.toFixed(3)}`;
    const same = (a, b) => Math.abs(a.above - b.above) < 0.02 && Math.abs(a.below - b.below) < 0.02;
    const alegreya = result.faces.find(({ family }) => family === 'Alegreya').box;
    let sensitive = 0;
    for (const { family, box, control } of result.faces) {
      expect(same(box, alegreya), `${family}: line ${fmt(box)}em above/below the baseline, Alegreya ${fmt(alegreya)}em`);
      if (family === 'Alegreya') continue;
      expect(control !== undefined, `${family}: no control face measured`);
      if (control && !same(control, alegreya)) sensitive += 1;
    }
    expect(sensitive > 0, 'no control face differed from Alegreya: the line measurement cannot see the overrides');
    lines.push(`  own line at 40px, ascent/descent in em (Alegreya ${fmt(alegreya)}): ${result.faces.filter(({ family }) => family !== 'Alegreya').map(({ family, box, control }) => `${family.replace('Chatdom ', '')} ${fmt(box)}${control ? ` (without overrides ${fmt(control)})` : ''}`).join(', ')}`);
    lines.push(`  line boxes at 18px, line-height normal: ${[...new Set(result.lineBoxes.map(({ height }) => height))].join(', ')}px across ${result.lineBoxes.length} scripts`);

    // Marks: ink must stay inside .cd-name's line box (Alegreya ascent/descent plus half the extra leading), except
    // the reported-only vocalised Arabic, which overhangs but is never clipped (overflow-y stays visible).
    const leading = (result.lineHeight - (1.016 + 0.345)) / 2;
    const room = { above: 1.016 + leading, below: 0.345 + leading };
    for (const { script, above, below, fit } of result.ink) {
      if (fit) expect(above <= room.above + 0.005 && below <= room.below + 0.005, `${script}: ink ${above.toFixed(3)}/${below.toFixed(3)}em exceeds .cd-name room ${room.above.toFixed(3)}/${room.below.toFixed(3)}em`);
    }
    lines.push(`  ink above/below baseline (em) vs room ${room.above.toFixed(3)}/${room.below.toFixed(3)}: ${result.ink.map(({ script, above, below, fit }) => `${script} ${above.toFixed(3)}/${below.toFixed(3)}${fit ? '' : ' (reported only)'}`).join(', ')}`);
    expect(result.clip.y === 'visible' && result.clip.x === 'clip' && result.clip.textOverflow === 'ellipsis', `.cd-name-line computes to ${JSON.stringify(result.clip)}`);
    lines.push(`  .cd-name-line: overflow-x ${result.clip.x}, overflow-y ${result.clip.y}, text-overflow ${result.clip.textOverflow}`);
    await scripts.context.close();
  } finally {
    await browser?.close();
    await server.close();
  }
  console.log(`name faces check on 127.0.0.1:${port}`);
  for (const line of lines) console.log(line);
  if (failures.length) {
    console.log(`FAIL (${failures.length})`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('PASS');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
