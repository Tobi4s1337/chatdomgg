import { existsSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { expect, it } from 'vitest';

/*
 * GW11: a viewer never generates land. This builds the modules the kingdom, stream and walk routes load
 * (`main.tsx` imports them by route) with the app's own plugin, follows every chunk, dynamic import and worker,
 * and proves no grand land generator or baker ships in them. Library mode keeps every export of the entries,
 * so this sees at least as much code as the app build does.
 */

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const ROUTES = {
  /** `/` and `/kingdom` views: the kingdom component and the scene host it (and the Chronicle) open. */
  kingdom: 'apps/web/src/kingdom/index.tsx',
  scene: 'apps/web/src/kingdom/scene.ts',
  /** `/stream` and `/-/stream`. */
  stream: 'apps/web/src/stream/index.tsx',
  /** `/?walk=1`: the four modules main.tsx imports for the walk. */
  walk: 'apps/web/src/kingdom-entry/index.tsx',
  walkLive: 'apps/web/src/kingdom-entry/live.ts',
  walkSimulated: 'apps/web/src/kingdom-entry/simulated.ts',
  walkEntryAdapter: 'apps/web/src/realm/adapters/entry.ts',
  /** `/-/grand?channel=`: the public grand view (the staged bench is its own lazy route, `/-/grand-bench`). */
  grand: 'apps/web/src/grand/live.tsx',
} as const;

/** Land production: anything that raises, seats, grades, dresses or meshes the grand land. The baked reader
 * (`grand/baked/{codec,metadata-codec,surface,types,validation}.ts`), the palette and the pinned recipe are not. */
const PRODUCERS: readonly { readonly pattern: RegExp; readonly role: string }[] = [
  { pattern: /^packages\/world\/src\/grand\/(?:index|generate|plan|terrain|erosion|cover|flora|trees|kits|voxelize|noise|distance|sky-map)\.ts$/, role: 'grand land generator' },
  { pattern: /^packages\/world\/src\/grand\/artisans\//, role: 'grand land artisans and kits' },
  { pattern: /^packages\/world\/src\/grand\/kingdom\/(?:index|grade|seat|sites)\.ts$|^packages\/world\/src\/grand\/kingdom\/walls\//, role: 'kingdom seating and grading' },
  { pattern: /^packages\/world\/src\/grand\/baked\/(?:prepare|mesher|metadata)\.ts$/, role: 'offline baker' },
  { pattern: /^packages\/voxel\/src\/grand\/quad-mesher\.ts$/, role: 'grand quad mesher' },
  { pattern: /^apps\/web\/src\/kingdom\/grand-land\/(?:prepare|worker|pier-water-fixture)\.ts$/, role: 'in-browser land generation' },
  { pattern: /^apps\/web\/src\/grand\/(?:worker|land-cache)\.ts$|^apps\/web\/src\/grand\/artisans\//, role: 'grand bench generation' },
  { pattern: /^apps\/realm\/src\/land\/bake\.ts$/, role: 'realm land bake' },
];
/** Real files the patterns must keep covering, so a rename cannot leave the guard looking at nothing. */
const KNOWN_PRODUCERS = [
  'packages/world/src/grand/generate.ts', 'packages/world/src/grand/terrain.ts', 'packages/world/src/grand/erosion.ts',
  'packages/world/src/grand/voxelize.ts', 'packages/world/src/grand/kits.ts', 'packages/world/src/grand/trees.ts',
  'packages/world/src/grand/plan.ts', 'packages/world/src/grand/cover.ts', 'packages/world/src/grand/flora.ts',
  'packages/world/src/grand/artisans/index.ts', 'packages/world/src/grand/kingdom/grade.ts', 'packages/world/src/grand/kingdom/seat.ts',
  'packages/world/src/grand/baked/prepare.ts', 'packages/world/src/grand/baked/mesher.ts', 'packages/world/src/grand/baked/metadata.ts',
  'packages/voxel/src/grand/quad-mesher.ts', 'apps/web/src/kingdom/grand-land/prepare.ts', 'apps/web/src/kingdom/grand-land/worker.ts',
  'apps/web/src/grand/worker.ts', 'apps/realm/src/land/bake.ts',
];

const repoPath = (id: string) => relative(REPO, id.replace(/^\0/, '').replace(/[?#].*$/, '')).split(sep).join('/');
const producerRole = (path: string) => PRODUCERS.find(({ pattern }) => pattern.test(path))?.role;

interface Shipped { readonly build: string; readonly path: string; readonly chain: readonly string[] }

/** Collects every module with rendered code, and for land producers the import chain from an entry. */
function inspect(name: string, shipped: Map<string, Shipped>, offenders: Shipped[]): Plugin {
  return { name: `client-land-guard-${name}`, generateBundle(_options, bundle) {
    const chainTo = (id: string): string[] => {
      const seen = new Map<string, string | null>([[id, null]]), queue = [id];
      while (queue.length) {
        const current = queue.shift()!, info = this.getModuleInfo(current);
        if (!info || info.isEntry) {
          const chain: string[] = [];
          for (let at: string | null | undefined = current; at; at = seen.get(at)) chain.push(repoPath(at));
          return chain;
        }
        for (const importer of [...info.importers, ...info.dynamicImporters]) {
          if (!seen.has(importer)) { seen.set(importer, current); queue.push(importer); }
        }
      }
      return [repoPath(id)];
    };
    for (const output of Object.values(bundle)) {
      if (output.type === 'asset') {
        for (const source of output.originalFileNames ?? []) {
          const path = repoPath(source);
          if (producerRole(path)) offenders.push({ build: `${name} asset ${output.fileName}`, path, chain: [path] });
        }
        continue;
      }
      for (const [id, module] of Object.entries(output.modules)) {
        if (module.renderedLength <= 0) continue;
        const path = repoPath(id), entry = { build: `${name} ${output.fileName}`, path, chain: [] as string[] };
        shipped.set(path, entry);
        if (producerRole(path)) offenders.push({ ...entry, chain: chainTo(id) });
      }
    }
  } };
}

it('ships the kingdom, stream and walk routes, and their workers, without any land generator', async () => {
  for (const path of [...Object.values(ROUTES), ...KNOWN_PRODUCERS]) expect(existsSync(`${REPO}${path}`), path).toBe(true);
  for (const path of KNOWN_PRODUCERS) expect(producerRole(path), path).toBeDefined();
  for (const reader of ['codec', 'metadata-codec', 'surface', 'types', 'validation'])
    expect(producerRole(`packages/world/src/grand/baked/${reader}.ts`), reader).toBeUndefined();

  const main = new Map<string, Shipped>(), workers = new Map<string, Shipped>(), offenders: Shipped[] = [];
  const entry = Object.fromEntries(Object.entries(ROUTES).map(([name, path]) => [name, `${REPO}${path}`]));
  // The app's own Vite setup (apps/web/vite.config.ts): the Solid plugin and an es2022 target. Workers are
  // inspected by their own plugin instance rather than treated as opaque emitted files.
  await build({ configFile: false, root: WEB, logLevel: 'silent', plugins: [solid(), inspect('main', main, offenders)],
    worker: { plugins: () => [inspect('worker', workers, offenders)] },
    build: { write: false, minify: false, target: 'es2022', lib: { entry, formats: ['es'] } } });

  // The builds really contain the routes and the baked land reader the client legitimately uses.
  for (const path of [...Object.values(ROUTES), 'apps/web/src/kingdom/grand-land/index.ts', 'apps/web/src/kingdom/grand-land/baked-client.ts',
    'apps/web/src/kingdom/grand-land/opening/loader.ts', 'packages/world/src/grand/baked/codec.ts']) expect(main.has(path), path).toBe(true);
  for (const path of ['apps/web/src/kingdom/grand-land/baked-client-worker.ts', 'packages/world/src/grand/baked/codec.ts'])
    expect(workers.has(path), path).toBe(true);

  const report = offenders.map(({ build: where, path, chain }) => `${producerRole(path)}: ${path} in ${where}\n  ${chain.join('\n  -> ')}`);
  expect(report, `Land production ships in a client bundle:\n${report.join('\n')}`).toEqual([]);
}, 120_000);

it('detects a generator and names the import chain that brings it in', async () => {
  // Control: the browser-generation seam must trip the same guard, so a pass above is not a blind guard.
  const shipped = new Map<string, Shipped>(), offenders: Shipped[] = [];
  await build({ configFile: false, root: WEB, logLevel: 'silent', plugins: [inspect('control', shipped, offenders)],
    build: { write: false, minify: false, target: 'es2022', lib: { entry: { control: `${REPO}apps/web/src/kingdom/grand-land/prepare.ts` }, formats: ['es'] } } });
  const generator = offenders.find(({ path }) => path === 'packages/world/src/grand/generate.ts');
  expect(generator?.chain[0]).toBe('apps/web/src/kingdom/grand-land/prepare.ts');
  expect(generator?.chain).toContain('packages/world/src/grand/baked/prepare.ts');
  expect(generator?.chain.at(-1)).toBe('packages/world/src/grand/generate.ts');
  expect(offenders.some(({ path }) => path.startsWith('packages/world/src/grand/artisans/'))).toBe(true);
}, 120_000);
