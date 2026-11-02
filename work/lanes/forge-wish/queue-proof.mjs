import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { clearTimeout } from 'node:timers';

const outDir = resolve('apps/codex/src/forge-queue-proof/dist');
await build({ root: resolve('apps/codex'), configFile: false, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/forge-wish/runtime/queue-proof.ts'), outDir, emptyOutDir: true,
    target: 'node22', rollupOptions: { output: { entryFileNames: 'queue-proof.mjs' } } },
  ssr: { noExternal: true, target: 'node' },
});
const child = spawn(process.execPath, [resolve(outDir, 'queue-proof.mjs')], {
  env: process.env, stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => { child.kill('SIGTERM'); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const deadline = setTimeout(stop, 120_000);
try {
  child.once('error', () => { process.exitCode = 1; });
  await new Promise(resolve => child.once('close', code => { process.exitCode = code ?? 1; resolve(); }));
} finally {
  clearTimeout(deadline); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
}
