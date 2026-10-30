import { describe, expect, it } from 'vitest';
import { affectedChunkCoordinates, chunkCoordinate, HALO_VOLUME, haloIndex, localCoordinate, voxelIndex } from './coordinates';
import { packVoxelVertex, unpackVoxelVertex } from './packing';
import { buildLightVolume, floodLight, rasterizeLightOccluders, sampleLightVolume } from './light';
import { meshVoxelChunk, sameMeshStamp, type VoxelChunkMesh } from './mesh';
import { computeAssetSky, prepareAssetChunks, rasterizeBlueprint } from './asset';
import { executeVoxelJob, resultTransferables, type VoxelJob, type VoxelWorkerResponse } from './protocol';
import { VoxelWorkerPool, type VoxelWorkerAdapter } from './worker-pool';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import type { LightEmitter, LightVolumeSpec } from './light';
import type { MeshStamp, VoxelMaterial } from './types';

describe('voxel chunk boundaries', () => {
  it.each([
    [-65, -3, 31], [-64, -2, 0], [-33, -2, 31], [-32, -1, 0], [-1, -1, 31],
    [0, 0, 0], [31, 0, 31], [32, 1, 0], [33, 1, 1],
  ])('maps world cell %i to chunk %i and local %i', (cell, chunk, local) => {
    expect(chunkCoordinate(cell)).toBe(chunk);
    expect(localCoordinate(cell)).toBe(local);
    expect(chunk * 32 + local).toBe(cell);
  });

  it('invalidates every diagonal halo reader on a negative-coordinate corner edit', () => {
    const affected = affectedChunkCoordinates([-32, 31, 0]);
    expect(affected).toHaveLength(8);
    expect(new Set(affected.map((chunk) => chunk.join(',')))).toEqual(new Set([
      '-2,0,-1', '-2,0,0', '-2,1,-1', '-2,1,0',
      '-1,0,-1', '-1,0,0', '-1,1,-1', '-1,1,0',
    ]));
    expect(affectedChunkCoordinates([10, 11, 12])).toEqual([[0, 0, 0]]);
    expect(haloIndex(-1, -1, -1)).toBe(0);
    expect(haloIndex(32, 32, 32)).toBe(34 ** 3 - 1);
  });
});

