// The ledger, the HUD and the door curtain on the real GPU: every bench state at 1440×900 and 390×844 through
// `chatdom-pc shot`. Run only inside the lease, which checks 5191 and 5192 are free and forwards them:
//   chatdom-pc-lease -- node apps/web/src/play/bench/gpu-stills.mjs [--out work/evidence/play/gpu]
// The bench is the dev server's own page (never in the build); this serves it on 5192 for the length of the lease.
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'work/evidence/play/gpu' }, only: { type: 'string' } } });
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const LEDGER = [
  ['hud-idle', 'index.html?cursor=idle'], ['hud-touch', 'index.html?cursor=touch&prompt=1&slots=1'],
  ['settings', 'index.html?page=settings'], ['way-home', 'index.html?page=way-home'], ['way-home-inside', 'index.html?page=way-home&home=inside'],
  ['build', 'index.html?page=build'], ['build-closed', 'index.html?page=build&build=closed'], ['help', 'index.html?page=help&slots=1'],
  ['slots', 'index.html?page=look&slots=1'], ['portal-closed', 'portal.html?state=closed'], ['portal-stranded', 'portal.html?state=stranded'],
];
// PL12: your card with what you forged, the minimap and the big map on both lands (paths from src/play/).
const PL12 = [
  ['card', '../card/bench.html?state=ready&forged=1'], ['card-plain', '../card/bench.html?state=ready'],
  ['minimap-old', '../map/bench.html?view=mini'], ['minimap-grand', '../map/bench.html?view=mini&land=grand'],
  ['map-old', '../map/bench.html?view=page'], ['map-grand', '../map/bench.html?view=page&land=grand'],
];
LEDGER.push(...PL12);
const SIZES = ['1440x900', '390x844'];
const wanted = values.only ? new Set(values.only.split(',')) : null;
await mkdir(values.out, { recursive: true });
const web = await createServer({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5192, strictPort: true, hmr: false } });
await web.listen();
let failed = 0;
try {
  for (const [name, path] of LEDGER) {
    if (wanted && !wanted.has(name)) continue;
    for (const size of SIZES) {
      const out = `${values.out}/${name}-gpu@${size}.png`;
      const code = await new Promise(resolve => spawn('chatdom-pc', ['shot', `http://localhost:5192/src/play/bench/${path}`, out, '--size', size, '--settle', '2'], { stdio: 'inherit' }).once('exit', resolve));
      if (code !== 0) failed++;
      console.log(`${code === 0 ? 'shot' : 'FAILED'} ${out}`);
    }
  }
} finally { await web.close(); }
process.exit(failed ? 1 : 0);
