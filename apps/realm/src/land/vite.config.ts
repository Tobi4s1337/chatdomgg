import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The land bake command, bundled beside the realm (`pnpm --filter @chatdom/realm build:land`, after `build`, which
// empties dist/). The realm runs it in a niced child for a plan that has no baked land yet. It carries the
// generator, the artisans' kits (an eager import.meta.glob registry) and the mesher; the realm bundle does not.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: here('../../../..'),
  ssr: { noExternal: true, target: 'node' },
  build: { ssr: here('./cli.ts'), target: 'node22', outDir: here('../../dist'), emptyOutDir: false, minify: false,
    rollupOptions: { output: { entryFileNames: 'land-bake.mjs' } } },
});
