import { defineConfig } from 'vite';
export default defineConfig({
  build: { ssr: 'src/main.ts', outDir: 'dist', target: 'node22', rollupOptions: { output: { entryFileNames: 'api.mjs' } } },
  ssr: { noExternal: ['@chatdom/shared'], target: 'node' },
});
