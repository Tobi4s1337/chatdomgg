// Your look on the real GPU: the builder on the page and in the Twitch panel, its card, close-ups, an unlock reveal,
// earned pieces, the mirror, the ledger page, the contact sheet of pieces, the wardrobe at home, and the build rack.
// Run only inside the lease, which checks 5191 and 5192 are free and forwards them:
//   chatdom-pc-lease -- node apps/web/src/avatar-builder/gpu-stills.mjs [--out work/evidence/play/look] [--only a,b]
// The bench is the dev server's own page (never in the build); this serves it on 5192 for the length of the lease.
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'work/evidence/play/look' }, only: { type: 'string' } } });
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const BENCH = 'src/avatar-builder/builder.html?still=1&';
const TABS = ['face', 'hair', 'beard', 'hat', 'trinkets', 'top', 'layer', 'below', 'carry', 'earned', 'yours'];
/** name, path, sizes */
const STILLS = [
  ...TABS.map(tab => [`page-${tab}`, `${BENCH}who=veteran&tab=${tab}`, ['1440x900']]),
  ...TABS.map(tab => [`panel-${tab}`, `${BENCH}who=veteran&tab=${tab}&layout=panel`, ['318x496']]),
  ['phone-hair', `${BENCH}who=regular&tab=hair`, ['390x844']],
  ['card', `${BENCH}who=regular&tab=hair&inspect=hair:curls`, ['1440x900']],
  ['closeup-face', `${BENCH}who=regular&tab=face&focus=face`, ['1440x900']],
  ['closeup-hands', `${BENCH}who=regular&tab=carry&focus=hands`, ['1440x900']],
  ['reveal', `${BENCH}view=reveal&who=veteran`, ['1440x900', '318x496']],
  ['earned', `${BENCH}who=veteran&tab=earned&focus=badge&inspect=ribbons`, ['1440x900']],
  ['mirror', `${BENCH}view=mirror&who=newcomer`, ['1440x900', '390x844']],
  ['ledger-look', `${BENCH}view=ledger&who=veteran`, ['1440x900', '390x844']],
  ['contact-new', `${BENCH}view=pieces`, ['1440x900']],
  ['contact-all', `${BENCH}view=pieces&pieces=all`, ['1440x900']],
  ['wardrobe-mirror', 'src/avatar-builder/wardrobe-bench.html?view=mirror', ['1440x900']],
  ['wardrobe-room', 'src/avatar-builder/wardrobe-bench.html?view=room', ['1440x900']],
  ['rack', '?tier=hamlet&hour=19.5&time=60&seed=willowmere&build=1&source=simulated', ['1440x900', '390x844']],
];
const wanted = values.only ? new Set(values.only.split(',')) : null;
await mkdir(values.out, { recursive: true });
const web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5192, strictPort: true, hmr: false } });
await web.listen();
let failed = 0;
try {
  for (const [name, path, sizes] of STILLS) {
    if (wanted && !wanted.has(name)) continue;
    for (const size of sizes) {
      const out = `${values.out}/${name}-gpu@${size}.png`;
      const timeout = name === 'rack' ? '240' : '120';
      const code = await new Promise(resolve => spawn('chatdom-pc', ['shot', `http://localhost:5192/${path}`, out, '--size', size, '--timeout', timeout, '--settle', '2'], { stdio: 'inherit' }).once('exit', resolve));
      if (code !== 0) failed++;
      console.log(`${code === 0 ? 'shot' : 'FAILED'} ${out}`);
    }
  }
} finally { await web.close(); }
process.exit(failed ? 1 : 0);
