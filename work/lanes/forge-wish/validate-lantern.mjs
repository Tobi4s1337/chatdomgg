import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const { createNativeForgeHost, assembleForge, checkForge, findForgeSockets, forgeStyleKit } = await server.ssrLoadModule('/packages/forge/src/index.ts');
  const { MATERIALS } = await server.ssrLoadModule('/packages/content/src/materials.ts');
  const { FORGE_MOTIFS, VoxelBlueprintSchema } = await server.ssrLoadModule('/packages/shared/src/index.ts');
  const { rasterizeBlueprint, prepareAssetChunks, meshVoxelChunk } = await server.ssrLoadModule('/packages/voxel/src/index.ts');
  const registered = new Set(MATERIALS.materials.map(material => material.id));
  const results = [], meshes = [], unavailable = [];
  for (const family of ['hearth', 'tide', 'grove']) for (const tier of ['hut', 'cottage', 'house', 'manor', 'hall']) for (const variant of [0, 1, 2]) {
    const home = createNativeForgeHost({ slot: 0, position: [0, 0, 0], rotation: 0, tier, style: family, variant }).blueprint;
    const socket = findForgeSockets(home, 'street-home', 2).find(socket => socket.kind === 'lantern');
    const previousSocket = findForgeSockets(home).find(socket => socket.kind === 'lantern');
    assert(socket, 'Native home needs a real lantern socket.');
    for (const motif of FORGE_MOTIFS) {
      // Every motif across all native hosts; every finish/accent on one actual house per family.
      const finishes = tier === 'house' && variant === 0 ? ['native', 'copper', 'ceramic'] : ['native'];
      const accents = tier === 'house' && variant === 0 ? ['none', 'stars', 'leaves', 'scales'] : ['none'];
      for (const finish of finishes) for (const accent of accents) {
        const plan = { version: 2, kind: 'lantern', motif, finish, accent }, kit = forgeStyleKit(family, 2);
        const piece = assembleForge(plan, kit, socket), blueprint = VoxelBlueprintSchema.parse(piece.blueprint);
        assert.deepEqual(assembleForge(plan, kit, socket).blueprint, blueprint, 'Native construction must be deterministic.');
        assert(blueprint.boxes.every(box => registered.has(box.material)), 'Unregistered material.');
        let checked;
        try { checked = checkForge(piece, home); }
        catch (error) {
          let alreadyUnavailable = false;
          try { assert(previousSocket); checkForge(assembleForge(plan, forgeStyleKit(family, 1), previousSocket), home); }
          catch { alreadyUnavailable = true; }
          if (!alreadyUnavailable || ['crescent-moon', 'sunflower'].includes(motif))
            throw new Error(`${home.id} ${motif}/${finish}/${accent}: ${error.message}`, { cause: error });
          unavailable.push({ home: home.id, family, tier, variant, motif, finish, accent,
            reason: error.message, revisionOneAlsoUnavailable: true });
          continue;
        }
        const { solidCells, palette } = checked;
        assert(blueprint.boxes.length <= 600 && solidCells <= 15_000 && palette.length <= 9);
        results.push({ home: home.id, family, tier, variant, motif, finish, accent, socket: socket.profile,
          boxes: blueprint.boxes.length, solidCells, colours: palette.length });
        if (tier === 'house' && variant === 0 && finish === 'native' && accent === 'none'
          && ['crescent-moon', 'sunflower', 'sleeping-dragon'].includes(motif)) {
          let triangles = 0, chunks = 0;
          for (const chunk of prepareAssetChunks(rasterizeBlueprint(blueprint), MATERIALS.materials, MATERIALS.revision)) {
            triangles += meshVoxelChunk(chunk).indices.length / 3; chunks++;
          }
          assert(triangles > 0 && triangles <= 40_000, 'Production mesh budget exceeded.');
          meshes.push({ family, motif, triangles, chunks });
        }
      }
    }
  }
  const output = 'work/evidence/forge-wish/lantern-kit2';
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/validation.json`, JSON.stringify({ kitRevision: 2, results, meshes, unavailable }, null, 2) + '\n');
  console.info(JSON.stringify({ kitRevision: 2, nativeFits: results.length, productionMeshes: meshes.length,
    maxCells: Math.max(...results.map(result => result.solidCells)), maxBoxes: Math.max(...results.map(result => result.boxes)),
    maxTriangles: Math.max(...meshes.map(mesh => mesh.triangles)), alreadyUnavailable: unavailable.length }));
} finally { await server.close(); }
