// Run with the private DATABASE_URL loaded by node --env-file; never echo its value.
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { clearTimeout } from 'node:timers';

const mode = process.argv[2], port = Number(process.env.FORGE_WISH_PROOF_PORT ?? '5173');
if (!['prepare', 'pilot', 'twenty', 'stress'].includes(mode) || process.env.REALM_DATABASE_SCHEMA !== 'realm_forge_wish') {
  throw new Error('Use prepare|pilot|twenty|stress with REALM_DATABASE_SCHEMA=realm_forge_wish and privately loaded DATABASE_URL.');
}
if (!Number.isInteger(port) || port < 5170 || port > 5189 || port === 5187) throw new Error('The proof needs an allowed lane port.');
// Under the realm tree so external native/service modules resolve from its existing dependencies.
const outDir = resolve('apps/realm/src/forge-proof/dist');
await build({ root: resolve('apps/realm'), configFile: false, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/forge-wish/runtime/proof-entry.ts'), outDir, emptyOutDir: true, target: 'node22',
    rollupOptions: { external: ['colyseus', '@colyseus/core', '@colyseus/uwebsockets-transport', 'uwebsockets-express', 'uWebSockets.js'],
      output: { entryFileNames: 'proof.mjs' } } },
  ssr: { noExternal: [/^@chatdom\//], target: 'node' },
});
const child = spawn(process.execPath, [resolve(outDir, 'proof.mjs'), mode, String(port)], {
  env: process.env, stdio: ['ignore', 'inherit', 'inherit'],
});
const stop = () => { child.kill('SIGTERM'); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
// Twenty real wishes, two at a time, need longer than one pilot.
const deadline = setTimeout(stop, (mode === 'twenty' || mode === 'stress' ? 45 : 10) * 60_000);
try {
  child.once('error', () => { process.exitCode = 1; });
  await new Promise(resolve => child.once('close', code => { process.exitCode = code ?? 1; resolve(); }));
} finally {
  clearTimeout(deadline); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
}
