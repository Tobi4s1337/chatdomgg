/* global URLSearchParams:readonly, getComputedStyle:readonly, NodeFilter:readonly, navigator:readonly */
// Captures the citizen card bench (SIMULATED fixtures) under the shared host capture lock: one owned Vite server
// and one Chromium, both closed before the lock is released. The page is Wren Tarnwalker's whole place: their plaque
// with the portrait painted from their saved look, what they wear, the print their shared link unfurls into, and their
// passport read beneath it.
//
// The bench's `/-/citizens/share.png` is answered here: the bench card's share input (`share-fixture.ts`: the card
// document, worn pieces and the passport as the real reader answers it through the disclosure) composed by
// `composeCitizenShare` and drawn by this Chrome with scripts off and every request refused, as main's server
// renderer draws it. Wren's portrait is the panel's shipped portrait, painted from the same saved look, so one
// portrait is on every surface. The share pictures land in shots/card-passport/share/ at 1200 x 630 and 320 wide.
//   node apps/web/src/citizen-card/capture.mjs [--port 5188]
// Shots land in shots/card-passport/card/<name>@<w>x<h>.png. Console errors, off-host requests, horizontal overflow,
// text under 12 px and a page without its portrait, worn pieces or open passport fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5188);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/card-passport/card`;
const shareOutput = `${root}shots/card-passport/share`;
const run = promisify(execFile);

/** name, query, viewport and whether to also keep the whole scrolled page. */
const SHOTS = [
  ['page-wren', { fixture: 'wren', mode: 'page' }, [1440, 900], true],
  ['page-wren', { fixture: 'wren', mode: 'page' }, [390, 844], true],
  ['page-wren-private', { fixture: 'wren', mode: 'page', travels: 'hidden' }, [1440, 900], true],
  ['page-juniper', { fixture: 'juniper', mode: 'page' }, [1440, 900], true],
  ['dialog-wren', { fixture: 'wren', mode: 'dialog' }, [1440, 900]],
  ['dialog-wren', { fixture: 'wren', mode: 'dialog' }, [390, 844]],
  ['page-knight', { fixture: 'knight', mode: 'page' }, [1440, 900]],
  ['page-unknown', { fixture: 'unknown', mode: 'page', light: 'night' }, [390, 844]],
  ['page-lapsed', { fixture: 'lapsed', mode: 'page', light: 'day' }, [1440, 900]],
  ['dialog-loading', { fixture: 'wren', mode: 'dialog', state: 'loading' }, [390, 844]],
  ['page-withdrawn', { fixture: 'wren', mode: 'page', state: 'withdrawn' }, [390, 844]],
  ['dialog-unavailable', { fixture: 'wren', mode: 'dialog', state: 'unavailable' }, [1440, 900]],
];

