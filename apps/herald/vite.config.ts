import { defineConfig } from 'vite';

/** Herald runs on Node, never in a browser: one self-contained server bundle. */
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'herald.mjs' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
