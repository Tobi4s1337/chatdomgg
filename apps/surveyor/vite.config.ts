import { defineConfig } from 'vite';

// One self-contained Node entry for the atlas:* scripts; node: built-ins stay external.
export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist',
    target: 'node22',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'atlas.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