describe('finite voxel assets and worker jobs', () => {
  const stone: VoxelMaterial = { id: 1, name: 'stone', solid: true, occludesFaces: true,
    occludesAo: true, blocksLight: true, colour: '#666666', surface: 'stone' };
  const blueprint = VoxelBlueprintSchema.parse({
    version: 1, id: 'lit-home', styleId: 'stone-town', kind: 'home', lattice: 'build', size: [8, 6, 2],
    boxes: [
      { from: [0, 0, 0], to: [8, 6, 2], material: 1 },
      { from: [2, 2, 0], to: [6, 5, 2], material: 0 },
      { from: [3, 2, 0], to: [4, 5, 2], material: 1 },
    ],
    windows: [{ id: 'window', centre: [4, 3, 0], width: 4, height: 3, facing: 'north' }],
  });

  it('executes boxes in order so a window is a real opening and a later mullion restores material', () => {
    const asset = rasterizeBlueprint(blueprint, 7);
    expect(asset.id).toBe('lit-home');
    expect(asset.revision).toBe(7);
    expect(asset.voxels[voxelIndex(1, 3, 1, asset.size)]).toBe(1);
    expect(asset.voxels[voxelIndex(2, 3, 1, asset.size)]).toBe(0);
    expect(asset.voxels[voxelIndex(3, 3, 1, asset.size)]).toBe(1);
    expect(asset.voxels[voxelIndex(4, 3, 1, asset.size)]).toBe(0);
    expect(asset.voxels[voxelIndex(4, 5, 1, asset.size)]).toBe(1);
  });

  it('accounts for a roof in another vertical chunk rather than assuming the chunk top is sky', () => {
    const size = [34, 42, 34] as const;
    const voxels = new Uint16Array(size[0] * size[1] * size[2]);
    for (let z = 0; z < size[2]; z++) for (let y = 0; y <= 40; y++) for (let x = 0; x < size[0]; x++) {
      if (y === 0 || y === 40 || x === 0 || x === 33 || z === 0 || z === 33) {
        voxels[voxelIndex(x, y, z, size)] = 1;
      }
    }
    const chunks = prepareAssetChunks({ id: 'shelter', revision: 3, lattice: 'build', size, voxels }, [stone], 8);
    const lower = chunks.find((chunk) => chunk.coordinate.join(',') === '0,0,0')!;
    expect(lower.sky[haloIndex(16, 30, 16)]).toBe(0);
    expect(lower.sky[haloIndex(16, 32, 16)]).toBe(0);
    expect(lower.stamp.dependencies).toContainEqual({ key: 'shelter:full-sky', revision: 3 });
    expect(lower.stamp.materialRevision).toBe(8);
    const roof = chunks.find((chunk) => chunk.coordinate.join(',') === '0,1,0')!;
    expect(roof.halo[haloIndex(16, 8, 16)]).toBe(1);
    expect(roof.sky[haloIndex(16, 9, 16)]).toBe(15);
  });

  it('matches an independently seeded full sky flood for irregular roofs, holes and overhangs', () => {
    const size = [9, 12, 11] as const;
    const padded = [size[0] + 2, size[1] + 2, size[2] + 2] as const;
    const shapes: Array<(x: number, y: number, z: number) => boolean> = [
      () => false,
      (_x, y) => y === 6,
      (x, y, z) => y === 8 && (x + 2 * z) % 5 !== 0,
      (x, y, z) => (y === 3 || y === 8) && (x * 3 + z * 2 + y) % 7 !== 0,
      (x, y, z) => (y === 2 || y === 8 || x === 1 || x === 7 || z === 1 || z === 9)
        && x >= 1 && x <= 7 && z >= 1 && z <= 9 && y >= 2 && y <= 8,
      (x, y, z) => (y === (x + z) % 9 + 1 || (y === 2 && x > 1 && x < 7)) && (x + z) % 4 !== 0,
      (x, y, z) => ((x * 17 + y * 7 + z * 11) % 13 < 2) || (y === 9 && x < 6 && z < 8),
    ];
    for (const [shapeIndex, solid] of shapes.entries()) {
      const voxels = new Uint16Array(size[0] * size[1] * size[2]);
      const occupancy = new Uint8Array(padded[0] * padded[1] * padded[2]);
      for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
        if (solid(x, y, z)) {
          voxels[voxelIndex(x, y, z, size)] = 1;
          occupancy[voxelIndex(x + 1, y + 1, z + 1, padded)] = 1;
        }
      }
      const expected = new Uint8Array(occupancy.length);
      for (let z = 0; z < padded[2]; z++) for (let x = 0; x < padded[0]; x++) {
        expected[voxelIndex(x, padded[1] - 1, z, padded)] = 15;
      }
      floodLight(padded, occupancy, expected, true);
      const actual = computeAssetSky({ id: `fixture-${shapeIndex}`, revision: 1, lattice: 'build', size, voxels }, [stone]);
      expect(actual.size).toEqual(padded);
      expect(actual.sky, `sky mismatch for deterministic shape ${shapeIndex}`).toEqual(expected);
    }
  });

  it('prepares a partial edge chunk with real neighbour halos and no internal seam faces', () => {
    const size = [34, 1, 1] as const;
    const chunks = prepareAssetChunks({ id: 'beam', revision: 5, lattice: 'build', size,
      voxels: new Uint16Array(34).fill(1) }, [stone], 2);
    expect(chunks.map((chunk) => chunk.coordinate)).toEqual([[0, 0, 0], [1, 0, 0]]);
    const first = chunks[0]!, second = chunks[1]!;
    expect(first.halo[haloIndex(32, 0, 0)]).toBe(1);
    expect(second.halo[haloIndex(-1, 0, 0)]).toBe(1);
    expect(second.halo[haloIndex(2, 0, 0)]).toBe(0);
    const faces = (chunk: typeof first) => {
      const mesh = meshVoxelChunk(chunk);
      return Array.from({ length: mesh.vertices.length / 2 }, (_, i) =>
        unpackVoxelVertex(mesh.vertices[2 * i]!, mesh.vertices[2 * i + 1]!).face);
    };
    expect(faces(first)).not.toContain(0);
    expect(faces(second)).not.toContain(1);
    expect(faces(second)).toContain(0);
  });

  it('returns transferable output buffers and echoes the job and asset revisions', () => {
    const result = executeVoxelJob({ id: 72, kind: 'blueprint', blueprint, revision: 9,
      materials: [stone], materialRevision: 4 });
    expect(result.kind).toBe('asset');
    if (result.kind !== 'asset') throw new Error('Expected an asset result.');
    expect(result.id).toBe(72);
    expect(result.assetId).toBe('lit-home');
    expect(result.revision).toBe(9);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]!.mesh.stamp.materialRevision).toBe(4);
    expect(resultTransferables(result)).toEqual(result.chunks.flatMap(({ mesh }) => [mesh.vertices.buffer, mesh.indices.buffer]));
    expect(() => executeVoxelJob({ id: 73, kind: 'asset', materials: [stone], materialRevision: 4,
      asset: { id: 'broken', revision: 1, lattice: 'build', size: [1, 1, 1], voxels: new Uint16Array(2) } })).toThrow(/dimensions/);
  });
});

