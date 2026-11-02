import { readFile, writeFile } from 'node:fs/promises';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { publishFoundedLand } from './publication';
import { LandArtifactStore } from './store';

// This command verifies and reuses existing artifacts. It has no generation or meshing dependency.
process.env.UV_THREADPOOL_SIZE ??= '2';
if (!/^[12]$/.test(process.env.UV_THREADPOOL_SIZE)) throw new Error('Land publication permits at most two background workers');
const args = process.argv.slice(2), values = new Map<string, string>();
const required = ['--scene', '--receipt', '--recipe-hash', '--directory', '--report'];
const flags = [...required, '--source-scene'];
for (let i = 0; i < args.length; i += 2) {
  const name = args[i]!, value = args[i + 1];
  if (!flags.includes(name) || !value || value.startsWith('--') || values.has(name))
    throw new Error('Usage: publish --scene FILE --receipt FILE --recipe-hash HASH --directory DIR --report FILE [--source-scene HASH]');
  values.set(name, value);
}
if (!required.every(flag => values.has(flag))) throw new Error('Every publication input and output must be explicit');
const abort = new AbortController();
process.once('SIGINT', () => abort.abort(new Error('Land publication interrupted')));
process.once('SIGTERM', () => abort.abort(new Error('Land publication interrupted')));
const wall = performance.now(), cpu = process.cpuUsage();
const receipt = RealmFoundedManifestSchema.parse(JSON.parse(await readFile(values.get('--receipt')!, 'utf8')));
const result = await publishFoundedLand({ sceneBytes: new Uint8Array(await readFile(values.get('--scene')!)), receipt,
  recipeHash: values.get('--recipe-hash')!, store: new LandArtifactStore(values.get('--directory')!), signal: abort.signal,
  ...(values.has('--source-scene') ? { sourceSceneHash: values.get('--source-scene')! } : {}),
});
const used = process.cpuUsage(cpu);
const report = { ...result, wallSeconds: (performance.now() - wall) / 1000,
  cpuSeconds: (used.user + used.system) / 1e6, peakMemoryKiB: process.resourceUsage().maxRSS, workers: 0 };
await writeFile(values.get('--report')!, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
