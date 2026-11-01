/* global getComputedStyle:readonly */
// Draws the citizen card's share picture (1200 x 630) for SIMULATED citizens, exactly as the server would: the pure
// composition from `card-share.ts`, set into a script-less, offline Chrome page and captured at its own size, plus a
// 320 px wide copy to judge it the way a link preview shows it. Runs under the shared capture lock.
//   node packages/ui/src/passport/card-share-capture.mjs [portrait.png] [--wait 15]
// The portrait defaults to the lane's sitting at /tmp/cp10/wren-512.png; while it is missing the script polls for up
// to --wait minutes (default 15), then draws the no-portrait state and says so.
// Shots land in shots/card-passport/share/<variant>.png and <variant>@320.png.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const waitMinutes = Number(option('--wait') ?? 15);
const portraitPath = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--wait') ?? '/tmp/cp10/wren-512.png';
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/card-passport/share`;
const run = promisify(execFile);

async function portraitBytes() {
  const deadline = Date.now() + waitMinutes * 60_000;
  let told = false;
  while (!existsSync(portraitPath)) {
    if (Date.now() >= deadline) {
      console.log(`[share] no portrait at ${portraitPath} after ${waitMinutes} min: drawing the no-portrait state`);
      return null;
    }
    if (!told) { console.log(`[share] waiting for ${portraitPath}`); told = true; }
    await sleep(15_000);
  }
  // A file still being written is read again until two reads agree.
  let bytes = await readFile(portraitPath);
  for (;;) {
    await sleep(500);
    const again = await readFile(portraitPath);
    if (again.equals(bytes) && bytes.length > 0) break;
    bytes = again;
  }
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

// The kit's own fonts, embedded as bytes exactly as `apps/api/src/passport/fonts.ts` supplies them to the server.
async function fontFaces() {
  const fonts = `${root}packages/ui/src/fonts/`;
  const face = async (family, style, file, weight = '400') =>
    `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${(await readFile(fonts + file)).toString('base64')}) format('woff2')}`;
  return (await Promise.all([
    face('IM Fell English', 'normal', 'im-fell-english-regular.woff2'), face('IM Fell English', 'italic', 'im-fell-english-italic.woff2'),
    face('IM Fell English SC', 'normal', 'im-fell-english-sc.woff2'),
    face('Alegreya', 'normal', 'alegreya-roman-latin.woff2', '400 900'), face('Alegreya', 'italic', 'alegreya-italic-latin.woff2', '400 900'),
  ])).join('');
}

/** An invented kingdom and its invented citizens: every picture here is SIMULATED and says so. */
const LANTERNMERE = { name: 'Lanternmere', crest: { key: 'crest:910000201:1', shape: 'heater', charge: 'star', colours: ['#2d3f66', '#e9c46a', '#8c2f24'], assetHash: null } };
const WREN_TENURE = [
  { label: 'Following since', value: '14 Feb 2022', mark: 'follow' },
  { label: 'Subscribed', value: '14 months, Tier 1', mark: 'subscribed' },
];
const WREN_WORN = [
  { name: 'Ember-stitched cloak', story: 'Earned at the first Midsummer bonfire' },
  { name: 'Lamplighter’s badge', story: null },
  { name: 'Harvest circlet', story: 'Worn by every keeper of the autumn fair' },
];

let server, browser, release;
const report = [];
try {
  const portraitSrc = await portraitBytes();
  // Vite in middleware mode: it loads the TypeScript modules as written and never listens on a port.
  server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  const craft = await server.ssrLoadModule(`${root}packages/ui/src/passport/craft.ts`);
  const faces = await fontFaces();
  const portrait = portraitSrc ? { src: portraitSrc, alt: 'A painted voxel bust of Wren Tarnwalker against Twitch purple' } : null;
  const wren = {
    origin: 'simulated', name: 'Wren Tarnwalker', login: 'wren_tarnwalker', colour: '#b22222',
    standing: ['Knight of the Watch', 'Citizen No. 212'], kingdom: LANTERNMERE,
    home: { name: 'Lantern Cottage', street: 'Old Row', tier: 'A cottage' }, tenure: WREN_TENURE, portrait, worn: WREN_WORN,
  };
  const variants = [
    ['many', { ...wren, passport: { hidden: false, book: craft.simulatedPassport('many') } }],
    ['hidden', { ...wren, passport: { hidden: true } }],
    ['empty', {
      origin: 'simulated', name: 'Juniper Ashdown', login: 'juniperashdown', colour: '#ffd700', standing: ['Citizen No. 1047'], kingdom: LANTERNMERE,
      home: null, tenure: [{ label: 'Following since', value: '2 Oct 2026', mark: 'follow' }, { label: 'Subscribed', value: null, mark: 'subscribed' }],
      portrait: null, worn: [], passport: { hidden: false, book: craft.simulatedPassport('none') },
    }],
    ['long-name', {
      ...wren, name: 'نور الهدى بنت سليمان من واحة النخيل البعيدة', login: 'nour_alhuda', colour: '#00ff7f', standing: ['Noble', 'Citizen No. 3'],
      home: { name: 'The House of the Seven Lanterns', street: 'Long Ridge Lane below the Old Watchtower', tier: 'A manor' },
      passport: { hidden: false, book: craft.simulatedPassport('few') },
    }],
  ];

  await mkdir(output, { recursive: true });
  release = await acquireCaptureLock();
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--font-render-hinting=none'] });
  for (const [name, card] of variants) {
    const share = craft.composeCitizenShare(card, { fontFaces: faces });
    const context = await browser.newContext({ viewport: { width: share.width, height: share.height }, deviceScaleFactor: 1, javaScriptEnabled: false, offline: true, reducedMotion: 'reduce' });
    const requests = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort('blockedbyclient'); });
    const page = await context.newPage();
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setContent(share.html, { waitUntil: 'load', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Text cut by its box is a fault: every text block must fit inside the picture and inside its own element.
    const clipped = await page.evaluate(() => [...document.querySelectorAll('h1,h2,p,li,span,strong')]
      .filter(element => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflow === 'hidden')
      .map(element => element.className || element.tagName));
    const file = `${output}/${name}.png`;
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: share.width, height: share.height }, animations: 'disabled' });
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf', 'scale=320:-1:flags=lanczos', `${output}/${name}@320.png`]);
    await context.close();
    report.push({ name, file, title: share.title, bytes: share.html.length, requests, errors, clipped, alt: share.alt });
    console.log(`[share] ${name}: ${file}${requests.length ? ` (refused ${requests.length} requests)` : ''}${clipped.length ? ` clipped: ${clipped.join(', ')}` : ''}`);
  }
  await writeFile(`${output}/report.json`, `${JSON.stringify({ portrait: portraitSrc ? portraitPath : null, shots: report }, null, 2)}\n`);
  if (report.some(shot => shot.requests.length || shot.errors.length)) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await release?.();
  await server?.close();
}
