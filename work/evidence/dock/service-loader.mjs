// Compile the real workspace service graph exactly as a Node SSR entry; never start services here.
import { mkdir, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

export async function loadServices(root, tempDirectory) {
  const runtime = join(tempDirectory, 'services'), modules = join(runtime, 'node_modules');
  await mkdir(modules, { recursive: true });
  // Native ESM resolves external packages from the generated entry. Reuse the installed
  // realm/API package links without copying dependencies or writing into the workspace.
  const linked = new Set();
  for (const app of ['realm', 'api']) {
    const source = join(root, 'apps', app, 'node_modules');
    for (const entry of await readdir(source)) {
      if (entry.startsWith('.') || linked.has(entry)) continue;
      await symlink(join(source, entry), join(modules, entry)); linked.add(entry);
    }
  }
  await build({ root: join(root, 'apps/realm'), configFile: join(root, 'apps/realm/vite.config.ts'),
    build: { ssr: join(root, 'work/evidence/dock/integration-modules.ts'), outDir: runtime, emptyOutDir: false,
      rollupOptions: { output: { entryFileNames: 'services.mjs' } } }, logLevel: 'error' });
  return import(pathToFileURL(join(runtime, 'services.mjs')).href);
}
