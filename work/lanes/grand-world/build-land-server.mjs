import { resolve } from 'node:path';
import { build } from 'vite';

await build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' },
  build: { ssr: resolve('apps/realm/src/land/server.ts'), target: 'node22', outDir: 'shots/grand-world/land-server',
    emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'server.mjs' } } } });