describe('eight-byte voxel vertex', () => {
  it.each([0, 1, 2, 3, 4, 5])('round-trips face %i with maximum fields', (face) => {
    const vertex = { x: 32, y: 31, z: 0, face, ao: 3, sky: 15, material: 65535 };
    const packed = new Uint32Array(packVoxelVertex(vertex));
    expect(packed.byteLength).toBe(8);
    expect(unpackVoxelVertex(packed[0]!, packed[1]!)).toEqual(vertex);
    expect(packed[0]! >>> 27).toBe(0);
    expect(packed[1]! >>> 16).toBe(0);
  });

  it('rejects values that overlap fields or identify air as geometry', () => {
    const vertex = { x: 0, y: 0, z: 0, face: 0, ao: 0, sky: 0, material: 1 };
    for (const patch of [{ x: 33 }, { y: -1 }, { z: 0.5 }, { face: 6 }, { ao: 4 },
      { sky: 16 }, { material: 0 }, { material: 65536 }]) {
      expect(() => packVoxelVertex({ ...vertex, ...patch })).toThrow();
    }
  });
});

describe('greedy chunk meshing', () => {
  const stone: VoxelMaterial = { id: 1, name: 'stone', solid: true, occludesFaces: true,
    occludesAo: true, blocksLight: true, colour: '#666666', surface: 'stone' };
  const stamp: MeshStamp = { key: 'world:0:0:0', revision: 1, materialRevision: 1,
    dependencies: [{ key: 'world:1:0:0', revision: 4 }] };
  const create = () => ({ stamp, halo: new Uint16Array(HALO_VOLUME),
    sky: new Uint8Array(HALO_VOLUME).fill(15), materials: [stone] });

  it('meshes a solid 2×2×2 cube into six outward-facing quads', () => {
    const request = create();
    for (let x = 1; x < 3; x++) for (let y = 1; y < 3; y++) for (let z = 1; z < 3; z++) {
      request.halo[haloIndex(x, y, z)] = 1;
    }
    const mesh = meshVoxelChunk(request);
    expect(mesh.quadCount).toBe(6);
    expect(mesh.vertices.byteLength).toBe(6 * 4 * 8);
    expect(mesh.indices).toHaveLength(36);
    expect(mesh.bounds).toEqual({ min: [1, 1, 1], max: [3, 3, 3] });
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const vertices = [0, 1, 2].map((j) => {
        const vertex = mesh.indices[i + j]! * 2;
        return unpackVoxelVertex(mesh.vertices[vertex]!, mesh.vertices[vertex + 1]!);
      });
      const a = vertices[0]!, b = vertices[1]!, c = vertices[2]!;
      const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
      const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
      const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!];
      const axis = a.face >> 1;
      expect(cross[axis]! * (a.face % 2 === 0 ? 1 : -1)).toBeGreaterThan(0);
      expect(a.ao).toBe(3);
      expect(a.sky).toBe(15);
    }
  });

  it('culls a face against a real neighbour in the halo, then restores it after removal', () => {
    const request = create();
    request.halo[haloIndex(31, 8, 8)] = 1;
    request.halo[haloIndex(32, 8, 8)] = 1;
    const blocked = meshVoxelChunk(request);
    expect(blocked.quadCount).toBe(5);
    const faces = Array.from({ length: blocked.vertices.length / 2 }, (_, i) =>
      unpackVoxelVertex(blocked.vertices[2 * i]!, blocked.vertices[2 * i + 1]!).face);
    expect(faces).not.toContain(0);
    request.halo[haloIndex(32, 8, 8)] = 0;
    expect(meshVoxelChunk(request).quadCount).toBe(6);
  });

  it('bakes the double-side corner occlusion and respects material IDs', () => {
    const request = create();
    request.halo[haloIndex(1, 1, 1)] = 1;
    request.halo[haloIndex(2, 0, 1)] = 1;
    request.halo[haloIndex(2, 1, 0)] = 1;
    const mesh = meshVoxelChunk(request);
    const corners = Array.from({ length: mesh.vertices.length / 2 }, (_, i) =>
      unpackVoxelVertex(mesh.vertices[2 * i]!, mesh.vertices[2 * i + 1]!));
    expect(corners).toContainEqual({ x: 2, y: 1, z: 1, face: 0, ao: 0, sky: 15, material: 1 });
    expect(corners.some((corner) => corner.face === 0 && corner.ao === 3)).toBe(true);
    request.halo[haloIndex(0, 0, 0)] = 2;
    expect(() => meshVoxelChunk(request)).toThrow(/Unknown voxel material/);
  });

  it('rejects stale neighbours, absent neighbours, registry changes and duplicate dependency keys', () => {
    expect(sameMeshStamp(stamp, { ...stamp, dependencies: [{ key: 'world:1:0:0', revision: 4 }] })).toBe(true);
    expect(sameMeshStamp(stamp, { ...stamp, revision: 2 })).toBe(false);
    expect(sameMeshStamp(stamp, { ...stamp, materialRevision: 2 })).toBe(false);
    expect(sameMeshStamp(stamp, { ...stamp, dependencies: [{ key: 'world:1:0:0', revision: null }] })).toBe(false);
    expect(sameMeshStamp(stamp, { ...stamp, dependencies: [{ key: 'world:1:0:0', revision: 5 }] })).toBe(false);
    const duplicate = { ...stamp, dependencies: [...stamp.dependencies, ...stamp.dependencies] };
    expect(sameMeshStamp(duplicate, duplicate)).toBe(false);
    expect(() => meshVoxelChunk({ ...create(), stamp: { ...stamp,
      dependencies: [{ key: 'world:1:0:0', revision: null }] } })).toThrow(/unavailable neighbours/);
  });

  it.each([
    ['U', (x: number) => 2 * x - 2],
    ['V', (_x: number, z: number) => 2 * z - 2],
    ['both', (x: number, z: number) => x + z - 4],
  ] as const)('preserves each original face-corner shade when light varies along %s', (variation, skyValue) => {
    const other: VoxelMaterial = { ...stone, id: 2, name: 'alternate-stone' };
    const merged = { ...create(), materials: [stone, other] };
    const oracle = { ...create(), materials: [stone, other] };
    for (let z = -1; z <= 32; z++) for (let x = -1; x <= 32; x++) {
      merged.sky[haloIndex(x, 2, z)] = Math.max(0, Math.min(15, skyValue(x, z)));
      oracle.sky[haloIndex(x, 2, z)] = merged.sky[haloIndex(x, 2, z)]!;
    }
    for (let z = 4; z < 8; z++) for (let x = 4; x < 8; x++) {
      merged.halo[haloIndex(x, 1, z)] = 1;
      // Checkerboard material IDs prevent every merge while preserving identical occlusion.
      oracle.halo[haloIndex(x, 1, z)] = (x + z) % 2 + 1;
    }
    const topQuads = (mesh: VoxelChunkMesh) => {
      const quads = [];
      for (let i = 0; i < mesh.vertices.length; i += 8) {
        const vertices = [0, 1, 2, 3].map((corner) =>
          unpackVoxelVertex(mesh.vertices[i + corner * 2]!, mesh.vertices[i + corner * 2 + 1]!));
        if (vertices[0]!.face === 2 && vertices[0]!.y === 2) quads.push(vertices);
      }
      return quads;
    };
    const actual = topQuads(meshVoxelChunk(merged));
    const units = topQuads(meshVoxelChunk(oracle));
    expect(units).toHaveLength(16);
    if (variation === 'U') {
      expect(actual.some((quad) => quad[1]!.z - quad[0]!.z > 1)).toBe(true);
      expect(actual.every((quad) => quad[3]!.x - quad[0]!.x === 1)).toBe(true);
    } else if (variation === 'V') {
      expect(actual.some((quad) => quad[3]!.x - quad[0]!.x > 1)).toBe(true);
      expect(actual.every((quad) => quad[1]!.z - quad[0]!.z === 1)).toBe(true);
    } else {
      expect(actual).toHaveLength(16);
    }
    for (const unit of units) {
      const owner = actual.find((quad) => unit[0]!.z >= quad[0]!.z && unit[1]!.z <= quad[1]!.z
        && unit[0]!.x >= quad[0]!.x && unit[3]!.x <= quad[3]!.x);
      expect(owner).toBeDefined();
      for (const corner of unit) {
        const quad = owner!;
        const u = (corner.z - quad[0]!.z) / (quad[1]!.z - quad[0]!.z);
        const v = (corner.x - quad[0]!.x) / (quad[3]!.x - quad[0]!.x);
        const interpolate = (field: 'ao' | 'sky') =>
          quad[0]![field] * (1 - u) * (1 - v) + quad[1]![field] * u * (1 - v)
          + quad[2]![field] * u * v + quad[3]![field] * (1 - u) * v;
        expect(interpolate('ao')).toBeCloseTo(corner.ao, 10);
        expect(interpolate('sky')).toBeCloseTo(corner.sky, 10);
      }
    }
  });
});

