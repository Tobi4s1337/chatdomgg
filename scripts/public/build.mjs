// The one production build for chatdom.io: the realm, the web app with its site pages, the public server bundle,
// precompressed static files, and the Twitch panel's extension zip (checked against Twitch's rules).
//
//   node scripts/public/build.mjs            # everything
//   node scripts/public/build.mjs --no-panel # skip the extension zip
//
// Outputs: apps/realm/dist/realm.mjs, apps/web/dist/ (with site/ and .br/.gz siblings), apps/api/dist/public.mjs,
// deploy/public/dist/chatdom-panel-<version>.zip.
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const run = (args, cwd = root, env = {}) => {
  console.log(`$ pnpm ${args.join(' ')}${cwd === root ? '' : `   (in ${cwd.slice(root.length + 1)})`}`);
  execFileSync('pnpm', args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};
const started = Date.now();

run(['--filter', '@chatdom/realm', 'build']);
run(['--filter', '@chatdom/web', 'build']);
run(['exec', 'vite', 'build', '--config', 'src/site/vite.config.mjs'], join(root, 'apps/web'));
// The API's own build writes both of its bundles (dist/api.mjs and dist/public.mjs), so a later `pnpm build`
// can never leave the gateway without its server.
run(['--filter', '@chatdom/api', 'build']);

// Text assets ship with brotli and gzip siblings; the public server picks one per request (never on the fly).
const brotli = promisify(brotliCompress), gz = promisify(gzip);
const COMPRESSIBLE = /\.(?:html|js|mjs|css|json|svg|txt|wasm|vox|bin|webmanifest)$/;
let count = 0, before = 0, after = 0;
const walk = async dir => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!COMPRESSIBLE.test(entry.name) || (await stat(path)).size < 1024) continue;
    const bytes = await readFile(path);
    const [br, gzipped] = await Promise.all([
      brotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }),
      gz(bytes, { level: 9 }),
    ]);
    if (br.length < bytes.length * 0.95) await writeFile(`${path}.br`, br);
    if (gzipped.length < bytes.length * 0.95) await writeFile(`${path}.gz`, gzipped);
    count++; before += bytes.length; after += Math.min(br.length, bytes.length);
  }
};
await walk(join(root, 'apps/web/dist'));
console.log(`precompressed ${count} files: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB (brotli)`);

if (!process.argv.includes('--no-panel')) execFileSync(process.execPath, [join(root, 'scripts/public/extension.mjs')], { stdio: 'inherit' });
console.log(`public build ready in ${((Date.now() - started) / 1000).toFixed(0)} s. Start it with: node scripts/public/start.mjs`);
