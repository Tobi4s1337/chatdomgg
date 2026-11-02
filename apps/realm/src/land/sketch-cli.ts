import { writeFile } from 'node:fs/promises';
import { bakeSketchLand, genesisSketchRecipe } from './sketch';
import { LandArtifactStore } from './store';

// The private sketch of an unfounded Genesis channel: one land per run, at most two background threads.
process.env.UV_THREADPOOL_SIZE ??= '2';
if (!/^[12]$/.test(process.env.UV_THREADPOOL_SIZE)) throw new Error('Land baking permits at most two background workers');
const args = process.argv.slice(2), values = new Map<string, string>();
const flags = ['--channel', '--name', '--directory', '--report'];
for (let i = 0; i < args.length; i += 2) {
  const name = args[i]!, value = args[i + 1];
  if (!flags.includes(name) || !value || value.startsWith('--') || values.has(name)) throw new Error('Usage: sketch --channel ID --name NAME --directory DIR --report FILE');
  values.set(name, value);
}
if (values.size !== flags.length) throw new Error('Every sketch input and output must be explicit');
const abort = new AbortController();
process.once('SIGINT', () => abort.abort(new Error('Sketch bake interrupted')));
process.once('SIGTERM', () => abort.abort(new Error('Sketch bake interrupted')));
let decile = -1;
const result = await bakeSketchLand({ recipe: genesisSketchRecipe(values.get('--channel')!, values.get('--name')!),
  store: new LandArtifactStore(values.get('--directory')!), signal: abort.signal,
  onProgress(done, total) { const d = Math.floor(done * 10 / total); if (d !== decile) { decile = d; process.stdout.write(`${JSON.stringify({ stage: 'meshes', completed: done, total })}\n`); } } });
await writeFile(values.get('--report')!, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
