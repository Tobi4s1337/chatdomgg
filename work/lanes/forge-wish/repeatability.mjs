import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { clearTimeout } from 'node:timers';

const mode = process.argv[2];
if (mode !== 'prepare' && !(mode === 'check' && process.argv[3])) throw new Error('Use prepare or check <private-fixture-directory>.');
const outDir = resolve('apps/codex/src/forge-repeatability/dist');
await build({ root: resolve('apps/codex'), configFile: false, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/forge-wish/runtime/repeatability-entry.ts'), outDir, emptyOutDir: true, target: 'node22',
    rollupOptions: { output: { entryFileNames: 'repeatability.mjs' } } }, ssr: { noExternal: true, target: 'node' } });
const child = spawn(process.execPath, [resolve(outDir, 'repeatability.mjs'), mode, ...(process.argv[3] ? [process.argv[3]] : [])], {
  env: process.env, stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => { child.kill('SIGTERM'); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const deadline = setTimeout(stop, 10 * 60_000);
try {
  child.once('error', () => { process.exitCode = 1; });
  await new Promise(resolve => child.once('close', code => { process.exitCode = code ?? 1; resolve(); }));
} finally {
  clearTimeout(deadline); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
}
