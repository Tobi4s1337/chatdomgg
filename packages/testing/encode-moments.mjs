import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Small offline review films; scene time is sampled by moments.mjs, never inferred from SwiftShader fps. */
export async function encodeMomentClips() {
  for (const [name, rate] of [['walk', '3'], ['build', '2']]) {
    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', rate,
        '-i', `shots/moments/${name}/%03d.png`, '-vf', 'scale=960:-2,fps=30',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-threads', '2',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `shots/moments/${name}.mp4`], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Could not encode ${name}: ${signal ?? code}`)));
    });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await encodeMomentClips();
