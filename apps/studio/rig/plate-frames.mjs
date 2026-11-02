// Unpacks a verified film take's master into the numbered JPEG frames the studio page shows in its player
// (`takes/<take>/frames/000000.jpg` …), one per master frame. Then point src/shot-list/plates.ts at `<take>/frames`.
//   nice -n 19 node rig/plate-frames.mjs film-stream-dusk
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAKES_DIR } from './film.mjs';

const take = process.argv[2];
if (!take) { process.stderr.write('usage: plate-frames.mjs <take>\n'); process.exit(2); }
const sidecar = JSON.parse(readFileSync(join(TAKES_DIR, take, 'take.json'), 'utf8'));
if (!sidecar.verify?.ok || !existsSync(sidecar.verify.master)) { process.stderr.write(`${take}: no verified master\n`); process.exit(1); }
const out = join(TAKES_DIR, take, 'frames');
mkdirSync(out, { recursive: true });
const run = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '4', '-i', sidecar.verify.master, '-start_number', '0', '-q:v', '2', join(out, '%06d.jpg')], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
const count = readdirSync(out).filter(f => f.endsWith('.jpg')).length;
if (count !== sidecar.verify.masterFrames) { process.stderr.write(`${take}: ${count} frames unpacked, ${sidecar.verify.masterFrames} in the master\n`); process.exit(1); }
process.stdout.write(`${out}: ${count} frames\n`);
