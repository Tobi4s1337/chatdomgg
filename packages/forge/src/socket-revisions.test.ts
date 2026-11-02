import { describe, expect, it } from 'vitest';
import { createHearthHome, createHome, createTideHome } from '@chatdom/content';
import { MAT, type StyleKey } from '@chatdom/content/materials';
import { FORGE_MOTIFS, type HomeTier, type HousePartPlan, type VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit } from './index';

const plan = (motif: typeof FORGE_MOTIFS[number]): HousePartPlan => ({ version: 2, kind: 'lantern', motif, finish: 'native', accent: 'none' });
const nativeHome = (family: StyleKey, tier: HomeTier, variant: 0 | 1 | 2): VoxelBlueprint => family === 'hearth'
  ? createHearthHome(tier, variant) : family === 'tide' ? createTideHome(tier, variant) : createHome(tier, family, variant);

describe('revision-bound Forge socket surveys', () => {
  it('clears the full lantern ornament above Bramblecross cottage without moving its historical revision-one socket', () => {
    const home = createHearthHome('cottage', 1), legacy = findForgeSockets(home);
    const oldSocket = legacy.find(socket => socket.kind === 'lantern')!;
    expect(oldSocket).toMatchObject({ profile: 'roof', origin: [32, 42, 90] });
    const historical = assembleForge(plan('sleeping-fox'), forgeStyleKit('hearth', 1), oldSocket);
    const historicalBytes = JSON.stringify(historical);
    expect(checkForge(historical, home).solidCells).toBeGreaterThan(80);

    const sockets = findForgeSockets(home, 'street-home', 2), socket = sockets.find(socket => socket.kind === 'lantern')!;
    expect(socket.profile).toBe('roof');
    expect(socket).not.toEqual(oldSocket);
    const parts = FORGE_MOTIFS.map(motif => assembleForge(plan(motif), forgeStyleKit('hearth', 2), socket));
    for (const part of parts) expect(checkForge(part, home).solidCells).toBeGreaterThan(80);

    // Independently survey the union of the ACTUAL authored part bounds, including its supports.
    // The chamber clears even the highest adjacent roof under an open gap in one of those sculptures.
    const solid = parts.flatMap(part => part.blueprint.boxes.filter(box => box.material !== MAT.air));
    const x0 = socket.origin[0] + Math.min(...solid.map(box => box.from[0]));
    const x1 = socket.origin[0] + Math.max(...solid.map(box => box.to[0]));
    const z0 = socket.origin[2] + Math.min(...solid.map(box => box.from[2]));
    const z1 = socket.origin[2] + Math.max(...solid.map(box => box.to[2]));
    expect(x0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(64);
    expect(z0).toBeGreaterThanOrEqual(0); expect(z1).toBeLessThanOrEqual(home.size[2]);
    expect(socket.origin[1] + Math.max(...solid.map(box => box.to[1]))).toBeLessThanOrEqual(160);
    const asset = rasterizeBlueprint(home), [sx, sy] = asset.size;
    let crown = 0;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      let y = sy - 1;
      while (y >= 0 && !asset.voxels[x + sx * (y + sy * z)]) y--;
      crown = Math.max(crown, y + 1);
    }
    const ridge = Math.max(...socket.supports.map(point => point[1] - socket.origin[1]));
    const chamberBottom = socket.origin[1] + Math.max(socket.clearanceHeight, ridge + 4);
    expect(chamberBottom).toBeGreaterThanOrEqual(crown + 2);

    expect(findForgeSockets(home, 'street-home', 1)).toEqual(legacy);
    expect(findForgeSockets(structuredClone(home))).toEqual(legacy);
    expect(JSON.stringify(assembleForge(plan('sleeping-fox'), forgeStyleKit('hearth', 1), oldSocket))).toBe(historicalBytes);
    expect(() => checkForge(assembleForge(plan('sleeping-fox'), forgeStyleKit('hearth', 2), oldSocket), home))
      .toThrow('no longer supports');
    socket.supports[0]![1] = -100;
    expect(findForgeSockets(structuredClone(home), 'street-home', 2).find(value => value.kind === 'lantern')!.supports[0]![1]).not.toBe(-100);
    expect(findForgeSockets(home)).toEqual(legacy);
  });

  it('keeps the old front-wall placement and gives revision two room for every authored lantern or a supported roof', () => {
    const original = createHome('house', 'hearth', 0);
    const home: VoxelBlueprint = { ...original, id: 'front-lot-revision-survey', size: [original.size[0], original.size[1], original.size[2] + 20] };
    const legacy = findForgeSockets(home).find(socket => socket.kind === 'lantern')!;
    expect(legacy.profile).toBe('wall');
    const socket = findForgeSockets(home, 'street-home', 2).find(socket => socket.kind === 'lantern')!;
    expect(socket).toBeDefined();
    for (const motif of FORGE_MOTIFS)
      expect(checkForge(assembleForge(plan(motif), forgeStyleKit('hearth', 2), socket), home).solidCells).toBeGreaterThan(80);
    expect(findForgeSockets(home, 'street-home', 1).find(socket => socket.kind === 'lantern')).toEqual(legacy);
  });

  it.each([0, -1, 3, 1.5, NaN, Infinity])('rejects unregistered socket revision %s', revision => {
    expect(() => findForgeSockets(createHearthHome('cottage', 1), 'street-home', revision)).toThrow('Unregistered');
  });

  for (const family of ['hearth', 'tide', 'grove'] as const) for (const tier of ['hut', 'cottage', 'house', 'manor', 'hall'] as const) for (const variant of [0, 1, 2] as const) {
    it(`${family} ${tier} ${variant}: every revision-two lantern motif fits the real native home`, () => {
      const home = nativeHome(family, tier, variant), historical = findForgeSockets(home, 'street-home', 1);
      const socket = findForgeSockets(home, 'street-home', 2).find(socket => socket.kind === 'lantern');
      expect(socket).toBeDefined();
      for (const motif of FORGE_MOTIFS) {
        const piece = assembleForge(plan(motif), forgeStyleKit(family, 2), socket!);
        expect(checkForge(piece, home).solidCells, motif).toBeGreaterThan(80);
      }
      expect(findForgeSockets(home)).toEqual(historical);
    }, 30_000);
  }
});
