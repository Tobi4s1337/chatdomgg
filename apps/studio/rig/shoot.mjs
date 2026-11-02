// The shoot: renders the film takes (rig/film.mjs) on Tobias's real-GPU Chrome, one lease at a time, in chunks
// that fit a lease. Each lease records with a wall-time budget, stops cleanly and the next lease resumes at the
// first missing frame (the frames before it are stepped through again, not captured, so the state is exact).
// When a take is complete it is verified and muxed here (CPU), with the lease already released.
//
//   node rig/shoot.mjs list                       the takes and their state
//   node rig/shoot.mjs film-S04,film-S22 | all    shoot these (or every take not yet verified)
//   node rig/shoot.mjs bench                      capture benchmark: webcodecs against screenshots (one lease)
//
//   --budget S   seconds of capture per lease (default 450: a 10-minute lease minus load and margin)
//   --leases N   stop after N leases (default 12)
//
// Exit codes from chatdom-pc-lease: 3 means the tunnel is down (stop: shoot later), 75 means another lane held the
// lease for the whole wait (try again later). A take is never shot on this host's CPU.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILM, TAKES_DIR } from './film.mjs';
import { verifyTake } from './verify.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const budget = Number(flag('budget', 450));
const maxLeases = Number(flag('leases', 12));
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const what = positional[0] ?? 'list';

const state = take => {
  const file = join(TAKES_DIR, take.take, 'take.json');
  if (!existsSync(file)) return { frames: 0, complete: false, verified: false };
  const s = JSON.parse(readFileSync(file, 'utf8'));
  return { frames: s.frames.length, complete: s.complete, verified: !!s.verify?.ok, fpm: s.framesPerMinute, renderer: s.renderer };
};

function recordArgs(take, extra = []) {
  return [join(here, 'record.mjs'), '--gpu', '--url', take.url, '--out', join(TAKES_DIR, take.take), '--take', take.take,
    '--from', String(take.from ?? 0), '--to', String(take.to), '--fps', String(take.fps ?? 60), '--size', take.size ?? '1920x1080',
    '--scale', String(take.scale ?? 1), '--settle', take.settle ?? 'window.__set ? window.__set.idle() : true',
    ...(take.ready ? ['--ready', take.ready] : []), ...(take.preroll ? ['--preroll', String(take.preroll)] : []), ...(take.css ? ['--css', take.css] : []),
    '--capture', take.capture ?? 'webcodecs', '--resume', '--budget', String(budget), ...extra];
}

/** One lease: check Tobias's window is visible, then record until the budget runs out. Returns the lease's exit code. */
function lease(take, extra = []) {
  const script = [
    'set -e',
    // His Chrome must be on screen: a minimised window stops compositing and frames never settle.
    'v=$(chatdom-pc vis); echo "$v" >&2; case "$v" in *minimized*|*" 0 frames in 1s"*) exit 9 ;; esac',
    `node ${recordArgs(take, extra).map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}`,
  ].join('\n');
  // Exit 4: a server still listened on 5191/5192 when the lease began (another lane's preview shutting down). It
  // clears within seconds, so wait and ask again rather than give up the shoot.
  for (let attempt = 1; ; attempt++) {
    const r = spawnSync('chatdom-pc-lease', ['--wait', '10', '--max', '10', '--', 'bash', '-c', script], { stdio: 'inherit' });
    if (r.status !== 4 || attempt >= 6) return r.status;
    console.log(`the GPU ports were busy at lease start: retrying in 30 s (${attempt}/5)`);
    spawnSync('sleep', ['30']);
  }
}

if (what === 'list') {
  for (const take of FILM) {
    const s = state(take);
    const total = Math.round((take.to - (take.from ?? 0)) * (take.fps ?? 60));
    console.log(`${take.take.padEnd(16)} ${take.shot.padEnd(4)} ${(take.size ?? '1920x1080').padEnd(9)} ×${take.scale ?? 1}  ${String(s.frames).padStart(4)}/${total}  ${s.verified ? 'verified' : s.complete ? 'complete' : s.frames ? 'partial' : '-'}  ${take.url}`);
  }
  process.exit(0);
}

if (what === 'bench') {
  // The same take, captured both ways for one budget each; frames per minute land in each sidecar's runs.
  const take = FILM.find(t => t.take === (flag('take', 'film-S04')));
  for (const capture of ['webcodecs', 'screenshot']) {
    const b = { ...take, take: `bench-${capture}`, capture, ...(capture === 'screenshot' ? {} : {}) };
    const code = lease(b, capture === 'screenshot' ? ['--format', 'jpeg', '--quality', '95'] : []);
    if (code === 3) { console.log('tunnel down'); process.exit(3); }
    console.log(`${capture}: ${JSON.stringify(state(b))}`);
  }
  process.exit(0);
}

const wanted = what === 'all' ? FILM.filter(t => !state(t).verified) : what.split(',').map(id => FILM.find(t => t.take === id) ?? (() => { throw new Error(`no film take ${id}`); })());
let leases = 0;
for (const take of wanted) {
  // A verified take has had its segments cleaned into master.mp4: never shoot or verify it again.
  if (state(take).verified) { console.log(`${take.take}: already verified`); continue; }
  while (!state(take).complete) {
    if (leases >= maxLeases) { console.log(`stopped after ${leases} leases`); process.exit(0); }
    leases += 1;
    const code = lease(take);
    if (code === 3) { console.log('the tunnel is down: shoot later'); process.exit(3); }
    if (code === 9) { console.log('needs: tobias un-minimise Chrome (the window is minimised or not drawing)'); process.exit(9); }
    if (code === 75) { console.log('another lane held the lease for 10 minutes: try again later'); process.exit(75); }
    if (code !== 0 && !state(take).frames) { console.log(`${take.take}: the lease failed (exit ${code}) before any frame`); process.exit(code ?? 1); }
  }
  const v = verifyTake(join(TAKES_DIR, take.take), { clean: true });
  console.log(`${take.take}: ${v.ok ? 'verified' : 'FAILED'} ${v.masterFrames}/${v.expected} frames ${v.masterSize ?? ''} ${v.problems.join('; ')}`);
}
