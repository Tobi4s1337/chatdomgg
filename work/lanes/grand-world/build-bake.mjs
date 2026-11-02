import { resolve } from 'node:path';
import { build } from 'vite';

// Bundles the existing eager artisan registry exactly as the browser worker does.
// No source import is executed by the build, and the output stays in this lane's ignored directory.
await build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' },
  build: { ssr: resolve('apps/realm/src/land/cli.ts'), target: 'node22', outDir: 'shots/grand-world/bake-cli',
    emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'bake.mjs' } } } });