let server, browser, release;
const report = { port, shots: [], share: [], console: [], external: [], focus: null, reducedMotion: null, copy: null };
try {
  release = await acquireCaptureLock();
  // The share route: one picture at a time, drawn from the bench card as it stands at the moment of the request.
  let drawing = Promise.resolve();
  const shareRoute = {
    name: 'citizen-share-capture',
    configureServer(vite) {
      vite.middlewares.use('/-/citizens/share.png', (request, response, next) => {
        (async () => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          const share = await composeFixture(url.searchParams.get('fixture') ?? 'wren', url.searchParams.get('travels') === 'hidden' ? 'hidden' : 'shown');
          if (!share) { response.statusCode = 404; response.setHeader('cache-control', 'no-store'); response.end('No card here'); return; }
          const job = drawing.then(() => draw(share.html));
          drawing = job.then(() => undefined, () => undefined);
          const png = await job;
          response.statusCode = 200;
          response.setHeader('content-type', 'image/png');
          response.setHeader('cache-control', 'no-store');
          response.end(png);
        })().catch(next);
      });
    },
  };
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', plugins: [shareRoute],
    optimizeDeps: { entries: ['src/citizen-card/bench.html'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  const base = `http://127.0.0.1:${port}/src/citizen-card/bench.html`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--font-render-hinting=none'] });
  await mkdir(output, { recursive: true });
  await mkdir(shareOutput, { recursive: true });

  // The server side of the picture, loaded as written.
  const load = path => server.ssrLoadModule(`${root}${path}`);
  const [craft, fonts, shareFixture, fixtures] = await Promise.all([
    load('packages/ui/src/passport/craft.ts'), load('apps/api/src/passport/fonts.ts'),
    load('apps/web/src/citizen-card/share-fixture.ts'), load('apps/web/src/citizen-card/fixtures.ts'),
  ]);
  const fontFaces = fonts.passportFontFaces();
  const wrenPortrait = `data:image/webp;base64,${(await readFile(`${root}apps/panel/src/assets/fixture/wren-portrait.webp`)).toString('base64')}`;
  /** The approved portrait bytes the asset port holds: Wren's painted portrait, and nobody else's in this bench. */
  const portraitOf = id => {
    const ref = fixtures.findFixture(id)?.document.identity.portrait;
    return id === 'wren' && ref ? { src: wrenPortrait, alt: ref.alt } : null;
  };
  async function composeFixture(id, travels, change = card => card) {
    const card = await shareFixture.simulatedCardShare(id, { travels, portrait: portraitOf(id) });
    return card ? craft.composeCitizenShare(change(card), { fontFaces, site: 'chatdom.gg' }) : null;
  }
  /** Draws a composition exactly at its size: no script, every request refused, fonts settled. */
  async function draw(html, path) {
    const { width, height } = craft.CITIZEN_SHARE_SIZE;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, javaScriptEnabled: false, offline: true, reducedMotion: 'reduce' });
    try {
      const refused = [];
      await context.route('**/*', route => { refused.push(route.request().url()); return route.abort('blockedbyclient'); });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const clipped = await page.evaluate(() => [...document.querySelectorAll('h1,h2,p,li,span,strong')]
        .filter(element => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflow === 'hidden')
        .map(element => element.className || element.tagName));
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, animations: 'disabled', ...(path ? { path } : {}) });
      if (path) report.share.push({ path: path.slice(root.length), refused, clipped });
      if (refused.length || clipped.length) report.console.push(`share picture: refused ${refused.length} requests, clipped ${clipped.join(', ') || 'nothing'}`);
      return png;
    } finally {
      await context.close();
    }
  }

  const open = async (query, [width, height], context = {}) => {
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...context });
    // Context-level, so worker and module requests are named too.
    scope.on('response', response => { if (response.status() >= 400) report.console.push(`${JSON.stringify(query)}: ${response.status()} ${response.url()}`); });
    scope.on('requestfailed', request => report.console.push(`${JSON.stringify(query)}: failed ${request.url()} ${request.failure()?.errorText ?? ''}`));
    const page = await scope.newPage();
    page.on('close', () => { void scope.close(); });
    page.on('console', message => { if (message.type() === 'error') report.console.push(`${JSON.stringify(query)}: ${message.text()} ${message.location().url}`); });
    page.on('pageerror', error => report.console.push(`${JSON.stringify(query)}: ${error.message}`));
    page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', ''].includes(url.hostname) && !url.protocol.startsWith('blob') && !url.protocol.startsWith('data')) report.external.push(request.url()); });
    await page.goto(`${base}?${new URLSearchParams({ chrome: '0', ...query })}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomCardError === 'string', {}, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomCardError);
    if (failure) throw new Error(`${JSON.stringify(query)}: ${failure}`);
    return page;
  };

  // What a person can read on the page: the smallest text, overflow, and the parts Wren's page must have.
  const audit = page => page.evaluate(() => {
    let smallest = Infinity, where = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest('svg, .cpc-visually-hidden, .ccb-bar')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < smallest) { smallest = size; where = node.textContent.trim().slice(0, 30); }
    }
    const portrait = document.querySelector('.cc-window img');
    return {
      smallest, where, overflow: document.documentElement.scrollWidth > window.innerWidth,
      portrait: portrait ? { width: portrait.naturalWidth, height: portrait.naturalHeight, alt: portrait.getAttribute('alt') } : null,
      worn: [...document.querySelectorAll('.cc-worn-name')].map(node => node.textContent),
      passport: document.querySelector('.cpc')?.getAttribute('data-state') ?? null,
      holder: document.querySelector('.cpc')?.textContent?.includes('Wren Tarnwalker') ?? false,
      name: document.querySelector('.cc-name')?.textContent ?? null,
      picture: document.querySelector('.cc-share')?.getAttribute('data-picture') ?? null,
    };
  });

  for (const [name, query, viewport, full] of SHOTS) {
    const page = await open(query, viewport);
    const path = `${output}/${name}@${viewport[0]}x${viewport[1]}.png`;
    await page.screenshot({ path });
    const seen = await audit(page);
    const at = `${name}@${viewport.join('x')}`;
    if (seen.overflow) report.console.push(`${at}: horizontal overflow`);
    if (seen.smallest < 12) report.console.push(`${at}: text at ${seen.smallest}px ("${seen.where}")`);
    if (name === 'page-wren') {
      const missing = [
        seen.name !== 'Wren Tarnwalker' && `name ${seen.name}`,
        !seen.portrait && 'portrait',
        seen.worn.length !== 4 && `worn pieces (${seen.worn.length})`,
        seen.passport !== 'visible' && `open passport (${seen.passport})`,
        !seen.holder && 'the passport’s holder',
        seen.picture !== 'shown' && `the share picture (${seen.picture})`,
      ].filter(Boolean);
      if (missing.length) report.console.push(`${at}: missing ${missing.join(', ')}`);
    }
    if (name === 'page-wren-private') {
      // Travels kept private: the card, its home and its tenure pieces stay; the book, its picture and every piece
      // that names a road go.
      const leaks = await page.evaluate(() => ['Emberfold', 'Hollowmere', 'Brindlewick', 'salt lavender', 'Raid scarf'].filter(word => document.body.textContent.includes(word)));
      if (leaks.length || seen.worn.length !== 2 || seen.passport !== 'hidden' || seen.picture !== 'shown') report.console.push(`${at}: private travels showed ${JSON.stringify({ leaks, worn: seen.worn, passport: seen.passport, picture: seen.picture })}`);
    }
    report.shots.push({ path: path.slice(root.length), bytes: (await stat(path)).size, smallestText: seen.smallest, worn: seen.worn.length, passport: seen.passport, picture: seen.picture });
    if (full) {
      const whole = `${output}/${name}-full@${viewport[0]}x${viewport[1]}.png`;
      await page.screenshot({ path: whole, fullPage: true });
      report.shots.push({ path: whole.slice(root.length), bytes: (await stat(whole)).size });
    }
    await page.close();
    console.log(`Captured ${name}@${viewport.join('x')}.`);
  }

  // Keyboard: the close button takes focus, Tab stays inside, Escape closes and focus returns to the opener.
  {
    const page = await open({ fixture: 'wren', mode: 'dialog' }, [1440, 900]);
    const first = await page.evaluate(() => document.activeElement?.className);
    let escaped = false;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => Boolean(document.activeElement?.closest('.cc-dialog'))))) escaped = true;
    }
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({ open: Boolean(document.querySelector('.cc-dialog')), focus: document.activeElement?.className }));
    report.focus = { initial: first, escapedDialog: escaped, closedByEscape: !after.open, restoredTo: after.focus };
    if (first !== 'cc-close' || escaped || after.open || after.focus !== 'ccb-open') throw new Error(`Dialog focus failed: ${JSON.stringify(report.focus)}`);
    await page.close();
  }
  // Reduced motion: the entrance becomes a short fade, and the frame is the same finished plaque.
  {
    const page = await open({ fixture: 'wren', mode: 'page' }, [390, 844], { reducedMotion: 'reduce' });
    report.reducedMotion = await page.evaluate(() => getComputedStyle(document.querySelector('.cc-plaque')).animationName);
    await page.screenshot({ path: `${output}/page-wren-reduced@390x844.png` });
    await page.close();
  }

  // Copying the link: acknowledged only once the clipboard took it; refused, the link is laid out to select by hand.
  {
    const page = await open({ fixture: 'wren', mode: 'page' }, [1440, 900], { permissions: ['clipboard-read', 'clipboard-write'] });
    await page.click('.cc-share-copy');
    await page.waitForFunction(() => document.querySelector('.cc-share-status')?.textContent?.includes('on your clipboard'), {}, { timeout: 10_000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    await page.close();
    const refusedPage = await open({ fixture: 'wren', mode: 'page' }, [390, 844]);
    await refusedPage.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }); });
    await refusedPage.click('.cc-share-copy');
    await refusedPage.waitForSelector('.cc-share-field input', { timeout: 10_000 });
    const field = await refusedPage.evaluate(() => ({ value: document.querySelector('.cc-share-field input')?.value, focused: document.activeElement?.closest('.cc-share-field') !== null }));
    await refusedPage.locator('.cc-share').screenshot({ path: `${output}/share-refused@390x844.png` });
    await refusedPage.close();
    report.copy = { copied, refused: field };
    const clean = `${base}?fixture=wren&mode=page`;
    if (copied !== clean || field.value !== clean || !field.focused) throw new Error(`Copying the card link failed: ${JSON.stringify(report.copy)}`);
  }

  // The share pictures themselves, at their own size and the way a link preview shows them.
  const LONG = 'نور الهدى بنت سليمان من واحة النخيل البعيدة';
  const PICTURES = [
    ['wren', 'wren', 'shown'],
    ['wren-private', 'wren', 'hidden'],
    ['juniper', 'juniper', 'shown'],
    // A long, right-to-left name and a long address on the same card, to see nothing is cut.
    ['long-name', 'wren', 'shown', card => ({ ...card, name: LONG, home: { name: 'The House of the Seven Lanterns', street: 'Long Ridge Lane below the Old Watchtower', tier: 'A manor' } })],
  ];
  for (const [name, id, travels, change] of PICTURES) {
    const share = await composeFixture(id, travels, change);
    const file = `${shareOutput}/${name}.png`;
    await draw(share.html, file);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf', 'scale=320:-1:flags=lanczos', `${shareOutput}/${name}@320.png`]);
    report.share.at(-1).alt = share.alt;
    report.share.at(-1).title = share.title;
    console.log(`Drew the ${name} share picture.`);
  }

  await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (report.console.length || report.external.length) throw new Error(`Console errors or external requests:\n${[...report.console, ...report.external].join('\n')}`);
  console.log(`Captured ${report.shots.length} frames into ${output} (port ${port}).`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await server?.close(); } finally { await release?.(); }
  }
}
