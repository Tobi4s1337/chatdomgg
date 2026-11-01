import { describe, expect, it } from 'vitest';
import { createQuadBuckets, meshQuadChunk, packQuadBuckets, QUAD_FLAG_AO, QUAD_FLAG_EMIT, QUAD_PAD, unpackQuad } from './quad-mesher';

const at = (x: number, y: number, z: number) => (x + 1) + (y + 1) * QUAD_PAD + (z + 1) * QUAD_PAD * QUAD_PAD;
const SOLID = 1, WATER = 2, HIDDEN = 3;
const flags = new Uint8Array(256);
flags[SOLID] = QUAD_FLAG_EMIT | QUAD_FLAG_AO;
flags[WATER] = QUAD_FLAG_EMIT;
flags[HIDDEN] = 0;

function mesh(fill: (volume: Uint8Array) => void, slot = 0) {
  const volume = new Uint8Array(QUAD_PAD ** 3);
  fill(volume);
  const buckets = createQuadBuckets(4);
  const emitted = meshQuadChunk(volume, flags, slot, buckets);
  const { quads, offsets } = packQuadBuckets(buckets);
  const list = [];
  for (let i = 0; i < quads.length; i += 2) list.push(unpackQuad(quads[i]!, quads[i + 1]!));
  return { emitted, quads: list, offsets };
}

describe('grand quad mesher', () => {
  it('draws one voxel as six unit quads, one per face bucket', () => {
    const { emitted, quads, offsets } = mesh(v => { v[at(4, 5, 6)] = SOLID; }, 0x123);
    expect(emitted).toBe(6);
    expect([...offsets]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    quads.forEach((q, face) => {
      expect(q).toMatchObject({ x: 4, y: 5, z: 6, w: 1, h: 1, face, material: SOLID, slot: 0x123 });
      // A lone voxel has nothing around it: every corner fully lit.
      expect(q.ao).toBe(0xff);
    });
  });

  it('merges a flat slab into one quad per side and grows buckets past their start size', () => {
    const { quads } = mesh(v => { for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) v[at(x, 0, z)] = SOLID; });
    const top = quads.filter(q => q.face === 2);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ w: 32, h: 32 });
    expect(quads.filter(q => q.face === 0 || q.face === 1)).toHaveLength(2);
    expect(quads).toHaveLength(6);
  });

  it('hides faces against any non-air cell, emits none for hidden fill, and keeps water out of AO', () => {
    const { quads } = mesh(v => {
      v[at(10, 10, 10)] = SOLID; v[at(11, 10, 10)] = HIDDEN; v[at(10, 11, 10)] = WATER;
    });
    expect(quads.some(q => q.material === HIDDEN)).toBe(false);
    expect(quads.some(q => q.material === SOLID && q.face === 0)).toBe(false);
    expect(quads.some(q => q.material === SOLID && q.face === 2)).toBe(false);
    // Water sits beside nothing that occludes: its top stays fully lit.
    const waterTop = quads.find(q => q.material === WATER && q.face === 2)!;
    expect(waterTop.ao).toBe(0xff);
  });

  it('darkens the corners of a floor beside a wall and splits differing AO instead of merging', () => {
    const { quads } = mesh(v => {
      for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) v[at(x, 0, z)] = SOLID;
      for (let z = 0; z < 4; z++) v[at(0, 1, z)] = SOLID;
    });
    const floor = quads.filter(q => q.face === 2 && q.y === 0);
    expect(floor.length).toBeGreaterThan(1);
    expect(floor.some(q => q.ao !== 0xff)).toBe(true);
    const cells = floor.reduce((sum, q) => sum + q.w * q.h, 0);
    expect(cells).toBe(12);
  });

  it('ignores the padding shell except for occlusion', () => {
    const { quads } = mesh(v => { v[0] = SOLID; v[at(-1, 0, 0)] = SOLID; v[at(0, 0, 0)] = SOLID; });
    expect(quads.every(q => q.x < 32 && q.y < 32 && q.z < 32)).toBe(true);
    expect(quads.some(q => q.face === 1)).toBe(false);
    expect(quads).toHaveLength(5);
  });
});
