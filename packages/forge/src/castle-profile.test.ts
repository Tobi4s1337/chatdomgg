import { describe, expect, it } from 'vitest';
import { createCastleModule, createHearthHome, MATERIALS } from '@chatdom/content';
import { ForgeRunRequestSchema, VoxelBlueprintSchema, type HousePartPlan } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '@chatdom/voxel';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit } from './index';

const dragon: HousePartPlan = { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' };

describe('owned castle Forge profile', () => {
  it.each(['hearth', 'tide', 'grove'] as const)('fits, serializes and meshes the sleeping dragon on the actual full native %s keep', family => {
    const keep = createCastleModule('keep', [32, 31, 32], family);
    expect(keep.size).toEqual([256, 248, 256]);
    expect(ForgeRunRequestSchema.safeParse({ words: 'sleeping dragon chimney', family: 'hearth', home: keep }).success).toBe(false);
    const sockets = findForgeSockets(keep, 'castle-keep');
    expect(sockets.map(socket => socket.kind)).toEqual(['chimney', 'weathervane', 'lantern']);
    for (const candidate of sockets) {
      const plan: HousePartPlan = { version: 2, kind: candidate.kind, motif: candidate.kind === 'chimney' ? 'sleeping-dragon' : candidate.kind === 'lantern' ? 'crescent-moon' : 'watchful-owl', finish: 'native', accent: 'none' };
      expect(checkForge(assembleForge(plan, forgeStyleKit(family), candidate), keep, 'castle-keep').solidCells).toBeGreaterThan(80);
    }
    const socket = sockets.find(candidate => candidate.kind === 'chimney')!;
    expect(socket).toMatchObject({ profile: 'roof', hostProfile: 'castle-keep' });
    expect(socket.origin[2] + 16).toBeGreaterThan(keep.size[2] * .7);
    const made = assembleForge(dragon, forgeStyleKit(family), socket);
    expect(checkForge(made, keep, 'castle-keep').solidCells).toBeGreaterThan(80);
    expect(() => checkForge(made, keep)).toThrow();
    const roundTrip = VoxelBlueprintSchema.parse(JSON.parse(JSON.stringify(made.blueprint)));
    expect(roundTrip).toEqual(made.blueprint);
    const chunks = prepareAssetChunks(rasterizeBlueprint(roundTrip), MATERIALS.materials);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map(meshVoxelChunk).reduce((sum, chunk) => sum + chunk.quadCount, 0)).toBeGreaterThan(0);
    // The cached survey is content-bound and callers cannot mutate its socket proof.
    const proof = structuredClone(socket);
    socket.supports[0]![1] = -10;
    expect(findForgeSockets(structuredClone(keep), 'castle-keep').find(candidate => candidate.kind === 'chimney')).toEqual(proof);
    const changed = structuredClone(keep); changed.id = 'changed-keep';
    expect(() => checkForge(made, changed, 'castle-keep')).toThrow('changed');
  });

  it('retains street limits and rejects profile changes or oversized civic hosts', () => {
    const home = createHearthHome('house', 0);
    const socket = findForgeSockets(home).find(candidate => candidate.kind === 'chimney')!;
    expect(socket.hostProfile).toBeUndefined();
    const made = assembleForge(dragon, forgeStyleKit('hearth'), socket);
    expect(checkForge(made, home).solidCells).toBeGreaterThan(80);
    expect(findForgeSockets(home, 'street-home')).toEqual(findForgeSockets(home));
    expect(() => checkForge(made, home, 'castle-keep')).toThrow();
    const keep = createCastleModule('keep', [32, 31, 32], 'hearth');
    expect(() => findForgeSockets({ ...keep, size: [257, 248, 256] }, 'castle-keep')).toThrow();
    expect(() => findForgeSockets({ ...keep, kind: 'home' }, 'castle-keep')).toThrow();
  });
});
