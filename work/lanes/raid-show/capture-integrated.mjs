// RS11 stills that need atlas-map's gate mode, on Tobias's real-GPU Chrome. The build is an integrated one: the
// integrator's tree with this lane's raid-gate files over it, built into RAID_INTEGRATED_DIST from that tree's
// apps/web (its vite config proxies /map-data to CHATDOM_ATLAS_TARGET, the public map service). Run from the repo root:
//   CHATDOM_ATLAS_TARGET=https://chatdom.io RAID_INTEGRATED_ROOT=/tmp/rs11-integ RAID_INTEGRATED_DIST=/tmp/rs11-integ-dist \
//     chatdom-pc-lease --wait 30 --max 9 -- node --experimental-strip-types work/lanes/raid-show/capture-integrated.mjs [names]
// names: comma-separated of gate-mode, preview, walk-road, walk-road-phone (default all). PNGs and their states go to
// work/evidence/raid-show as gpu-integrated-<name>@<size>.
import { writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { openPcPage } from '../../../apps/realm/src/raid-gate/incoming-show-pages.ts';

const OUT = 'work/evidence/raid-show';
const ROOT = process.env.RAID_INTEGRATED_ROOT ?? '/tmp/rs11-integ';
const SHOTS = {
  'gate-mode': { path: '/-/raid-gate?bench=simulated&map=atlas&finder=1&tier=town', size: [1920, 1080] },
  preview: { path: '/-/raid-gate?bench=simulated&map=atlas&pick=4363967&walkers=4&tier=town', size: [1920, 1080] },
  'walk-road': { path: '/-/raid-gate?walkGate=road&map=atlas', size: [1920, 1080] },
  'walk-road-phone': { path: '/-/raid-gate?walkGate=road&map=atlas', size: [390, 844] },
};
const names = (process.argv[2] ?? Object.keys(SHOTS).join(',')).split(',');

const server = await preview({ root: `${ROOT}/apps/web`, configFile: `${ROOT}/apps/web/vite.config.ts`, logLevel: 'warn',
  build: { outDir: process.env.RAID_INTEGRATED_DIST ?? '/tmp/rs11-integ-dist' }, preview: { host: '127.0.0.1', port: 5192, strictPort: true } });
try {
  for (const name of names) {
    const shot = SHOTS[name];
    if (!shot) throw new Error(`No shot ${name}`);
    const [width, height] = shot.size;
    const page = await openPcPage(width, height);
    console.log(`[${name}] renderer ${page.renderer}`);
    try {
      const began = Date.now();
      await page.goto(`http://localhost:5192${shot.path}`);
      await page.waitReady(150_000);
      // The gate bench says it is staged on its own flag; the kingdom scene raises the page's ready flag earlier.
      if (shot.path.includes('bench=simulated')) {
        for (const until = Date.now() + 60_000; !(await page.evaluate(() => window.__chatdomRaidGate?.ready === true)) && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 250));
      }
      const state = await page.evaluate(() => ({
        walk: window.__walkGate ?? null,
        phase: window.__chatdomRaidGate?.snapshot().phase ?? null,
        map: document.querySelector('[data-chatdom-atlas]')?.getAttribute('data-atlas-ready') ?? null,
        layer: document.querySelector('.rj-layer')?.getAttribute('data-map') ?? null,
      }));
      const file = `${OUT}/gpu-integrated-${name}@${width}x${height}`;
      await page.screenshot(`${file}.png`);
      await writeFile(`${file}.json`, `${JSON.stringify({ path: shot.path, renderer: page.renderer, seconds: Math.round((Date.now() - began) / 1000), state, errors: page.errors, console: page.console.slice(-30) }, null, 2)}\n`);
      console.log(`[${name}] ${file}.png`, JSON.stringify(state));
    } finally {
      await page.close();
    }
  }
} finally {
  await new Promise(resolve => server.httpServer.close(resolve));
}
