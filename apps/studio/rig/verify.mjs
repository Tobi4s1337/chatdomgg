// Verifies a take and makes its master. A take passes when its sidecar holds every frame of [from, to) exactly
// once, in order, each at clock value preroll + n / fps (no gap, no repeat), every frame's bytes still match their
// SHA-256, and the encoded master holds exactly (to − from) × fps frames.
//
//   nice -n 19 node rig/verify.mjs <take dir> [--clean]
//
// webcodecs takes: the segments (each opens on a keyframe) are joined into one H.264 stream and muxed without
// re-encoding into `master.mp4`. Screenshot takes: the frames are encoded to `master.mp4` (H.264 High 4:2:0,
// CRF 12, slow preset, four threads). `--clean` deletes the frame images once the master is verified (the media
// folder keeps the master and the sidecar).
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = (cmd, args) => {
  const r = spawnSync('nice', ['-n', '19', cmd, ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr ?? '').split('\n').slice(-6).join('\n')}`);
  return r.stdout;
};

/** Packets in a video file, counted by ffprobe. */
export function countFrames(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets,width,height,r_frame_rate', '-of', 'json', file]);
  const s = JSON.parse(out).streams[0];
  return { frames: Number(s.nb_read_packets), width: s.width, height: s.height, rate: s.r_frame_rate };
}

export function verifyTake(dir, { clean = false, log = () => {} } = {}) {
  const sidecar = JSON.parse(readFileSync(join(dir, 'take.json'), 'utf8'));
  const problems = [];
  const fps = sidecar.fps;
  const expected = Math.round((sidecar.to - sidecar.from) * fps);
  const frames = [...sidecar.frames].sort((a, b) => a.frame - b.frame);
  if (frames.length !== expected) problems.push(`${frames.length} frames recorded, ${expected} expected`);
  const step = 1000 / fps;
  const clock0 = frames[0] ? frames[0].clock - frames[0].frame * step : 0;
  for (const [i, f] of frames.entries()) {
    if (f.frame !== i) { problems.push(`frame ${i} missing or repeated (found ${f.frame})`); break; }
    if (Math.abs(f.clock - (clock0 + i * step)) > 1e-6) { problems.push(`frame ${i} at clock ${f.clock}, expected ${clock0 + i * step}`); break; }
  }
  let master = join(dir, 'master.mp4');
  if (sidecar.capture === 'webcodecs') {
    const stream = join(dir, 'take.h264');
    const out = openSync(stream, 'w');
    try {
      for (const segment of [...sidecar.segments].sort((a, b) => a.first - b.first)) {
        const bytes = readFileSync(join(dir, segment.file)).subarray(0, segment.bytes);
        // Every chunk of the segment, in order, must still hash to what the sidecar recorded.
        let at = 0;
        for (const f of frames.filter(x => x.segment === segment.file)) {
          const chunk = bytes.subarray(at, at + f.size);
          if (createHash('sha256').update(chunk).digest('hex') !== f.sha256) { problems.push(`frame ${f.frame}: chunk hash mismatch`); break; }
          at += f.size;
        }
        if (at !== bytes.length) problems.push(`${segment.file}: ${bytes.length - at} bytes not accounted for`);
        writeFileSync(out, bytes);
      }
    } finally { closeSync(out); }
    run('ffmpeg', ['-y', '-v', 'error', '-threads', '4', '-fflags', '+genpts', '-r', String(fps), '-f', 'h264', '-i', stream, '-c', 'copy', '-movflags', '+faststart', master]);
    rmSync(stream, { force: true });
  } else {
    const ext = sidecar.format === 'jpeg' ? 'jpg' : 'png';
    for (const f of frames) {
      const file = join(dir, `${String(f.frame).padStart(6, '0')}.${ext}`);
      if (!existsSync(file)) { if (!sidecar.verify?.ok) problems.push(`frame ${f.frame}: image missing`); continue; }
      if (createHash('sha256').update(readFileSync(file)).digest('hex') !== f.sha256) { problems.push(`frame ${f.frame}: image hash mismatch`); break; }
    }
    const hasFrames = existsSync(join(dir, `000000.${ext}`));
    if (hasFrames) {
      run('ffmpeg', ['-y', '-v', 'error', '-threads', '4', '-framerate', String(fps), '-i', join(dir, `%06d.${ext}`), '-c:v', 'libx264', '-preset', 'slow', '-crf', '12',
        '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-threads', '4', '-movflags', '+faststart', master]);
    } else if (!existsSync(master)) problems.push('no frames and no master');
  }
  const encoded = existsSync(master) ? countFrames(master) : null;
  if (encoded && encoded.frames !== expected) problems.push(`master holds ${encoded.frames} frames, ${expected} expected`);
  const ok = problems.length === 0;
  sidecar.verify = { ok, expected, recorded: frames.length, master: ok ? master : null, masterFrames: encoded?.frames ?? null, masterSize: encoded ? `${encoded.width}×${encoded.height}` : null,
    masterBytes: existsSync(master) ? statSync(master).size : null, problems, checked: new Date().toISOString() };
  writeFileSync(join(dir, 'take.json'), JSON.stringify(sidecar, null, 1));
  if (ok && clean && sidecar.capture !== 'webcodecs') {
    const ext = sidecar.format === 'jpeg' ? 'jpg' : 'png';
    for (const name of readdirSync(dir)) if (name.endsWith(`.${ext}`) && /^\d{6}\./.test(name)) rmSync(join(dir, name));
    log('frames deleted; the master and sidecar stay');
  }
  if (ok && clean && sidecar.capture === 'webcodecs') for (const s of sidecar.segments) rmSync(join(dir, s.file), { force: true });
  return sidecar.verify;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { process.stderr.write('usage: verify.mjs <take dir> [--clean]\n'); process.exit(2); }
  const v = verifyTake(resolve(dir), { clean: process.argv.includes('--clean'), log: line => process.stdout.write(`${line}\n`) });
  process.stdout.write(`${v.ok ? 'verified' : 'FAILED'}: ${v.recorded}/${v.expected} frames, master ${v.masterFrames} frames ${v.masterSize ?? ''}${v.problems.length ? `\n  ${v.problems.join('\n  ')}` : ''}\n`);
  process.exit(v.ok ? 0 : 1);
}
