// A contact sheet of a cut or a take: one frame every `--every` seconds (default 1.5), stamped with its time,
// tiled six across.
//   node apps/studio/edit/sheet.mjs work/evidence/teaser/rough-cut-v1.mp4 [--out …png|jpg] [--every 1.5]
//   node apps/studio/edit/sheet.mjs <take folder> --out work/evidence/teaser/takes/<take>.jpg   (60 fps frames)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const every = Number(opt('--every', '1.5'));
const input = args[0];
if (!input) throw new Error('usage: sheet.mjs <video> [--out file] [--every s]');
const folder = existsSync(input) && statSync(input).isDirectory();
const out = opt('--out', folder ? `${basename(input)}-contact.jpg` : input.replace(/\.mp4$/, '-contact.png'));
const ext = folder ? (readdirSync(input).some(f => f.endsWith('.png')) ? 'png' : 'jpg') : '';
const source = folder ? ['-framerate', '60', '-i', join(input, `%06d.${ext}`)] : ['-i', input];
const duration = folder
  ? readdirSync(input).filter(f => /^\d{6}\./.test(f)).length / 60
  : Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], { encoding: 'utf8' }).stdout.trim());
const count = Math.ceil(duration / every);
const columns = 6, rows = Math.ceil(count / columns);
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const filter = `fps=1/${every}:start_time=${every / 2},scale=320:-2,drawtext=fontfile=${font}:text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55,tile=${columns}x${rows}:padding=4:color=0x111111`;
const run = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '4', ...source, '-vf', filter, '-frames:v', '1', ...(out.endsWith('.jpg') ? ['-q:v', '3'] : []), out], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
process.stdout.write(`${out}: ${count} frames, ${columns}×${rows}, every ${every} s of ${duration.toFixed(2)} s\n`);
