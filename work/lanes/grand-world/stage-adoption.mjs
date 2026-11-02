// Stage tobi4s_'s next adoption for a dev bench: the live founded scene plus what the merged realm adds when it next
// adopts the kingdom (today: the pier, from `pierFurnishings` in apps/realm/src/fishing/site.ts, exactly as
// apps/realm/src/founded/scene.ts appends it). The plan, homes, doors and every existing placement are unchanged;
// the collision revision moves by one, as an adoption with new geometry does. The output is a scene file and its
// receipt for the walk bench (capture-walk.mjs --scene/--receipt) and for the same-plan land publication CLI.
// Nothing is written to any live service; the live realm is read once through its public GET routes.
//
//   node work/lanes/grand-world/stage-adoption.mjs <out-dir>
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const [outDir] = process.argv.slice(2);
assert.ok(outDir, 'usage: stage-adoption.mjs <out-dir>');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const live = 'http://127.0.0.1:5197', kingdomId = '129634568';
const receipt = await (await fetch(`${live}/api/realm/founded/${kingdomId}`, { signal: AbortSignal.timeout(8000) })).json();
const liveBytes = new Uint8Array(await (await fetch(`${live}/api/realm/founded/scenes/${receipt.sceneHash}`, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());

const loader = await createViteServer({ root: repo, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const load = path => loader.ssrLoadModule(path);
  const [{ decodeFoundedScene, encodeFoundedScene }, { assetHashOf }, { pierFurnishings }] = await Promise.all([
    load('/packages/world/src/founded-world/validate.ts'), load('/packages/world/src/founded-world/codec.ts'), load('/apps/realm/src/fishing/site.ts')]);
  const scene = await decodeFoundedScene(liveBytes, receipt);
  const byHash = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const pieces = scene.placements.map(p => ({ id: p.id, blueprint: byHash.get(p.assetHash), position: p.position, rotation: p.rotation }));
  const added = pierFurnishings(scene.plan, pieces);
  assert.ok(added.length > 0, 'The realm finds no pier for this plan');
  const assets = [...scene.assets], placements = [...scene.placements], known = new Set(assets.map(a => a.assetHash));
  for (const piece of added) {
    const assetHash = await assetHashOf(piece.blueprint);
    if (!known.has(assetHash)) { known.add(assetHash); assets.push({ assetHash, blueprint: piece.blueprint }); }
    placements.push({ id: piece.id, assetHash, position: [...piece.position], rotation: piece.rotation });
  }
  const staged = { ...scene, collisionRevision: scene.collisionRevision + 1, assets, placements };
  const { bytes, manifest } = await encodeFoundedScene(staged);
  await decodeFoundedScene(bytes, manifest);
  await mkdir(resolve(outDir), { recursive: true });
  await writeFile(resolve(outDir, 'staged-scene.json'), bytes);
  await writeFile(resolve(outDir, 'staged-receipt.json'), JSON.stringify(manifest));
  await writeFile(resolve(outDir, 'live-scene.json'), liveBytes);
  await writeFile(resolve(outDir, 'live-receipt.json'), JSON.stringify(receipt));
  console.log(JSON.stringify({ live: receipt, staged: manifest, added: added.map(p => ({ id: p.id, position: p.position, rotation: p.rotation })) }, null, 1));
} finally { await loader.close(); }
