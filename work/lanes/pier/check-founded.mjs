// Read-only mechanical check against the lane's hash-verified copy of a public founded scene.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { runnerImport } from 'vite';

const bytes = await readFile(process.env.PIER_FOUNDED_SCENE ?? '/tmp/chatdom-pier-founded/scene.json');
const source = JSON.parse(bytes);
const { module: siteModule } = await runnerImport('./apps/realm/src/fishing/site.ts', { configFile: false });
const { module: collision } = await runnerImport('./packages/world/src/founded-world/collision.ts', { configFile: false });
const { module: movement } = await runnerImport('./packages/world/src/movement/step.ts', { configFile: false });
const { module: codec } = await runnerImport('./apps/realm/src/founded/codec.ts', { configFile: false });
const { module: costs } = await runnerImport('./packages/content/src/places/water/piece-checks.ts', { configFile: false });
const assetByHash = new Map(source.assets.map(asset => [asset.assetHash, asset.blueprint]));
const pieces = source.placements.map(piece => ({ ...piece, blueprint: assetByHash.get(piece.assetHash) }));
const installed = siteModule.installPier(source.plan, pieces);
if (!installed) throw new Error('No clear supported pier fits the copied scene.');
const assets = [...source.assets], placements = [...source.placements];
for (const piece of installed.pieces) {
  const assetHash = await codec.assetHashOf(piece.blueprint);
  if (!assets.some(asset => asset.assetHash === assetHash)) assets.push({ assetHash, blueprint: piece.blueprint });
  placements.push({ id: piece.id, position: piece.position, rotation: piece.rotation, assetHash });
}
const candidate = { ...source, collisionRevision: source.collisionRevision + 1, assets, placements };
if (JSON.stringify(candidate.placements.slice(0, source.placements.length)) !== JSON.stringify(source.placements)) throw new Error('An existing placement changed.');
const world = collision.compileFoundedScene(candidate);
const { site } = installed;
const start = siteModule.pierLocalToWorld(site, [10, 0, -6]);
const end = siteModule.pierLocalToWorld(site, [10, 0, (site.walk + 2) / .125]);
const player = { x: start[0], y: collision.foundedGroundAt(source.plan, start[0], start[2])[1], z: start[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision };
const input = { moveX: Math.sign(end[0] - start[0]) * 127, moveZ: Math.sign(end[2] - start[2]) * 127, buttons: 0, yaw: 0, collisionRevision: world.revision };
const ticks = Math.ceil((site.walk + 3) / 4 * 30);
for (let tick = 0; tick < ticks; tick++) {
  movement.stepPlayer(player, input, 1 / 30, world);
  if (movement.embeddedSolids(player, world).length || !movement.supported(player, world)) throw new Error(`The copied scene's pier walk lost clearance or support at tick ${tick}.`);
}
if (player.distance <= site.walk + 1 || Math.hypot(player.x - end[0], player.z - end[2]) >= 2 || Math.abs(player.y - site.deckY) > 1e-6) throw new Error('The walker did not reach the copied scene’s pier head.');
const result = { sourceSceneHash: createHash('sha256').update(bytes).digest('hex'), kingdomId: source.kingdomId, layoutRevision: source.layoutRevision,
  sourcePlacements: source.placements.length, preservedPlacements: source.placements.length, addedPlacements: installed.pieces.length,
  site, ticks, distance: player.distance, finalPosition: [player.x, player.y, player.z], bodyClearAndSupportedAtEveryTick: true,
  staticPierTriangles: installed.pieces.reduce((sum, piece) => sum + costs.meshCost(piece.blueprint).triangles, 0),
  staticPierMeshes: installed.pieces.length,
  costLimitations: 'Production mesher counts for timber only; no reflection, shadow, glow or fishing-layer draw/time measurement.' };
await mkdir('work/evidence/pier', { recursive: true });
await writeFile('work/evidence/pier/pi10-founded-collision.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
