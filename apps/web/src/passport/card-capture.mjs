/* global URLSearchParams:readonly, getComputedStyle:readonly, NodeFilter:readonly, Request:readonly, Buffer:readonly, AbortSignal:readonly, navigator:readonly */
// Captures the passport as the citizen card page carries it and the 1200 x 800 share image, under the shared capture
// lock: one owned Vite server, one Chrome for the pages and one warm renderer for the pictures, all closed before the
// lock is released. The bench's `/-/passport/share.png` is answered here by the real share handler (SIMULATED
// authorities -> passport reader -> composition -> Chromium renderer -> re-read before release), over HTTP.
//   node apps/web/src/passport/card-capture.mjs [--port 5182]
// Shots land in shots/passport/card-*.png and share-*.png with contact sheets; console errors, off-host requests,
// horizontal overflow and text under 12 px fail the run.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5182);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/passport`;
const run = promisify(execFile);

const CARD_SHOTS = [
  ['card-many', { fixture: 'many' }, [1440, 900]],
  ['card-few', { fixture: 'few' }, [1440, 900]],
  ['card-none', { fixture: 'none' }, [1440, 900]],
  ['card-private', { fixture: 'few', state: 'hidden' }, [1440, 900]],
  ['card-phone', { fixture: 'many' }, [390, 844]],
];

