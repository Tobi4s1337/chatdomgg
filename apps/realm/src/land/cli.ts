import { readFile, writeFile } from 'node:fs/promises';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import type { GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import { bakeFoundedLand } from './bake';
import { LandArtifactStore } from './store';

// Bound asynchronous compression/file work as well as the single synchronous mesher.
process.env.UV_THREADPOOL_SIZE ??= '2';
if (!/^[12]$/.test(process.env.UV_THREADPOOL_SIZE)) throw new Error('Land baking permits at most two background workers');
const args = process.argv.slice(2), values = new Map<string, string>();
const flags = ['--scene', '--receipt', '--recipe', '--directory', '--report'];
for (let i = 0; i < args.length; i += 2) {
  const name = args[i]!, value = args[i + 1];
  if (!flags.includes(name) || !value || value.startsWith('--') || values.has(name)) throw new Error('Usage: bake --scene FILE --receipt FILE --recipe FILE --directory DIR --report FILE');
  values.set(name, value);
}
if (values.size !== flags.length) throw new Error('Every bake input and output path must be explicit');
const abort = new AbortController();
process.once('SIGINT', () => abort.abort(new Error('Land bake interrupted')));
process.once('SIGTERM', () => abort.abort(new Error('Land bake interrupted')));
const receipt = RealmFoundedManifestSchema.parse(JSON.parse(await readFile(values.get('--receipt')!, 'utf8')));
const recipe = JSON.parse(await readFile(values.get('--recipe')!, 'utf8')) as GrandLandRecipe;
let lastStage = '', lastDecile = -1;
const result = await bakeFoundedLand({ sceneBytes: new Uint8Array(await readFile(values.get('--scene')!)), receipt, recipe,
  store: new LandArtifactStore(values.get('--directory')!), signal: abort.signal,
  onProgress(progress) {
    const decile = Math.floor(progress.completed * 10 / Math.max(1, progress.total));
    if (progress.stage !== lastStage || decile !== lastDecile) {
      process.stdout.write(`${JSON.stringify(progress)}\n`); lastStage = progress.stage; lastDecile = decile;
    }
  } });
await writeFile(values.get('--report')!, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
