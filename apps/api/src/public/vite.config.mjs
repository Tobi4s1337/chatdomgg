// The public origin's server bundle: src/public/main.ts -> apps/api/dist/public.mjs, beside the API's own build so
// its runtime packages (pg, jose) resolve from apps/api/node_modules. Built by the API's `build` script, right after
// dist/api.mjs (whose build empties dist/), so every build of the API leaves both bundles.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: 'src/public/main.ts', outDir: 'dist', emptyOutDir: false, target: 'node22',
    rollupOptions: { output: { entryFileNames: 'public.mjs' } },
  },
  ssr: { noExternal: ['@chatdom/shared', '@chatdom/ui'], target: 'node' },
});
