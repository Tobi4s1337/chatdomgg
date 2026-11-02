// Private, controlled-provider process proof. DATABASE_URL is inherited, never printed.
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { clearTimeout } from 'node:timers';
import { createServer, createConnection } from 'node:net';

process.umask(0o077);
const port = Number(process.env.FORGE_WISH_PROOF_PORT);
if (!process.env.DATABASE_URL || process.env.REALM_DATABASE_SCHEMA !== 'realm_forge_wish' ||
    !Number.isInteger(port) || port < 5170 || port > 5189 || port === 5187) {
  throw new Error('The proof requires a private database, isolated schema and an explicitly supplied permitted port.');
}
const parent = '/tmp/chatdom-forge-wish';
await mkdir(parent, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(parent, 'coordinator-'));
await chmod(directory, 0o700);
let target;
const peers = new Set();
// Keep the permitted TCP endpoint owned across child deaths and fixture setup. Raw bytes reach each
// actual realm transport over a private Unix socket; authentication and route handling stay in that child.
const proxy = createServer(peer => {
  if (!target) { peer.destroy(); return; }
  const upstream = createConnection({ path: target });
  peers.add(peer); peers.add(upstream);
  const close = () => { peer.destroy(); upstream.destroy(); peers.delete(peer); peers.delete(upstream); };
  peer.once('error', close); upstream.once('error', close);
  peer.once('close', close); upstream.once('close', close);
  peer.pipe(upstream); upstream.pipe(peer);
});
await new Promise((done, reject) => {
  proxy.once('error', () => reject(new Error('The proof port is unavailable.')));
  proxy.listen({ host: '127.0.0.1', port, exclusive: true }, done);
});
let child, canceled = false, timer;
const stop = () => { canceled = true; child?.kill('SIGTERM'); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  await symlink(resolve('apps/realm/node_modules'), join(directory, 'node_modules'), 'dir');
  const outDir = join(directory, 'dist');
  await build({ root: resolve('apps/realm'), configFile: false, logLevel: 'silent',
    build: { ssr: resolve('work/lanes/forge-wish/runtime/coordinator-proof-entry.ts'), outDir, emptyOutDir: true, target: 'node22',
      rollupOptions: { external: ['colyseus', '@colyseus/core', '@colyseus/uwebsockets-transport', 'uwebsockets-express', 'uWebSockets.js'], output: { entryFileNames: 'proof.mjs' } } },
    ssr: { noExternal: [/^@chatdom\//], target: 'node' },
  });
  if (canceled) throw new Error('The proof was interrupted before starting.');
  child = spawn(process.execPath, [join(outDir, 'proof.mjs'), directory, String(port)], { env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  child.on('message', value => {
    if (value && typeof value === 'object' && value.kind === 'target' && typeof value.path === 'string'
      && value.path.startsWith(directory + '/') && !value.path.includes('/../') && value.path.endsWith('.sock')) target = value.path;
  });
  timer = setTimeout(stop, 12 * 60_000);
  const status = await new Promise((done, reject) => { child.once('error', () => reject(new Error('The proof supervisor could not start.'))); child.once('close', (code, signal) => done({ code, signal })); });
  if (canceled || status.code !== 0) process.exitCode = 1;
} finally {
  clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  for (const peer of peers) peer.destroy();
  await new Promise(done => proxy.close(done));
}