describe('local light field', () => {
  const spec: LightVolumeSpec = { revision: 1, origin: [0, 0, 0], size: [9, 3, 3], cellSize: 0.5 };
  const source: LightEmitter = { position: [0.75, 0.75, 0.75], level: 15 };
  const lit = (emitters: readonly LightEmitter[], occupancy: Uint8Array = new Uint8Array(9 * 3 * 3)) =>
    buildLightVolume({ ...spec, occupancy, emitters });

  it('keeps a thin 0.125 m wall opaque to a 0.5 m light grid', () => {
    const wall = rasterizeLightOccluders(spec, [{ min: [2, 0, 0], max: [2.125, 1.5, 1.5] }]);
    expect(wall[voxelIndex(4, 1, 1, spec.size)]).toBe(1);
    expect(wall[voxelIndex(5, 1, 1, spec.size)]).toBe(0);
    const open = lit([source]);
    const blocked = lit([source], wall);
    expect(sampleLightVolume(open, [3.25, 0.75, 0.75])).toBeGreaterThan(0);
    expect(sampleLightVolume(blocked, [3.25, 0.75, 0.75])).toBe(0);
    expect(sampleLightVolume(blocked, source.position)).toBe(15);
  });

  it('removes only the extinguished source and preserves an overlapping source', () => {
    const other: LightEmitter = { position: [3.75, 0.75, 0.75], level: 9 };
    const both = lit([source, other]);
    const remaining = lit([other]);
    const none = lit([]);
    expect(sampleLightVolume(both, source.position)).toBe(15);
    expect(sampleLightVolume(remaining, source.position)).toBe(3);
    expect(sampleLightVolume(remaining, other.position)).toBe(9);
    expect([...none.light].every((level) => level === 0)).toBe(true);
    expect([...lit([other, source]).light]).toEqual([...both.light]);
    expect([...lit([source, source]).light]).toEqual([...lit([source]).light]);
  });

  it('matches the maximum unobstructed path from each emitter around a doorway', () => {
    const room = { revision: 1, origin: [0, 0, 0], size: [7, 4, 5], cellSize: 1 } as const;
    const occupancy = new Uint8Array(7 * 4 * 5);
    for (let y = 0; y < 4; y++) for (let z = 0; z < 5; z++) {
      if (y !== 1 || z !== 2) occupancy[voxelIndex(3, y, z, room.size)] = 1;
    }
    const emitters: LightEmitter[] = [
      { position: [1.5, 1.5, 1.5], level: 15 },
      { position: [5.5, 2.5, 3.5], level: 9 },
    ];
    const actual = buildLightVolume({ ...room, occupancy, emitters });
    // Independent per-source shortest-path distances; sources combine by maximum, never addition.
    const expected = new Uint8Array(occupancy.length);
    for (const emitter of emitters) {
      const initial = emitter.position.map(Math.floor) as [number, number, number];
      const queue: Array<[number, number, number, number]> = [[...initial, 0]];
      const visited = new Set<string>();
      for (let head = 0; head < queue.length; head++) {
        const [x, y, z, distance] = queue[head]!;
        const key = `${x},${y},${z}`;
        if (visited.has(key) || distance >= emitter.level || x < 0 || y < 0 || z < 0
          || x >= room.size[0] || y >= room.size[1] || z >= room.size[2]
          || occupancy[voxelIndex(x, y, z, room.size)]) continue;
        visited.add(key);
        const index = voxelIndex(x, y, z, room.size);
        expected[index] = Math.max(expected[index]!, emitter.level - distance);
        queue.push([x + 1, y, z, distance + 1], [x - 1, y, z, distance + 1],
          [x, y + 1, z, distance + 1], [x, y - 1, z, distance + 1],
          [x, y, z + 1, distance + 1], [x, y, z - 1, distance + 1]);
      }
    }
    expect(actual.light).toEqual(expected);
    expect(actual.light[voxelIndex(3, 1, 2, room.size)]).toBeGreaterThan(0);
    expect(actual.light[voxelIndex(3, 1, 1, room.size)]).toBe(0);
  });

  it('carries a full skylight beam down but decays sideways', () => {
    const size = [3, 4, 1] as const;
    const occupancy = new Uint8Array(12);
    const levels = new Uint8Array(12);
    levels[voxelIndex(1, 3, 0, size)] = 15;
    floodLight(size, occupancy, levels, true);
    expect(levels[voxelIndex(1, 0, 0, size)]).toBe(15);
    expect(levels[voxelIndex(0, 0, 0, size)]).toBe(14);
    occupancy[voxelIndex(1, 2, 0, size)] = 1;
    const underRoof = new Uint8Array(12);
    underRoof[voxelIndex(1, 3, 0, size)] = 15;
    floodLight(size, occupancy, underRoof, true);
    expect(underRoof[voxelIndex(1, 2, 0, size)]).toBe(0);
    expect(underRoof[voxelIndex(1, 1, 0, size)]).toBeLessThan(15);
  });

  it('enforces volume bounds and peak memory at the supported maximum', () => {
    const size = [128, 32, 128] as const;
    const maximum = buildLightVolume({ revision: 2, origin: [0, 0, 0], cellSize: 0.5, size,
      occupancy: new Uint8Array(size[0] * size[1] * size[2]), emitters: [] });
    expect(maximum.light.byteLength).toBe(524_288);
    expect(maximum.estimatedPeakBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(() => buildLightVolume({ revision: 2, origin: [0, 0, 0], cellSize: 0.5,
      size: [128, 64, 128], occupancy: new Uint8Array(0), emitters: [] })).toThrow(/budget/);
    expect(() => lit([{ position: [0, 0, 0], level: 16 }])).toThrow(/emitter/);
    expect(() => lit([], new Uint8Array(1))).toThrow(/occupancy/);
    expect(sampleLightVolume(lit([source]), [-0.01, 0, 0])).toBe(0);
  });
});

describe('worker scheduling and stale results', () => {
  class FakeWorker implements VoxelWorkerAdapter {
    onmessage: ((event: MessageEvent<VoxelWorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    jobs: VoxelJob[] = [];
    terminated = false;
    postMessage(job: VoxelJob) { this.jobs.push(job); }
    terminate() { this.terminated = true; }
    reply(response: VoxelWorkerResponse) {
      this.onmessage?.({ data: response } as MessageEvent<VoxelWorkerResponse>);
    }
  }
  const input = (revision: number) => ({ kind: 'light' as const,
    request: { revision, origin: [0, 0, 0] as const, size: [1, 1, 1] as const,
      cellSize: 1, occupancy: new Uint8Array(1), emitters: [] } });

  it('supersedes an active job, ignores old and wrong IDs and runs the newer revision', async () => {
    const workers: FakeWorker[] = [];
    const pool = new VoxelWorkerPool({ size: 1, maxQueue: 1, createWorker: () => {
      const worker = new FakeWorker(); workers.push(worker); return worker;
    } });
    const first = pool.submit(input(1), { key: 'light' });
    const second = pool.submit(input(2), { key: 'light' });
    expect(await first).toBeNull();
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(pool.stats).toMatchObject({ busy: 1, queued: 0 });
    const firstResult = executeVoxelJob(workers[0]!.jobs[0]!);
    workers[0]!.reply(firstResult);
    workers[1]!.reply({ ...firstResult, id: 999 });
    expect(pool.stats).toMatchObject({ busy: 1, queued: 0 });
    const secondResult = executeVoxelJob(workers[1]!.jobs[0]!);
    workers[1]!.reply(secondResult);
    expect(await second).toEqual(secondResult);
    expect(pool.stats).toMatchObject({ busy: 0, queued: 0 });
    pool.dispose();
    expect(workers[1]!.terminated).toBe(true);
  });

  it('never installs results rejected by a current-neighbour check or incorrect revision', async () => {
    const worker = new FakeWorker();
    const pool = new VoxelWorkerPool({ size: 1, createWorker: () => worker });
    const stale = pool.submit(input(5), { isCurrent: () => false });
    worker.reply(executeVoxelJob(worker.jobs[0]!));
    expect(await stale).toBeNull();
    const incorrect = pool.submit(input(6));
    const result = executeVoxelJob(worker.jobs[1]!);
    if (result.kind !== 'light') throw new Error('Expected a light result.');
    worker.reply({ ...result, volume: { ...result.volume, revision: 5 } });
    await expect(incorrect).rejects.toThrow(/incompatible job metadata/);
    pool.dispose();
  });

  it('bounds its queue and settles in-flight and waiting promises on disposal', async () => {
    const worker = new FakeWorker();
    const pool = new VoxelWorkerPool({ size: 1, maxQueue: 1, createWorker: () => worker });
    const active = pool.submit(input(1));
    const waiting = pool.submit(input(2));
    await expect(pool.submit(input(3))).rejects.toThrow(/queue is full/);
    const activeRejected = expect(active).rejects.toThrow(/disposed/);
    const waitingRejected = expect(waiting).rejects.toThrow(/disposed/);
    pool.dispose();
    await Promise.all([activeRejected, waitingRejected]);
    await expect(pool.submit(input(4))).rejects.toThrow(/disposed/);
    expect(worker.terminated).toBe(true);
  });

  it('replaces a failed worker and continues the waiting job without losing its promise', async () => {
    const workers: FakeWorker[] = [];
    const pool = new VoxelWorkerPool({ size: 1, maxQueue: 1, createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    } });
    const failing = pool.submit(input(1));
    const rejected = expect(failing).rejects.toThrow('worker crashed');
    const queued = pool.submit(input(2));
    workers[0]!.onerror?.({ message: 'worker crashed', preventDefault() {} } as ErrorEvent);
    await rejected;
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.jobs).toHaveLength(1);
    const result = executeVoxelJob(workers[1]!.jobs[0]!);
    workers[1]!.reply(result);
    expect(await queued).toEqual(result);
    pool.dispose();
  });
});
