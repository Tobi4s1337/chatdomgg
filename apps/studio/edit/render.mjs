// Renders an edit decision list with ffmpeg: one intermediate per clip, dissolves and cuts in one chain, title
// cards over it, captions burned in from the narration's word timings, and the narration mixed over the music
// with the music ducking under each line.
//
//   node apps/studio/edit/render.mjs --cut rough --out work/evidence/teaser/rough-cut-v1.mp4 [--size 1280x720] [--kbps 760] [--reuse]
//
// Every ffmpeg runs under `nice -n 19` with at most 4 threads (the host is shared).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const STUDIO = resolve(here, '..');
const REPO = resolve(STUDIO, '../..');
const MEDIA = '/srv/chatdom/media/teaser';
const FONTS = join(REPO, 'packages/ui/src/fonts');

function ffmpeg(args, label) {
  const run = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '4', ...args], { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`ffmpeg failed (${label}): ${run.stderr.toString().slice(-2000)}`);
}
function probeDuration(file) {
  const run = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(run.stdout.toString().trim());
}

async function loadEdl() {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: STUDIO, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try { return await vite.ssrLoadModule('/edit/edl.ts'); } finally { await vite.close(); }
}

const ass = s => s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
function stamp(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Captions: one event per narration line, shown from its first word to a beat after its last. */
export function captions(edit) {
  const scale = edit.height / 1080;
  const size = Math.round(50 * scale), margin = Math.round(92 * scale), outline = (2.2 * scale).toFixed(1), shadow = (1.4 * scale).toFixed(1);
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${edit.width}\nPlayResY: ${edit.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Narration,Alegreya,${size},&H00F2EAD9,&H00F2EAD9,&H96140C08,&H8C000000,0,0,0,0,100,100,0.6,0,1,${outline},${shadow},2,60,60,${margin},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = edit.lines.filter(line => line.caption !== false).map(line => {
    const first = line.words[0]?.start ?? 0, last = line.words[line.words.length - 1]?.end ?? line.duration;
    const from = line.at + first - 0.08, to = line.at + last + 0.55;
    return `Dialogue: 0,${stamp(from)},${stamp(to)},Narration,,0,0,0,,{\\fad(140,220)}${ass(line.text)}`;
  });
  return head + events.join('\n') + '\n';
}

function frameCount(dir, ext) { return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(`.${ext}`)).length : 0; }

export async function render({ cut = 'rough', out, width = 1280, height = 720, fps = 60, kbps = 760, reuse = false }) {
  const { buildEdit } = await loadEdl();
  const scratch = JSON.parse(readFileSync(join(STUDIO, 'voice/scratch.json'), 'utf8'));
  const bed = `${MEDIA}/audio/music/temp-bed-18lufs.wav`;
  const musicFile = existsSync(bed) ? bed : existsSync(`${MEDIA}/audio/music/temp-bed.wav`) ? `${MEDIA}/audio/music/temp-bed.wav` : null;
  let extend = {};
  const snapFile = join(STUDIO, 'edit/snap.json');
  if (existsSync(snapFile)) extend = JSON.parse(readFileSync(snapFile, 'utf8')).shots ?? {};
  const edit = buildEdit({ name: cut, width, height, fps, scratch, music: musicFile ? { file: musicFile, gain: 0.8, duckDb: 9 } : null, kbps, extend });
  const work = join(MEDIA, 'cuts', `${cut}-work`);
  mkdirSync(work, { recursive: true });
  const report = [];

  // 1. One intermediate per clip, exactly dur·fps frames; a short source holds its last frame.
  const parts = [];
  for (const [i, clip] of edit.clips.entries()) {
    const file = join(work, `${String(i).padStart(2, '0')}-${clip.shot}.mp4`);
    const frames = Math.round(clip.dur * fps);
    const vf = `scale=${width}:${height}:flags=lanczos:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`;
    // --reuse keeps intermediates from an earlier render of the same cut (only when their frame count is right).
    if (reuse && existsSync(file) && Number(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file]).stdout.toString().trim()) === frames) {
      parts.push({ clip, file });
      continue;
    }
    if (clip.source.kind === 'frames') {
      const have = frameCount(clip.source.dir, clip.source.ext);
      const start = Math.round(clip.source.in * clip.source.fps);
      if (have === 0) throw new Error(`${clip.shot}: no frames in ${clip.source.dir}`);
      const usable = Math.max(1, have - start);
      if (usable < frames) report.push(`${clip.shot}: ${usable} of ${frames} frames; holding the last`);
      ffmpeg(['-framerate', String(clip.source.fps), '-start_number', String(Math.min(start, have - 1)), '-i', join(clip.source.dir, `%06d.${clip.source.ext}`),
        '-vf', `${vf},tpad=stop_mode=clone:stop_duration=${clip.dur}`, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', file], clip.shot);
    } else {
      const src = resolve(REPO, clip.source.file);
      const crop = clip.source.crop ? `crop=${clip.source.crop[2]}:${clip.source.crop[3]}:${clip.source.crop[0]}:${clip.source.crop[1]},` : '';
      ffmpeg(['-ss', String(clip.source.in), '-i', src, '-vf', `setpts=PTS/${clip.source.speed},${crop}${vf},tpad=stop_mode=clone:stop_duration=${clip.dur}`,
        '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', file], clip.shot);
    }
    parts.push({ clip, file });
  }

  // 2. The picture chain: hard cuts concatenate, transitions cross over the clip's overlap.
  const inputs = parts.flatMap(p => ['-i', p.file]);
  // Concat and xfade need identical inputs: square pixels and one time base (concat always outputs AVTB).
  let graph = parts.map((_, i) => `[${i}:v]setsar=1,settb=AVTB[p${i}];`).join('');
  let last = '[p0]', length = parts[0].clip.dur;
  for (let i = 1; i < parts.length; i++) {
    const { clip } = parts[i], label = `[v${i}]`;
    if (clip.enter.kind === 'cut') { graph += `${last}[p${i}]concat=n=2:v=1:a=0${label};`; length += clip.dur; }
    else {
      const transition = clip.enter.kind === 'dissolve' ? 'fade' : clip.enter.kind;
      graph += `${last}[p${i}]xfade=transition=${transition}:duration=${clip.enter.dur}:offset=${(length - clip.enter.dur).toFixed(4)}${label};`;
      length += clip.dur - clip.enter.dur;
    }
    last = label;
  }
  // 3. Cards over the picture (transparent frame sequences from the studio).
  let n = parts.length;
  const cardInputs = [];
  for (const card of edit.cards) {
    if (!frameCount(card.dir, 'png')) { report.push(`card ${card.card}: not recorded`); continue; }
    cardInputs.push('-framerate', String(fps), '-i', join(card.dir, '%06d.png'));
    graph += `[${n}:v]scale=${width}:${height}:flags=lanczos,format=rgba,setpts=PTS+${card.at}/TB[c${n}];${last}[c${n}]overlay=eof_action=pass:format=auto[o${n}];`;
    last = `[o${n}]`;
    n++;
  }
  // 4. Captions.
  const assFile = join(work, 'captions.ass');
  writeFileSync(assFile, captions(edit));
  graph += `${last}subtitles=${assFile}:fontsdir=${FONTS},format=yuv420p[vout]`;
  const picture = join(work, 'picture.mp4');
  writeFileSync(join(work, 'picture.graph.txt'), graph);
  ffmpeg([...inputs, ...cardInputs, '-filter_complex_script', join(work, 'picture.graph.txt'), '-map', '[vout]', '-t', String(edit.duration), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', picture], 'picture');

  // 5. Sound: narration lines placed on their times; music under them, ducked by the narration.
  const audioInputs = [], mixes = [];
  let a = 0;
  for (const line of edit.lines) {
    audioInputs.push('-i', line.audio);
    mixes.push(`[${a}:a]aresample=48000,adelay=${Math.round(line.at * 1000)}|${Math.round(line.at * 1000)},volume=1.15[n${a}]`);
    a++;
  }
  let audioGraph = mixes.join(';') + ';' + edit.lines.map((_, i) => `[n${i}]`).join('') + `amix=inputs=${edit.lines.length}:normalize=0,asplit=2[voice][key]`;
  for (const sound of edit.sounds) {
    audioInputs.push('-i', sound.file);
    const trim = sound.dur ? `atrim=0:${sound.dur},afade=t=out:st=${Math.max(0, sound.dur - (sound.fadeOut ?? 0.3))}:d=${sound.fadeOut ?? 0.3},` : '';
    audioGraph += `;[${a}:a]aresample=48000,${trim}adelay=${Math.round(sound.at * 1000)}|${Math.round(sound.at * 1000)},volume=${sound.gain}[s${a}]`;
    a++;
  }
  const sfxLabels = edit.sounds.map((_, i) => `[s${edit.lines.length + i}]`).join('');
  if (edit.music) {
    audioInputs.push('-i', edit.music.file);
    audioGraph += `;[${a}:a]aresample=48000,volume=${edit.music.gain},afade=t=out:st=${(edit.duration - 2).toFixed(2)}:d=2[bed];[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=420:makeup=1[ducked]`;
    audioGraph += `;[voice][ducked]${sfxLabels}amix=inputs=${2 + edit.sounds.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  } else {
    audioGraph += `;[voice]${sfxLabels}amix=inputs=${1 + edit.sounds.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  }
  const sound = join(work, 'sound.wav');
  writeFileSync(join(work, 'sound.graph.txt'), audioGraph);
  ffmpeg([...audioInputs, '-filter_complex_script', join(work, 'sound.graph.txt'), '-map', '[aout]', '-t', String(edit.duration), '-ar', '48000', sound], 'sound');

  // 6. The review encode: two passes to land under the size cap.
  mkdirSync(dirname(out), { recursive: true });
  const video = edit.kbps ? ['-c:v', 'libx264', '-preset', 'slow', '-b:v', `${edit.kbps}k`, '-maxrate', `${Math.round(edit.kbps * 1.8)}k`, '-bufsize', `${edit.kbps * 3}k`] : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16'];
  if (edit.kbps) {
    ffmpeg(['-i', picture, ...video, '-pass', '1', '-passlogfile', join(work, 'x264'), '-an', '-f', 'mp4', '/dev/null'], 'pass 1');
    ffmpeg(['-i', picture, '-i', sound, ...video, '-pass', '2', '-passlogfile', join(work, 'x264'), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-shortest', out], 'pass 2');
  } else {
    ffmpeg(['-i', picture, '-i', sound, ...video, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], 'encode');
  }
  writeFileSync(join(work, 'edit.json'), JSON.stringify(edit, null, 1));
  return { out, duration: probeDuration(out), report, edit };
}

function flags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2), v = argv[i + 1]; f[k] = v === undefined || v.startsWith('--') ? true : (i++, v); }
  return f;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = flags(process.argv.slice(2));
  const [width, height] = String(f.size ?? '1280x720').split('x').map(Number);
  const result = await render({ cut: String(f.cut ?? 'rough'), out: resolve(String(f.out ?? join(MEDIA, 'cuts', 'rough.mp4'))), width, height, fps: Number(f.fps ?? 60), kbps: f.kbps === 'none' ? null : Number(f.kbps ?? 760), reuse: !!f.reuse });
  process.stdout.write(`${result.out} · ${result.duration.toFixed(2)} s\n${result.report.join('\n')}\n`);
}
