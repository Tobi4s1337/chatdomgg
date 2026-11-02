import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('builds the browser artifact readers without any generator, tree builder or voxelizer', async () => {
  const modules = new Set<string>();
  await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'inspect-baked-reader',
    moduleParsed(info) { modules.add(info.id); } }], build: { write: false, minify: false,
    rollupOptions: { input: ['codec.ts', 'surface.ts'].map(name => fileURLToPath(new URL(name, import.meta.url))) } } });
  const forbidden = [...modules].filter(id => /\/grand\/(?:generate|voxelize|kits|trees|terrain|erosion)\.ts$|\/grand\/artisans\//.test(id));
  expect(modules.size).toBeGreaterThan(0);
  expect(forbidden).toEqual([]);
}, 20_000);
