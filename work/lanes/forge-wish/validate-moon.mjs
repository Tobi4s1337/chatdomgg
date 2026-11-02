import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// The generic content catalogue does not expose motif factories. Validate the changed authored part directly,
// using the same schema, ordered raster, skylight preparation and mesher as content-validate.mjs.
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const { createHome } = await server.ssrLoadModule('/packages/content/src/core/index.ts');
  const { MAT, MATERIALS, STYLES } = await server.ssrLoadModule('/packages/content/src/materials.ts');
  const { VoxelBlueprintSchema } = await server.ssrLoadModule('/packages/shared/src/index.ts');
  const { assembleForge, checkForge, findForgeSockets, forgeStyleKit } = await server.ssrLoadModule('/packages/forge/src/index.ts');
  const { rasterizeBlueprint, prepareAssetChunks, meshVoxelChunk } = await server.ssrLoadModule('/packages/voxel/src/index.ts');
  const registered = new Set(MATERIALS.materials.map(material => material.id)), ids = new Set(), rows = [];
  for (const family of ['hearth', 'tide', 'grove']) {
    const home = createHome('house', family, 0), kit = STYLES[family];
    const socket = findForgeSockets(home).find(socket => socket.kind === 'lantern');
    assert(socket, 'A supported lantern socket is required.');
    const plan = { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' };
    const piece = assembleForge(plan, forgeStyleKit(family), socket), blueprint = VoxelBlueprintSchema.parse(piece.blueprint);
    assert.deepEqual(assembleForge(plan, forgeStyleKit(family), socket).blueprint, blueprint);
    assert(!ids.has(blueprint.id), 'Asset names must be unique.'); ids.add(blueprint.id);
    const palette = new Set([MAT.air, kit.stone, MAT.brass, MAT.glass,
      family === 'hearth' ? MAT.limestone : family === 'tide' ? MAT.cream : MAT.thatch, ...(family === 'grove' ? [MAT.goldLeaf] : [])]);
    assert(blueprint.boxes.every(box => registered.has(box.material) && palette.has(box.material)), 'Native palette lock failed.');
    const { solidCells } = checkForge(piece, home);
    assert(blueprint.boxes.length <= 512 && solidCells <= 15_000, 'Source/occupied budget exceeded.');
    const asset = rasterizeBlueprint(blueprint);
    let triangles = 0, chunks = 0;
    for (const prepared of prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)) {
      triangles += meshVoxelChunk(prepared).indices.length / 3; chunks++;
    }
    assert(triangles > 0 && triangles <= 40_000, 'Production mesh budget exceeded.');
    rows.push({ id: blueprint.id, style: family, boxes: blueprint.boxes.length, solidCells, triangles, chunks });
  }
  await writeFile('work/evidence/forge-wish/contact-sheets/moon-validation.json', JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify(rows));
} finally { await server.close(); }
