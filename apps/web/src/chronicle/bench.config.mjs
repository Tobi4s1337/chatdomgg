import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.ts';
import { fileURLToPath } from 'node:url';

// A local-only build checks the isolated bench, which main has not mounted on a production route.
export default defineConfig(env => mergeConfig(base(env), {
  build: { rollupOptions: { input: fileURLToPath(new URL('./bench.html', import.meta.url)) } },
}));
