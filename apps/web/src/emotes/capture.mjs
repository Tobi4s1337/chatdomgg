/* global URLSearchParams:readonly */
// Captures the emote workshop with Chrome/SwiftShader under the shared capture lock.
// node apps/web/src/emotes/capture.mjs [--set stream|matrix|kingdom|kingdom-sizes] [--hour <0-23>] [--base-url http://127.0.0.1:<port>] [--path /src/emotes/index.html] [--port <free 5170–5199 port>]
// `stream` (default): the waving statue at 1920×1080, held at the high wave and at rest, to compare frames.
// `matrix`: the E01 front/side/banner views at web and phone sizes.
// `kingdom`: the E07 stream shot, the statue and standards raised in the lit square at 1920×1080, held at the high wave.
// `kingdom-sizes`: the same square at web and phone sizes.
// `chat`: the E08 stream shot, the square listening to a SIMULATED chat: bubbles, lifted emotes and a chant's weather.
// Without --base-url it builds the bench's own HTML entry into /tmp and serves it with vite preview,
// so the shared router and build config stay untouched.
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const web = `${root}apps/web`;
const outDir = '/tmp/chatdom-emotes-bench';
const out = 'shots/emotes';
const SIZES = { desktop: [1440, 900], phone: [390, 844] };
const HOUR = Number(option('--hour') ?? 18);
const SETS = {
  stream: [3, 0].map(frame => ({ view: 'front', label: `stream-frame${frame}`, size: [1920, 1080], hour: HOUR, frame })),
  matrix: ['front', 'side', 'banner'].flatMap(view => Object.entries(SIZES).map(([label, size]) => ({ view, label, size, hour: 16, frame: 3 }))),
  kingdom: [{ view: 'kingdom', label: 'stream', size: [1920, 1080], hour: HOUR, frame: 3 }],
  'kingdom-sizes': Object.entries(SIZES).map(([label, size]) => ({ view: 'kingdom', label, size, hour: HOUR, frame: 3 })),
  chat: [{ view: 'chat', label: 'stream', size: [1920, 1080], hour: HOUR, frame: 3 }],
};
const SET = option('--set') ?? 'stream';
const SHOTS = SETS[SET];
if (!SHOTS) throw new Error(`--set is ${Object.keys(SETS).join(', ')}`);

