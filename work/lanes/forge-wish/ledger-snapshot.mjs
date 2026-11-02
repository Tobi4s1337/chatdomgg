// FW12: read the forge's ledger through the real route of a private served realm and keep its public answer.
// node --env-file=<private> work/lanes/forge-wish/ledger-snapshot.mjs <proof directory> <out.json>
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const outDir = resolve('apps/realm/src/forge-proof/dist');
await build({ root: resolve('apps/realm'), configFile: false, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/forge-wish/runtime/ledger-snapshot.ts'), outDir, emptyOutDir: false, target: 'node22',
    rollupOptions: { external: ['colyseus', '@colyseus/core', '@colyseus/uwebsockets-transport', 'uwebsockets-express', 'uWebSockets.js'],
      output: { entryFileNames: 'ledger-snapshot.mjs' } } },
  ssr: { noExternal: [/^@chatdom\//], target: 'node' },
});
const child = spawn(process.execPath, [resolve(outDir, 'ledger-snapshot.mjs'), ...process.argv.slice(2).map((a, i) => resolve(a))], { env: process.env, stdio: 'inherit' });
await new Promise(done => child.once('close', code => { process.exitCode = code ?? 1; done(); }));
