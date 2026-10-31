/* global URLSearchParams:readonly */
// Captures the lane-local heraldry bench: one 1920×1080 stream-first frame per requested recipe.
//   node packages/content/src/genesis-heraldry/bench/capture.mjs --recipe 0 --land 2 [--targets profile] [--hour 19.1] [--size 1920x1080]
//   node packages/content/src/genesis-heraldry/bench/capture.mjs --showcase [--hour 19.1]
// Writes shots/genesis-heraldry/<style>-<landscape>-<shape>-<charge>-<cut>[-snapped]@<w>x<h>.png, or for --showcase
// the three showcase proposals on their selected lands as one triptych, shots/genesis-heraldry/showcase-three-lands@1920x1080.png.
// The server is an OS-assigned port, closed after.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const recipe = option('--recipe', '0'), land = option('--land', '2'), hour = option('--hour', '19.1'), targets = option('--targets', 'none');
const [width, height] = option('--size', '1920x1080').split('x').map(Number);
const showcase = args.includes('--showcase');
/** Plain names for the materials a neutral proposal wears. */
const TINCTURE = { cream: 'linen', slate: 'slate', terracotta: 'terracotta', leaf: 'leaf green', brass: 'brass' };
const VISION = { typical: 'typical vision', protanopia: 'protanopia', deuteranopia: 'deuteranopia', tritanopia: 'tritanopia' };

if (!/^[012]$/.test(recipe) || !/^[012]$/.test(land)) throw new Error('--recipe and --land are 0, 1 or 2.');
if (!/^(none|profile)$/.test(targets)) throw new Error('--targets is none or profile.');
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const bench = fileURLToPath(new URL('.', import.meta.url));

let server, browser, release;
try {
  release = await acquireCaptureLock();
  server = await createServer({
    root: bench, configFile: false, logLevel: 'warn', appType: 'mpa',
    server: { host: '127.0.0.1', port: assertCapturePort(0, { allowZero: true }), strictPort: true, hmr: false, fs: { allow: [repo] } },
    resolve: {
      alias: [
        { find: /^three$/, replacement: `${repo}packages/render/node_modules/three/build/three.module.js` },
        { find: /^@chatdom\/render$/, replacement: `${repo}packages/render/src/index.ts` },
        { find: /^@chatdom\/voxel$/, replacement: `${repo}packages/voxel/src/index.ts` },
      ],
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: showcase ? { width: 640, height: 1080 } : { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const render = async query => {
    await page.goto(`${base}/index.html?${new URLSearchParams(query)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomBenchError === 'string', {}, { timeout: 300_000 });
    const failure = await page.evaluate(() => window.__chatdomBenchError);
    if (failure) throw new Error(failure);
    if (errors.length) throw new Error(errors.join('\n'));
    return page.evaluate(() => window.__chatdomBench);
  };
  const output = `${repo}shots/genesis-heraldry`;
  await mkdir(output, { recursive: true });
  if (showcase) {
    const panels = [];
    for (const index of ['0', '1', '2']) {
      const info = await render({ showcase: index, panel: '1', hour });
      panels.push({ info, image: (await page.screenshot()).toString('base64') });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setContent(triptych(panels), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    const path = `${output}/showcase-three-lands@1920x1080.png`;
    await page.screenshot({ path });
    console.log(JSON.stringify({ path: path.replace(repo, ''), panels: panels.map(({ info }) => info) }));
  } else {
    const info = await render({ recipe, land, hour, targets });
    const { shape, charge, cut } = info.device;
    const path = `${output}/${info.style}-${info.land}-${shape}-${charge}-${cut}${info.treatment === 'snapped' ? '-snapped' : ''}@${width}x${height}.png`;
    await page.screenshot({ path });
    console.log(JSON.stringify({ ...info, path: path.replace(repo, '') }));
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}


/** The three panels side by side in a carved frame, each with its plate, and one SIMULATED chip for the whole frame. */
function triptych(panels) {
  const plate = ({ info }) => {
    const { shape, charge, cut } = info.device;
    const [weakest, ratio] = Object.entries(info.legibility).sort((a, b) => a[1] - b[1])[0];
    return `<div class="plate">
      <div class="name">${info.name}</div>
      <div class="land">${info.land.replace('-', ' ')} · ${info.styleName}</div>
      <div class="device">${charge} on a ${shape} · ${cut} cloth</div>
      <div class="colours"><i style="background:var(--${info.colours.field})"></i><i style="background:var(--${info.colours.charge})"></i>
        ${TINCTURE[info.colours.charge] ?? info.colours.charge} on ${TINCTURE[info.colours.field] ?? info.colours.field} · at least ${ratio.toFixed(1)}:1 (${VISION[weakest]})</div>
    </div>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { --cream: #e5d8b7; --slate: #41677d; --terracotta: #a85b47; --leaf: #4c7554; }
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #120d0a; }
    .row { display: flex; width: 1920px; height: 1080px; }
    .panel { position: relative; width: 640px; height: 1080px; }
    .panel img { display: block; width: 640px; height: 1080px; }
    .panel + .panel::before { content: ''; position: absolute; z-index: 2; left: -2px; top: 0; bottom: 0; width: 4px;
      background: linear-gradient(90deg, #120d0a, #120d0a 1px, rgba(198, 156, 92, .85) 1px, rgba(198, 156, 92, .85) 3px, #120d0a 3px); }
    .plate { position: absolute; left: 0; right: 0; bottom: 0; padding: 54px 30px 24px; color: #f1e3c4;
      background: linear-gradient(180deg, rgba(18, 12, 9, 0), rgba(18, 12, 9, .7) 46%, rgba(18, 12, 9, .88)); font-family: Georgia, 'Times New Roman', serif; }
    .name { font-size: 30px; line-height: 1.1; letter-spacing: .01em; }
    .land { margin-top: 6px; font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: #e2c48f; }
    .device { margin-top: 8px; font-size: 16px; color: #efe1c2; }
    .colours { margin-top: 10px; font-size: 13px; letter-spacing: .03em; color: #d9c9a8; display: flex; align-items: center; gap: 0; }
    .colours i { display: inline-block; width: 14px; height: 14px; margin-right: 5px; border: 1px solid rgba(214, 170, 96, .8); }
    .colours i + i { margin-right: 10px; }
    .title { position: absolute; z-index: 3; left: 30px; top: 26px; font: 15px/1.3 Georgia, 'Times New Roman', serif; color: #f1e3c4;
      text-shadow: 0 1px 3px rgba(0, 0, 0, .8); letter-spacing: .04em; }
    .title small { display: block; font-size: 12px; letter-spacing: .12em; color: #ead6ad; text-transform: uppercase; }
    .chip { position: absolute; z-index: 3; top: 18px; right: 18px; padding: 5px 10px 4px; border-radius: 4px; font: 600 12px/1 Georgia, 'Times New Roman', serif;
      letter-spacing: .14em; color: #f3dfb0; background: rgba(44, 28, 18, .78); border: 1px solid rgba(214, 170, 96, .7); }
  </style></head><body>
    <div class="row">${panels.map(panel => `<div class="panel"><img src="data:image/png;base64,${panel.image}" alt="">${plate(panel)}</div>`).join('')}</div>
    <div class="title">Genesis heraldry<small>Three neutral proposals, each on its chosen land</small></div>
    <div class="chip">SIMULATED</div>
  </body></html>`;
}
