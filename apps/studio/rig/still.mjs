// One still of any studio URL on this host, for checking a set piece by eye (SwiftShader: stills only, never
// footage, and its timings mean nothing). Holds the shared capture lock for the one frame and runs niced.
//
//   nice -n 19 node rig/still.mjs --url "/studio/set.html?scene=kingdom&shot=S22&from=3" --out /tmp/s22.png \
//     --port 5182 [--size 1920x1080] [--preroll 0.1] [--settle "window.__set?.idle()"] [--timeout 600]
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { record } from './record.mjs';

const f = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const next = argv[i + 1]; f[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : (i++, next); }
if (!f.url || !f.out || !f.port) { process.stderr.write('usage: still.mjs --url /studio/… --out file.png --port <capture port>\n'); process.exit(2); }
const port = assertCapturePort(Number(f.port));
const [width, height] = String(f.size ?? '1920x1080').split('x').map(Number);
const dir = mkdtempSync(join(tmpdir(), 'studio-still-'));
const release = await acquireCaptureLock();
try {
  const take = await record({ url: String(f.url), out: dir, from: 0, to: 1 / 60, fps: 60, width, height, port, format: 'png',
    settle: f.settle === undefined ? 'window.__set ? window.__set.idle() : true' : String(f.settle), preroll: Number(f.preroll ?? 0),
    readyTimeout: Number(f.timeout ?? 600), take: 'still', log: line => process.stdout.write(`${line}\n`) });
  copyFileSync(join(dir, '000000.png'), resolve(String(f.out)));
  process.stdout.write(`${resolve(String(f.out))} · ${take.renderer}\n`);
} finally {
  await release();
  rmSync(dir, { recursive: true, force: true });
}
