// GW13 sheet of real channels' own worlds (unfounded channels as private sketches, decision 3).
// usage:
//   node work/lanes/grand-world/sheet-gw13.mjs pick <login…>     resolve each on the Atlas and print the world the realm would pin
//   node work/lanes/grand-world/sheet-gw13.mjs raise <login…>    raise each into shots/grand-world/sketches (nice 19, one at a time, no lock)
//   node work/lanes/grand-world/sheet-gw13.mjs serve <port>      serve that store as the realm's land routes (inside a GPU lease)
// The host bundle is the realm's own land code (sketch-host.ts); the Atlas is read through its public GET routes.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const [mode, ...rest] = process.argv.slice(2);
const host = resolve('shots/grand-world/sketch-host'), store = resolve('shots/grand-world/sketches');
const ATLAS = process.env.GW13_ATLAS_BASE ?? 'http://127.0.0.1:5193/map-data';
await mkdir(host, { recursive: true });
const bundle = (entry, name) => build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' }, logLevel: 'warn',
  build: { ssr: resolve(entry), target: 'node22', outDir: host, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: name } } } });
if (mode === 'raise') await bundle('apps/realm/src/land/cli.ts', 'land-bake.mjs');
await bundle('work/lanes/grand-world/sketch-host.ts', 'host.mjs');
const hostModule = await import(pathToFileURL(`${host}/host.mjs`).href);

async function idOf(login) {
  if (/^[0-9]+$/.test(login)) return login;
  const pointer = await (await fetch(`${ATLAS}/v1/preview`)).json();
  const card = await (await fetch(`${ATLAS}/v1/preview/${pointer.id}/card/login/${login.toLowerCase()}`)).json();
  return card.channel.id;
}

if (mode === 'pick') {
  for (const login of rest) {
    try {
      const id = await idOf(login), recipe = await hostModule.channelWorld(id);
      if (!recipe) { console.log(login, id, 'no world'); continue; }
      const s = recipe.seed;
      console.log([login, id, s.tier, s.biome, s.character, s.world.landform, s.world.forest.join('+'), s.world.crest.field, s.world.landmark].join('\t'));
    } catch (error) { console.log(login, 'error', error.message); }
  }
} else if (mode === 'raise') {
  const land = await hostModule.serveSketches(store, `${host}/land-bake.mjs`, Number(process.env.GW13_LAND_PORT ?? 5198), line => console.log('[realm]', line));
  try {
    for (const login of rest) {
      const id = await idOf(login), recipe = await hostModule.channelWorld(id);
      if (!recipe) { console.log(login, 'has no world'); continue; }
      const hash = await hostModule.grandSketchRecipeHash(recipe);
      const started = Date.now();
      for (;;) {
        const answer = await fetch(`http://127.0.0.1:${process.env.GW13_LAND_PORT ?? 5198}/api/realm/land/${id}/${hash}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: hostModule.canonical(recipe) });
        const status = await answer.json();
        if (status.state === 'ready') { console.log(login, id, hash.slice(0, 8), `ready after ${Math.round((Date.now() - started) / 1000)} s`); break; }
        if (status.state !== 'raising') { console.log(login, id, 'refused', JSON.stringify(status)); break; }
        await new Promise(done => setTimeout(done, 3000));
      }
    }
  } finally { await land.close(); }
} else if (mode === 'serve') {
  const land = await hostModule.serveSketches(store, null, Number(rest[0] ?? 5191), line => console.log('[realm]', line));
  console.log('serving');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void land.close().then(() => process.exit(0)); });
} else throw new Error('usage: sheet-gw13.mjs pick|raise|serve …');
