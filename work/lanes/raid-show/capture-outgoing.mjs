// RS11 stills of the raid road on Tobias's real-GPU Chrome. Run inside pc-lease from the repo root, after building
// the web app into RAID_ROAD_DIST (default /tmp/rs11-dist):
//   chatdom-pc-lease --wait 30 --max 9 -- node --experimental-strip-types work/lanes/raid-show/capture-outgoing.mjs [runs]
// runs: comma-separated of founded, waiting, phone (default all three). The journey plays in real time on the GPU;
// each still is taken when the route's own state reaches its stage. PNGs and their states go to work/evidence/raid-show.
import { writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { openPcPage } from '../../../apps/realm/src/raid-gate/incoming-show-pages.ts';

const OUT = 'work/evidence/raid-show';
const runs = (process.argv[2] ?? 'founded,waiting,phone').split(',');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const span = (state, act) => state.spans.find(each => each.act === act);

const STAGES = {
  founded: [
    ['gather', s => s.t >= 6.4],
    ['countdown', s => s.t >= 12.5 && s.act === 'gather'],
    ['setout', s => s.act === 'setout' && s.t - span(s, 'setout').start >= 3.2],
    ['rise', s => s.act === 'rise' && s.progress >= 0.5],
    ['road', s => s.act === 'ride' && s.progress >= 0.5],
    ['arrive', s => s.act === 'welcome' && s.t - span(s, 'welcome').start >= 3],
    ['home', s => s.act === 'home' && s.homeReady && s.t - span(s, 'home').start >= 2.2],
  ],
  waiting: [['land', s => s.act === 'land' && s.t - span(s, 'land').start >= 2.5]],
  phone: [['countdown', s => s.t >= 12.5 && s.act === 'gather']],
};

const server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'warn',
  build: { outDir: process.env.RAID_ROAD_DIST ?? '/tmp/rs11-dist' }, preview: { host: '127.0.0.1', port: 5192, strictPort: true } });
try {
  for (const run of runs) {
    const [width, height] = run === 'phone' ? [390, 844] : [1920, 1080];
    const page = await openPcPage(width, height);
    console.log(`[${run}] renderer ${page.renderer}`);
    try {
      await page.goto(`http://localhost:5192/-/raid-gate?bench=simulated&road=1${run === 'waiting' ? '&to=waiting' : ''}`);
      await page.waitReady(180_000);
      const began = Date.now();
      for (const [name, reached] of STAGES[run]) {
        let state;
        for (;;) {
          state = await page.evaluate(() => ({ ...window.__raidRoad.state(), spans: window.__raidRoad.spans() }));
          if (state.worldError || state.mapError) throw new Error(`${run}: ${state.worldError ?? state.mapError}`);
          if (reached(state)) break;
          if (Date.now() - began > 240_000) throw new Error(`${run}: ${name} never reached (${state.act} t=${state.t})`);
          await sleep(150);
        }
        const file = `${OUT}/gpu-road-${run === 'phone' ? 'walker' : run}-${name}@${width}x${height}`;
        await page.screenshot(`${file}.png`);
        const { snapshot, spans, ...rest } = state;
        await writeFile(`${file}.json`, `${JSON.stringify({ ...rest, phase: snapshot?.phase, optedIn: snapshot?.optedIn, journey: snapshot?.journey?.state ?? null, renderer: page.renderer, errors: page.errors }, null, 2)}\n`);
        console.log(`[${run}] ${name} t=${state.t.toFixed(1)} act=${state.act} party=${JSON.stringify(state.party)} directing=${state.directing}`);
      }
    } finally { await page.close(); }
  }
} finally { await server.close(); }