let server, browser, release, renderer;
const report = { port, shots: [], console: [], external: [], checks: {} };
try {
  release = await acquireCaptureLock();
  let api;
  // The share route the bench points at, answered by the real handler for the requested SIMULATED book and state.
  const shareRoute = {
    name: 'passport-share-capture',
    configureServer(vite) {
      vite.middlewares.use('/-/passport/share.png', (request, response, next) => {
        (async () => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          const handler = api.handlerFor(url.searchParams.get('fixture') ?? 'many', url.searchParams.get('state') ?? 'shown');
          const answer = await handler.handle(new Request(`http://127.0.0.1:${port}/-/passport/share.png${url.search}`, { method: request.method }));
          response.statusCode = answer.status;
          answer.headers.forEach((value, key) => response.setHeader(key, value));
          response.end(Buffer.from(await answer.arrayBuffer()));
        })().catch(next);
      });
    },
  };
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error', plugins: [shareRoute],
    optimizeDeps: { noDiscovery: true, include: ['solid-js', 'solid-js/web', 'zod'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();

  // The server side, loaded exactly as written: the share handler, the warm renderer, the reader and the authorities.
  const load = path => server.ssrLoadModule(`${root}${path}`);
  const [share, chromiumRenderer, fonts, read, simulated, craft] = await Promise.all([
    load('apps/api/src/passport/share.ts'), load('apps/api/src/passport/chromium.ts'), load('apps/api/src/passport/fonts.ts'),
    load('apps/api/src/passport/read.ts'), load('apps/api/src/passport/simulated.ts'),
    load('packages/ui/src/passport/craft.ts'),
  ]);
  renderer = chromiumRenderer.createChromiumPassportImageRenderer();
  const fontFaces = fonts.passportFontFaces();
  const SCENARIO = { shown: { signedIn: true, travelsHidden: false }, hidden: { signedIn: true, travelsHidden: true }, unsigned: { signedIn: false, travelsHidden: false } };
  api = {
    handlerFor(fixture, state, extra = {}) {
      const authorities = simulated.simulatedPassportAuthorities(fixture, SCENARIO[state] ?? SCENARIO.shown);
      return share.createPassportShareHttp({
        reader: read.createPassportReader(authorities.ports), subject: async () => authorities.key, renderer, clock: () => authorities.now, fontFaces,
        report: fault => report.console.push(`share fault: ${JSON.stringify(fault)}`), ...extra,
      });
    },
  };

  await mkdir(output, { recursive: true });

  // ---------- The share image, through the handler ----------
  for (const fixture of ['many', 'few', 'none']) {
    const answer = await api.handlerFor(fixture, 'shown').handle(new Request(`http://127.0.0.1:${port}/share.png`));
    const headers = { status: answer.status, type: answer.headers.get('content-type'), cache: answer.headers.get('cache-control') };
    report.checks[`share-${fixture}`] = headers;
    if (answer.status !== 200 || headers.type !== 'image/png' || headers.cache !== 'no-store') throw new Error(`Share ${fixture} answered ${JSON.stringify(headers)}`);
    const bytes = new Uint8Array(await answer.arrayBuffer());
    if (!share.isShareImage(bytes)) throw new Error(`Share ${fixture} is not a 1200 x 800 PNG`);
    const path = `${output}/share-${fixture}@1200x800.png`;
    await writeFile(path, bytes);
    report.shots.push({ path: path.slice(root.length) });
    console.log(`Captured share-${fixture}@1200x800.`);
  }
  // A holder with a long Arabic name and a stamp from a kingdom with a very long name: the image wraps, never cuts.
  {
    const book = craft.simulatedPassport('few');
    const longName = { ...book, holder: { ...book.holder, name: 'نور الهدى بنت سليمان من واحة النخيل البعيدة' } };
    const bytes = await renderer.render(craft.composePassportShare(longName, { fontFaces }), AbortSignal.timeout(20_000));
    const path = `${output}/share-long-names@1200x800.png`;
    await writeFile(path, bytes);
    report.shots.push({ path: path.slice(root.length) });
  }
  // Hidden and never-signed-in books draw nothing: 404, no picture, and the renderer is never asked.
  for (const state of ['hidden', 'unsigned']) {
    let asked = false;
    const watching = { render: (...input) => { asked = true; return renderer.render(...input); } };
    const answer = await api.handlerFor('few', state, { renderer: watching }).handle(new Request(`http://127.0.0.1:${port}/share.png`));
    const body = await answer.text();
    report.checks[`share-${state}`] = { status: answer.status, type: answer.headers.get('content-type'), cache: answer.headers.get('cache-control'), asked, body };
    if (answer.status !== 404 || asked || /Pellam|Rook|Hollowmere|raid/i.test(body) || answer.headers.get('cache-control') !== 'no-store') {
      throw new Error(`A ${state} passport was shared: ${JSON.stringify(report.checks[`share-${state}`])}`);
    }
  }

  // ---------- The card page ----------
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const base = `http://127.0.0.1:${port}/-/passport`;
  const open = async (query, [width, height], context = {}) => {
    const scope = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, ...context });
    scope.on('response', response => { if (response.status() >= 400) report.console.push(`${JSON.stringify(query)}: ${response.status()} ${response.url()}`); });
    const page = await scope.newPage();
    page.on('close', () => { void scope.close(); });
    page.on('console', message => { if (message.type() === 'error') report.console.push(`${JSON.stringify(query)}: ${message.text()}`); });
    page.on('pageerror', error => report.console.push(`${JSON.stringify(query)}: ${error.message}`));
    page.on('request', request => { const url = new URL(request.url()); if (!['127.0.0.1', ''].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) report.external.push(request.url()); });
    await page.goto(`${base}?${new URLSearchParams({ surface: 'card', chrome: '0', ...query })}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 180_000 });
    // The print is the real served picture: wait until it has arrived (or the section has none to show).
    await page.waitForFunction(() => { const print = document.querySelector('.cpc-print'); return !print || print.dataset.picture !== 'loading'; }, {}, { timeout: 60_000 });
    return page;
  };
  const audit = page => page.evaluate(() => {
    let smallest = Infinity, where = '';
    const walker = document.createTreeWalker(document.querySelector('.cpc') ?? document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest('svg, .cpc-visually-hidden')) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < smallest) { smallest = size; where = node.textContent.trim().slice(0, 30); }
    }
    return { smallest, where, overflow: document.documentElement.scrollWidth > window.innerWidth, picture: document.querySelector('.cpc-print')?.dataset.picture ?? 'none' };
  });

  for (const [name, query, viewport] of CARD_SHOTS) {
    const page = await open(query, viewport);
    await page.waitForTimeout(600);
    const path = `${output}/${name}@${viewport[0]}x${viewport[1]}.png`;
    await page.screenshot({ path, fullPage: viewport[0] < 500 });
    const result = await audit(page);
    if (result.overflow) report.console.push(`${name}: horizontal overflow`);
    if (result.smallest < 12) report.console.push(`${name}: text at ${result.smallest}px ("${result.where}")`);
    if (query.state !== 'hidden' && result.picture !== 'shown') report.console.push(`${name}: the share picture did not arrive (${result.picture})`);
    report.shots.push({ path: path.slice(root.length), smallestText: result.smallest, picture: result.picture });
    await page.close();
    console.log(`Captured ${name}@${viewport.join('x')}.`);
  }

  // Private travels: the closed strapped book, no share shelf, and nothing of the holder's travels in text or names.
  {
    const page = await open({ fixture: 'few', state: 'hidden' }, [1440, 900]);
    const seen = await page.evaluate(() => {
      const section = document.querySelector('.cpc');
      const words = [section?.textContent ?? '', ...[...(section?.querySelectorAll('[aria-label], [alt], [href], [src]') ?? [])]
        .flatMap(node => ['aria-label', 'alt', 'href', 'src'].map(name => node.getAttribute(name) ?? ''))].join(' ');
      return { shelf: !!document.querySelector('.cpc-share'), exposed: ['Pellam', 'Rook', 'Hollowmere', 'Copperleaf', 'Brindlewick', 'Maple Wren', 'share.png', 'Journeys'].filter(word => words.includes(word)) };
    });
    report.checks.cardPrivate = seen;
    if (seen.shelf || seen.exposed.length) throw new Error(`A private card passport exposed: ${JSON.stringify(seen)}`);
    await page.close();
  }
  // Copying the link: acknowledged only after the clipboard resolves; refused, it lays the link out to select.
  {
    const page = await open({ fixture: 'few' }, [1440, 900], { permissions: ['clipboard-read', 'clipboard-write'] });
    await page.focus('.cpc-button');
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cpc-share-status:has-text("on your clipboard")', { timeout: 5_000 });
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    report.checks.copy = { ring, clipboard, label: await page.textContent('.cpc-button') };
    if (!/\/-\/passport\/share\.png\?fixture=few/.test(clipboard) || !/Link copied/.test(report.checks.copy.label ?? '')) throw new Error(`Copy failed: ${JSON.stringify(report.checks.copy)}`);
    // A browser that refuses the clipboard.
    await page.context().addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true);
    await page.click('.cpc-button');
    await page.waitForSelector('.cpc-share-field input', { timeout: 5_000 });
    const refused = await page.evaluate(() => ({ value: document.querySelector('.cpc-share-field input')?.value, focused: document.activeElement?.tagName, label: document.querySelector('.cpc-button')?.textContent }));
    report.checks.copyRefused = refused;
    if (!/share\.png/.test(refused.value ?? '') || /copied/i.test(refused.label ?? '')) throw new Error(`Refused copy pretended: ${JSON.stringify(refused)}`);
    await page.close();
  }
  // The book still turns by keyboard on the card page, and the reduced-motion settle holds.
  {
    const page = await open({ fixture: 'many' }, [1440, 900], { reducedMotion: 'reduce' });
    const before = await page.textContent('.pp-where');
    await page.focus('.pp-turn[data-dir="next"]');
    await page.keyboard.press('ArrowRight');
    const after = await page.textContent('.pp-where');
    const motes = await page.evaluate(() => getComputedStyle(document.querySelector('.cpc-motes i')).animationName);
    report.checks.cardKeyboard = { before, after, motes };
    if (before === after || motes !== 'none') throw new Error(`Card book did not turn or kept moving: ${JSON.stringify(report.checks.cardKeyboard)}`);
    await page.close();
  }

  // The holder's clasp. The change is asked and the book stays as it is until the authority acknowledges it; then the
  // book closes, the print goes, the card keeps its homes. Shown again is a fresh read with its own print.
  {
    const page = await open({ fixture: 'few', owner: '1' }, [1440, 900]);
    const look = () => page.evaluate(() => {
      const section = document.querySelector('.cpc');
      const clasp = document.querySelector('.cpc-clasp');
      const words = [section?.textContent ?? '', ...[...(section?.querySelectorAll('[aria-label], [alt], [href], [src]') ?? [])]
        .flatMap(node => ['aria-label', 'alt', 'href', 'src'].map(name => node.getAttribute(name) ?? ''))].join(' ');
      return {
        state: section?.dataset.state, checked: clasp?.getAttribute('aria-checked'), busy: clasp?.getAttribute('aria-busy'),
        status: document.querySelector('.cpc-owner-status')?.textContent ?? '', shelf: !!document.querySelector('.cpc-share'),
        print: document.querySelector('.cpc-print img')?.getAttribute('src') ?? null, home: document.querySelector('.ppb-card-kingdom')?.textContent ?? '',
        exposed: ['Pellam', 'Rook', 'Hollowmere', 'Copperleaf', 'Brindlewick', 'share.png', 'Journeys'].filter(word => words.includes(word)),
      };
    });
    const shoot = async name => {
      await page.waitForTimeout(450);
      const path = `${output}/${name}@1440x900.png`;
      await page.screenshot({ path });
      report.shots.push({ path: path.slice(root.length) });
    };
    const resting = await look();
    await shoot('card-owner');
    await page.focus('.cpc-clasp');
    await page.keyboard.press('Enter');
    const asking = await look();
    await shoot('card-owner-asking');
    await page.waitForSelector('.cpc[data-state="hidden"]', { timeout: 10_000 });
    const hidden = await look();
    await shoot('card-owner-private');
    await page.click('.cpc-clasp');
    await page.waitForSelector('.cpc[data-state="visible"]', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('.cpc-print')?.dataset.picture === 'shown', {}, { timeout: 60_000 });
    const shown = await look();
    report.checks.owner = { resting, asking, hidden, shown };
    const problems = [
      resting.checked !== 'false' && 'the clasp did not start open',
      (asking.checked !== 'false' || asking.state !== 'visible' || asking.busy !== 'true' || !/Asking/.test(asking.status) || !asking.shelf) && 'the change was shown before it was acknowledged',
      (hidden.checked !== 'true' || hidden.shelf || hidden.print || hidden.exposed.length || !/no longer shown or served/.test(hidden.status)) && 'the acknowledged hide left something of the travels',
      hidden.home !== resting.home && 'the card lost its home with the travels',
      (shown.checked !== 'false' || !shown.print || shown.print === resting.print || !/snapshot=/.test(shown.print)) && 'shown again did not read a fresh snapshot with its own print',
    ].filter(Boolean);
    if (problems.length) throw new Error(`Owner change: ${problems.join('; ')}\n${JSON.stringify(report.checks.owner)}`);
    await page.close();
  }
  // A change the authority refuses: nothing moves, and the page says nothing changed.
  {
    const page = await open({ fixture: 'few', owner: 'fail' }, [1440, 900]);
    await page.click('.cpc-clasp');
    await page.waitForSelector('.cpc-owner[data-ask="failed"]', { timeout: 10_000 });
    const failed = await page.evaluate(() => ({
      state: document.querySelector('.cpc')?.dataset.state, checked: document.querySelector('.cpc-clasp')?.getAttribute('aria-checked'),
      status: document.querySelector('.cpc-owner-status')?.textContent ?? '', shelf: !!document.querySelector('.cpc-share'),
    }));
    report.checks.ownerRefused = failed;
    await page.waitForTimeout(300);
    const path = `${output}/card-owner-refused@1440x900.png`;
    await page.screenshot({ path });
    report.shots.push({ path: path.slice(root.length) });
    if (failed.state !== 'visible' || failed.checked !== 'false' || !/Nothing changed/.test(failed.status) || !failed.shelf) throw new Error(`Refused change pretended: ${JSON.stringify(failed)}`);
    await page.close();
  }

  const sheet = (names, file, size) => run('ffmpeg', ['-y', '-loglevel', 'error', ...names.flatMap(name => ['-i', `${output}/${name}.png`]),
    '-filter_complex', `${names.map((_, i) => `[${i}]scale=${size}[s${i}]`).join(';')};[s0][s1]hstack[top];[s2][s3]hstack[bottom];[top][bottom]vstack`, `${output}/${file}`]);
  await sheet(['card-many@1440x900', 'card-few@1440x900', 'card-none@1440x900', 'card-private@1440x900'], 'card-contact@1440x900.png', '720:450');
  await sheet(['share-many@1200x800', 'share-few@1200x800', 'share-none@1200x800', 'share-long-names@1200x800'], 'share-contact@1200x800.png', '600:400');
  await sheet(['card-owner@1440x900', 'card-owner-asking@1440x900', 'card-owner-private@1440x900', 'card-owner-refused@1440x900'], 'card-owner-contact@1440x900.png', '720:450');
  report.shots.push({ path: 'shots/passport/card-contact@1440x900.png' }, { path: 'shots/passport/share-contact@1200x800.png' }, { path: 'shots/passport/card-owner-contact@1440x900.png' });

  await writeFile(`${output}/card-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (report.console.length || report.external.length) throw new Error(`Capture problems:\n${[...report.console, ...report.external].join('\n')}`);
  console.log(`Captured ${report.shots.length} frames into ${output} (port ${port}).`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await renderer?.dispose(); } finally {
    try { await browser?.close(); } finally {
      try { await server?.close(); } finally { await release?.(); }
    }
  }
}
