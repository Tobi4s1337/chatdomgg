// FW11 served restart proof. Run with the private DATABASE_URL loaded by node --env-file; never echo its value.
// node --env-file=<private> work/lanes/forge-wish/restart-proof.mjs [port]   (PROOF_CONTROLLED=1 for a zero-call rehearsal)
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

const port = Number(process.argv[2] ?? process.env.FORGE_WISH_PROOF_PORT ?? '5173');
if (process.env.REALM_DATABASE_SCHEMA !== 'realm_forge_wish') throw new Error('Use REALM_DATABASE_SCHEMA=realm_forge_wish with a privately loaded DATABASE_URL.');
if (!Number.isInteger(port) || port < 5170 || port > 5189 || port === 5187) throw new Error('The proof needs an allowed lane port.');
const outDir = resolve('apps/realm/src/forge-proof/dist');
await build({ root: resolve('apps/realm'), configFile: false, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/forge-wish/runtime/restart-entry.ts'), outDir, emptyOutDir: false, target: 'node22',
    rollupOptions: { external: ['colyseus', '@colyseus/core', '@colyseus/uwebsockets-transport', 'uwebsockets-express', 'uWebSockets.js'],
      output: { entryFileNames: 'restart.mjs' } } },
  ssr: { noExternal: [/^@chatdom\//], target: 'node' },
});
const child = spawn(process.execPath, [resolve(outDir, 'restart.mjs'), 'supervise', String(port)], { env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
const stop = () => { child.kill('SIGTERM'); };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const deadline = setTimeout(stop, 60 * 60_000);
await new Promise(done => child.once('close', code => { process.exitCode = code ?? 1; done(); }));
clearTimeout(deadline);
