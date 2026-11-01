// Load only the root's pinned committed source snapshot. This writes one SSR factory bundle in our owned tmpdir.
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

export async function loadServices(root, tempDirectory) {
  const runtime = join(tempDirectory, 'services'), modules = join(runtime, 'node_modules');
  await mkdir(modules, { recursive: true });
  const linked = new Set();
  for (const app of ['realm', 'api']) {
    const source = join(root, 'apps', app, 'node_modules');
    for (const entry of await readdir(source)) {
      if (entry.startsWith('.') || linked.has(entry)) continue;
      await symlink(join(source, entry), join(modules, entry)); linked.add(entry);
    }
  }
  const exports = {
    persistence: 'apps/realm/src/persistence/index.ts', allocation: 'apps/realm/src/allocation/index.ts',
    bootstrap: 'apps/realm/src/bootstrap/index.ts', wiring: 'apps/realm/src/wiring/index.ts', evening: 'apps/realm/src/evening/index.ts',
    citizens: 'apps/realm/src/evening/citizens.ts', castle: 'apps/realm/src/evening/castle.ts', interactions: 'apps/realm/src/evening/interactions.ts',
    dock: 'apps/realm/src/dock/index.ts', world: 'packages/world/src/index.ts', authService: 'apps/api/src/realm-auth/service.ts',
    authHttp: 'apps/api/src/realm-auth/http.ts', simulatedOidc: 'apps/api/src/realm-auth/simulated-provider.ts', dockApi: 'apps/api/src/dock/index.ts',
  };
  const entry = join(runtime, 'entry.ts');
  await writeFile(entry, Object.entries(exports).map(([name, path]) => `export * as ${name} from ${JSON.stringify(join(root, path))};`).join('\n'));
  await build({ root: join(root, 'apps/realm'), configFile: join(root, 'apps/realm/vite.config.ts'),
    build: { ssr: entry, outDir: runtime, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'services.mjs' } } }, logLevel: 'error' });
  return import(pathToFileURL(join(runtime, 'services.mjs')).href);
}