let server, browser, release;
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  const path = option('--path') ?? '/src/emotes/index.html';
  if (!base) {
    // Port zero lets the OS pick a free port atomically; parallel lane captures never collide.
    const port = assertCapturePort(Number(option('--port') ?? 0), { allowZero: true, name: '--port' });
    await build({ root: web, configFile: `${web}/vite.config.ts`, logLevel: 'warn', build: { outDir, emptyOutDir: true, rollupOptions: { input: { emotes: `${web}/src/emotes/index.html` } } } });
    server = await preview({ root: web, configFile: `${web}/vite.config.ts`, build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('The bench preview has no TCP address.');
    base = `http://127.0.0.1:${address.port}`;
    console.log(`[emotes] serving the bench build at ${base}${path}`);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const taken = [];
  for (const shot of SHOTS) {
    const [width, height] = shot.size;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
    await page.goto(`${base}${path}?${new URLSearchParams({ view: shot.view, hour: String(shot.hour), frame: String(shot.frame) })}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomEmotesError === 'string', {}, { timeout: 240_000 });
    const error = await page.evaluate(() => window.__chatdomEmotesError);
    // Inline emotes are decoded from verified bytes by the browser; wait until every one is drawable.
    if (shot.view === 'chat') await page.waitForFunction(() => [...document.querySelectorAll('.emote-chat-layer img')].every(img => img.complete && img.naturalWidth > 0), {}, { timeout: 20_000 });
    if (error) throw new Error(`${shot.view}/${shot.label}: ${error}`);
    if (errors.length) throw new Error(`${shot.view}/${shot.label}: ${errors.join('\n')}`);
    const measured = await page.evaluate(() => ({
      ...window.__chatdomEmotes,
      overflow: document.scrollingElement.scrollWidth > window.innerWidth,
      simulatedVisible: [...document.querySelectorAll('.simulated')].some(el => el.getBoundingClientRect().width > 0 && window.getComputedStyle(el).visibility !== 'hidden'),
      flatAlt: [...document.querySelectorAll('canvas[role="img"]')].map(el => el.getAttribute('aria-label')),
      overlay: {
        bubbles: document.querySelectorAll('.emote-chat-bubble').length,
        pops: document.querySelectorAll('.emote-chat-pop').length,
        images: [...document.querySelectorAll('.emote-chat-layer img')].map(img => ({ alt: img.getAttribute('alt'), blob: img.getAttribute('src')?.startsWith('blob:') ?? false, loaded: img.complete && img.naturalWidth > 0 })),
        words: [...document.querySelectorAll('.emote-chat-alt')].map(el => el.textContent),
        markup: document.querySelectorAll('.emote-chat-layer b, .emote-chat-layer script').length,
      },
    }));
    if (measured.view !== shot.view || measured.hour !== shot.hour || measured.frameShown !== shot.frame) throw new Error(`${shot.view}/${shot.label}: the bench reported a different state.`);
    if (new Set(measured.frameSizes).size !== 1 || measured.frames < 2) throw new Error(`${shot.view}/${shot.label}: the animated frames do not share one grid.`);
    if (measured.source?.rendition !== 'gif' || measured.flatFrames !== measured.frames) throw new Error(`${shot.view}/${shot.label}: the statue did not come from the decoded GIF.`);
    if (measured.source?.origin !== 'simulated' || !measured.simulatedVisible) throw new Error(`${shot.view}/${shot.label}: the SIMULATED source is not labelled.`);
    if (!(measured.statueMetres >= 4 && measured.statueMetres <= 6)) throw new Error(`${shot.view}/${shot.label}: the statue stands ${measured.statueMetres} m.`);
    if (measured.overflow) throw new Error(`${shot.view}/${shot.label}: the page overflows horizontally.`);
    if (!(measured.triangles > 0) || !(measured.shadowCasters > 0)) throw new Error(`${shot.view}/${shot.label}: empty geometry or no shadow casters.`);
    if (shot.view === 'chat') {
      const chat = measured.chat, overlay = measured.overlay;
      if (!chat || chat.accepted < 6 || chat.rejected && Object.keys(chat.rejected).length) throw new Error(`${shot.label}: the SIMULATED chat was not accepted: ${JSON.stringify(chat)}`);
      if (!(chat.weatherParticles > 0) || !chat.weather.some(w => w.slots >= 3)) throw new Error(`${shot.label}: no chant weather is raining.`);
      if (overlay.bubbles < 2 || overlay.pops < 1 || !overlay.images.length || !overlay.images.every(i => i.alt && i.blob && i.loaded)) throw new Error(`${shot.label}: bubbles or lifted emotes are missing: ${JSON.stringify(overlay)}`);
      if (!overlay.words.includes('gonefish') || overlay.markup) throw new Error(`${shot.label}: an unknown emote lost its words, or text became markup.`);
      if (measured.citizens !== 6 || !measured.post?.hdr) throw new Error(`${shot.label}: ${measured.citizens} SIMULATED citizens; the post stack ${measured.post?.hdr ? 'runs' : 'is off'}.`);
    }
    if (shot.view === 'kingdom') {
      // The square must be a town, not a plinth: homes with lit windows, both standards, lanterns and people for scale.
      if (!(measured.homes >= 4) || !(measured.litWindows > 0)) throw new Error(`${shot.view}/${shot.label}: ${measured.homes} homes, ${measured.litWindows} lit windows.`);
      if (measured.banners < 2 || !(measured.clothStrips > 1) || measured.lanterns < 2) throw new Error(`${shot.view}/${shot.label}: the standards or lanterns are missing.`);
      if (!(measured.citizens >= 1 && measured.citizens <= 2)) throw new Error(`${shot.view}/${shot.label}: ${measured.citizens} SIMULATED citizens; the square keeps one or two.`);
      if (!measured.post?.hdr) throw new Error(`${shot.view}/${shot.label}: the HDR post stack is not running.`);
    }
    await mkdir(out, { recursive: true });
    const file = `${out}/${shot.view}-${shot.label}@${width}x${height}.png`;
    await page.screenshot({ path: file });
    await page.close();
    taken.push({ ...shot, file, measured });
    console.log(`[emotes] ${file} · frame ${measured.frameShown}/${measured.frames} · ${measured.statueCells.join('×')} cells · ${measured.triangles} triangles · ${measured.draws} draws`);
  }
  const tiles = await Promise.all(taken.map(async shot => ({ ...shot, data: (await readFile(shot.file)).toString('base64') })));
  const sheet = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await sheet.setContent(`<html><body style="margin:0;background:#292830;color:#eadfc8;font:13px Georgia"><h1 style="font-weight:normal;font-size:20px;margin:16px 20px 4px">Chatdom · Emote workshop · ${SET === 'chat' ? 'E08 · chat in the square' : SET.startsWith('kingdom') ? 'E07 · the square' : 'E02'}</h1><p style="margin:0 20px 12px;color:#c6b493">SIMULATED source (original animated toadWave GIF) · real decoder, compiler, voxel workers, clay material, light field and sun shadows</p><div style="display:flex;flex-wrap:wrap;gap:10px;padding:0 20px 20px">${tiles.map(t => `<figure style="margin:0;width:${t.size[0] < 1000 ? 150 : 660}px"><img style="width:100%;display:block" src="data:image/png;base64,${t.data}"><figcaption style="padding-top:4px">${t.view} · ${t.label}</figcaption></figure>`).join('')}</div></body></html>`);
  await sheet.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  // The square's sets keep their own sheet and stats so the stream set's evidence stays beside them.
  const suffix = SET.startsWith('kingdom') || SET === 'chat' ? `-${SET}` : '';
  await sheet.screenshot({ path: `${out}/review-sheet${suffix}@1440.png`, fullPage: true });
  await sheet.close();
  await writeFile(`${out}/capture-stats${suffix}.json`, JSON.stringify(taken.map(({ file, view, label, measured }) => ({ file, view, label, ...measured })), null, 2) + '\n');
  console.log(`[emotes] ${taken.length} views, sheet ${out}/review-sheet${suffix}@1440.png`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(() => resolve()));
  await release?.();
}
