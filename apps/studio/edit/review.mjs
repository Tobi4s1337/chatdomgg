// Review clips: one studio take, encoded exactly as recorded (1920×1080, 60 fps, picture only) and kept under
// 10 MB so it can sit in work/evidence/teaser/ for review.
//   node apps/studio/edit/review.mjs S01 S08 S14            → work/evidence/teaser/page-S01@1920x1080-60fps.mp4 …
//   node apps/studio/edit/review.mjs page-S01 --out <file>  (any take folder name)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const TAKES = '/srv/chatdom/media/teaser/takes';
const EVIDENCE = join(REPO, 'work/evidence/teaser');
const LIMIT = 10e6;

function ffmpeg(args) {
  const run = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '4', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (run.status !== 0) throw new Error(`ffmpeg failed (${run.status})`);
}

export function review(name, out) {
  const dir = join(TAKES, name);
  const take = JSON.parse(readFileSync(join(dir, 'take.json'), 'utf8'));
  if (!take.complete) throw new Error(`${name} is not complete`);
  const ext = take.format === 'jpeg' ? 'jpg' : 'png';
  const frames = readdirSync(dir).filter(f => f.endsWith(`.${ext}`)).length;
  const seconds = frames / take.fps;
  // Two passes at the bitrate that lands at about 9 MB, capped where more bits stop showing on a page shot.
  const kbps = Math.min(14000, Math.floor((LIMIT * 0.9 * 8) / 1000 / seconds));
  const work = `/tmp/teaser-review-${name}`;
  mkdirSync(work, { recursive: true });
  const common = ['-framerate', String(take.fps), '-i', join(dir, `%06d.${ext}`), '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation',
    '-b:v', `${kbps}k`, '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart'];
  ffmpeg([...common, '-pass', '1', '-passlogfile', join(work, 'pass'), '-an', '-f', 'mp4', '/dev/null']);
  ffmpeg([...common, '-pass', '2', '-passlogfile', join(work, 'pass'), '-an', out]);
  rmSync(work, { recursive: true, force: true });
  const bytes = statSync(out).size;
  if (bytes >= LIMIT) throw new Error(`${out} is ${(bytes / 1e6).toFixed(1)} MB`);
  return { out, frames, seconds, kbps, bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const explicit = at >= 0 ? args.splice(at, 2)[1] : null;
  mkdirSync(EVIDENCE, { recursive: true });
  for (const arg of args) {
    const name = /^S\d\d$/.test(arg) ? `page-${arg}` : arg;
    if (!existsSync(join(TAKES, name))) throw new Error(`no take ${name}`);
    const r = review(name, explicit ?? join(EVIDENCE, `${name}@1920x1080-60fps.mp4`));
    process.stdout.write(`${r.out}: ${r.frames} frames, ${r.seconds.toFixed(2)} s, ${r.kbps} kbps, ${(r.bytes / 1e6).toFixed(2)} MB\n`);
  }
}
