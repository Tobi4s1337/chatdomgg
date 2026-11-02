import { build } from 'vite';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { clearTimeout } from 'node:timers';

process.umask(0o077);
const root = '/tmp/chatdom-forge-wish';
await mkdir(root, { recursive: true, mode: 0o700 });
if (((await stat(root)).mode & 0o777) !== 0o700) throw new Error('The private proof root is not private.');
const directory = await mkdtemp(join(root, 'lifecycle-'));
await chmod(directory, 0o700);
let child, canceled = false;
const stop = () => { canceled = true; child?.kill('SIGTERM'); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  const outDir = join(directory, 'dist');
  await build({ root: resolve('apps/codex'), configFile: false, logLevel: 'silent',
    build: { ssr: resolve('work/lanes/forge-wish/runtime/lifecycle-proof.ts'), outDir, emptyOutDir: true,
      target: 'node22', rollupOptions: { output: { entryFileNames: 'lifecycle-proof.mjs' } } },
    ssr: { noExternal: true, target: 'node' },
  });
  if (canceled) throw new Error('The proof was interrupted.');
  child = spawn(process.execPath, [join(outDir, 'lifecycle-proof.mjs'), directory], {
    env: process.env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = setTimeout(stop, 120_000);
  try {
    const status = await new Promise((done, reject) => {
      child.once('error', () => reject(new Error('The lifecycle supervisor could not start.')));
      child.once('close', (code, signal) => done({ code, signal }));
    });
    if (canceled || status.code !== 0) process.exitCode = 1;
  } finally { clearTimeout(deadline); }
} finally {
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
