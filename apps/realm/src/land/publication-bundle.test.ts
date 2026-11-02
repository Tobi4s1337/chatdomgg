import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import { expect, it } from 'vitest';

it('bundles both publication entries without the grand land generator graph', async () => {
  const modules = new Set<string>();
  const inspect: Plugin = { name: 'publication-runtime-graph', generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) if (output.type === 'chunk') {
      for (const [id, module] of Object.entries(output.modules)) if (module.renderedLength > 0) modules.add(id);
    }
  } };
  await build({ configFile: false, logLevel: 'silent', plugins: [inspect],
    build: { write: false, minify: false, target: 'node22', ssr: true, rollupOptions: { input: {
      publication: fileURLToPath(new URL('./publication.ts', import.meta.url)),
      storeGuard: fileURLToPath(new URL('./publication-store.ts', import.meta.url)),
    } } }, ssr: { noExternal: true, target: 'node' } });
  expect([...modules].some(id => id.endsWith('/land/publication.ts'))).toBe(true);
  expect([...modules].some(id => id.endsWith('/land/publication-store.ts'))).toBe(true);
  expect([...modules].some(id => id.endsWith('/land/verify.ts'))).toBe(true);
  const forbidden = [...modules].filter(id => /\/land\/bake\.ts$|\/grand\/(?:generate|voxelize|erosion|kits|trees|terrain)\.ts$|\/grand\/artisans\/|\/grand\/baked\/(?:prepare|mesher|metadata)\.ts$|\/kingdom\/grand-land\/(?:prepare|worker)\.ts$/.test(id));
  expect(forbidden).toEqual([]);
}, 30_000);
