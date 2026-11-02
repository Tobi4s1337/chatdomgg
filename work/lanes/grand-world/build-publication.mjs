import { resolve } from 'node:path';
import { build } from 'vite';

// The publication entry must remain independent of terrain generation and the artisan registry.
await build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' },
  build: { ssr: resolve('apps/realm/src/land/publish-cli.ts'), target: 'node22', outDir: 'shots/grand-world/publication-cli',
    emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'publish.mjs' } } } });
