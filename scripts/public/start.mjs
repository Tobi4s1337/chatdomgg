// Starts chatdom.io: one process on one port serving the front door, the web app, sign-in, the panel's backend
// and the realm (HTTP and its WebSocket), with the realm supervised as a child on loopback.
//
//   node scripts/public/start.mjs [--no-migrate]
//
// First it applies the realm's additive migrations (never a drop or a rewrite), unless the realm is one the host
// already runs (PUBLIC_REALM_TARGET), which owns its schema.
//
// Settings come from the environment. Env files are read too, without overriding anything already set: the files
// listed in $PUBLIC_ENV_FILE (comma separated), or else deploy/public/.env (ignored by git) when it exists.
// See deploy/public/README.md for every setting. Build first with: node scripts/public/build.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '../..');
const server = join(root, 'apps/api/dist/public.mjs');
for (const built of [server, join(root, 'apps/web/dist/index.html'), join(root, 'apps/web/dist/door/index.html')]) {
  if (!existsSync(built)) { console.error(`Not built yet (${built.slice(root.length + 1)} is missing). Run: node scripts/public/build.mjs`); process.exit(1); }
}

const listed = (process.env.PUBLIC_ENV_FILE ?? '').split(',').map(path => path.trim()).filter(Boolean);
const missing = listed.filter(path => !existsSync(path));
if (missing.length) { console.error(`PUBLIC_ENV_FILE names ${missing.length} file(s) that do not exist.`); process.exit(1); }
const envFiles = listed.length ? listed : [join(root, 'deploy/public/.env')].filter(path => existsSync(path));
const envArgs = envFiles.map(path => `--env-file=${path}`);
// Match Node's --env-file precedence and dotenv syntax (including export, quotes and whitespace).
// The parent environment wins; among files, the last supplied value wins.
const effectiveEnv = { ...Object.assign({}, ...envFiles.map(path => parseEnv(readFileSync(path, 'utf8')))), ...process.env };
const ownRealm = !effectiveEnv.PUBLIC_REALM_TARGET?.trim();
if (ownRealm && !process.argv.includes('--no-migrate')) {
  const migrated = spawnSync(process.execPath, [...envArgs, join(root, 'apps/realm/scripts/migrate.mjs')], { cwd: root, stdio: 'inherit' });
  if (migrated.status !== 0) { console.error('The realm schema could not be migrated; not starting.'); process.exit(1); }
}

const child = spawn(process.execPath, [...envArgs, server], {
  cwd: root, stdio: 'inherit', env: { ...process.env, PUBLIC_REPO_ROOT: root },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
