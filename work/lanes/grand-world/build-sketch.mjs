import { resolve } from 'node:path';
import { build } from 'vite';

// The private sketch bake for unfounded Genesis channels; output stays in this lane's ignored directory.
await build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' }, logLevel: 'warn',
  build: { ssr: resolve('apps/realm/src/land/sketch-cli.ts'), target: 'node22', outDir: 'shots/grand-world/sketch-cli',
    emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'sketch.mjs' } } } });
