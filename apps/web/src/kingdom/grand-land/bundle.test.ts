import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import { expect, it } from 'vitest';

it('ships the native baked land renderer and its workers without land production code', async () => {
  const native = new Set<string>(), workers = new Set<string>();
  function inspect(name: string, modules: Set<string>): Plugin {
    return { name, generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) if (output.type === 'chunk') {
        for (const [id, module] of Object.entries(output.modules)) if (module.renderedLength > 0) modules.add(id);
      }
    } };
  }
  await build({ configFile: false, logLevel: 'silent', plugins: [inspect('native-land-runtime', native)],
    worker: { plugins: () => [inspect('native-land-worker-runtime', workers)] },
    build: { write: false, minify: false, target: 'es2022', lib: {
      entry: fileURLToPath(new URL('./index.ts', import.meta.url)), formats: ['es'], fileName: 'native-land',
    } } });
  const forbidden = [...native, ...workers].filter(id => /\/grand\/(?:generate|voxelize|erosion|kits|trees|terrain)\.ts$|\/grand\/artisans\/|\/grand\/baked\/(?:prepare|mesher|metadata)\.ts$|\/kingdom\/grand-land\/(?:prepare|worker)\.ts$/.test(id));
  expect([...native].some(id => id.endsWith('/grand-land/index.ts'))).toBe(true);
  expect([...native].some(id => id.endsWith('/grand-land/baked-client.ts'))).toBe(true);
  expect(forbidden).toEqual([]);
  // Worker bundles are inspected by their own Vite plugin, rather than treating their emitted
  // JavaScript assets as opaque files in the main bundle.
  expect(workers.size).toBeGreaterThan(0);
  expect([...workers].some(id => id.includes('/grand/baked/'))).toBe(true);
}, 30_000);
