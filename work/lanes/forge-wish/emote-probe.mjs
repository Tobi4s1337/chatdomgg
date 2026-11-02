// Private word-gate diagnostic on the warm worker: node work/lanes/forge-wish/emote-probe.mjs <private dir> <fixture id>...
// Writes only protocol errors, call metrics and verdicts (never words) to <private dir>/probe.jsonl.
import { build } from 'vite';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const [out, ...ids] = process.argv.slice(2);
if (!out?.startsWith('/tmp/chatdom-forge-wish/') || !ids.length) throw new Error('Give a private directory under /tmp/chatdom-forge-wish/ and fixture ids.');
const outDir = resolve('apps/realm/src/forge-proof/dist');
await build({ root: resolve('apps/realm'), configFile: false, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/forge-wish/runtime/emote-probe.ts'), outDir, emptyOutDir: false, target: 'node22',
    rollupOptions: { output: { entryFileNames: 'probe.mjs' } } }, ssr: { noExternal: [/^@chatdom\//], target: 'node' } });
const result = spawnSync(process.execPath, [resolve(outDir, 'probe.mjs'), out, ...ids], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
