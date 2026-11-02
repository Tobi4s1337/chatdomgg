import { resolve } from 'node:path';
import { build } from 'vite';

// Top-down landform previews for GW13; output stays in this lane's ignored directory.
await build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' }, logLevel: 'warn',
  build: { ssr: resolve('work/lanes/grand-world/gw13-preview.ts'), target: 'node22', outDir: 'shots/grand-world/gw13-cli',
    emptyOutDir: true, minify: false, rollupOptions: { output: { entryFileNames: 'preview.mjs' } } } });
