import { defineConfig } from 'vite';
export default defineConfig({
  build: { ssr: 'src/main.ts', outDir: 'dist', target: 'node22', rollupOptions: { output: { entryFileNames: 'realm.mjs' } } },
  ssr: { noExternal: ['@chatdom/shared', '@chatdom/world'], target: 'node' },
});
