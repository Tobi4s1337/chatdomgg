import { describe, expect, it } from 'vitest';
import { unpackQuad } from '../../../../voxel/src/grand/quad-mesher';
import { createInstalledRegionMesher } from './mesher';
import { encodeBakedRegion, decodeBakedRegion } from './codec';
import { HOSTED_PAVING, type BakedRegionMesh } from './types';
import { fixture } from './fixtures.test-helper';
import { originalHostedMesh } from './legacy-mesher.test-helper';

function expectMeshBytes(actual: BakedRegionMesh, expected: BakedRegionMesh) {
  const { quads: a, ...aHeader } = actual, { quads: b, ...bHeader } = expected;
  expect(aHeader).toEqual(bHeader);
  expect(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(true);
}

describe('shared pinned installed mesher', () => {
  it('keeps exact paving and water side faces, removes horizontal water and prohibits physical coarse LODs', () => {
    const prepared = fixture(), { land, seated } = prepared;
    seated.paved[32 + 64 * land.size] = 1;
    // A flowing column above the bed has visible sides; native water owns its top.
    land.water[40 + 70 * land.size] = 12;
    const mesher = createInstalledRegionMesher(prepared), result = mesher.mesh({ rx: 0, rz: 0, level: 0 });
    expectMeshBytes(result, originalHostedMesh(prepared, { rx: 0, rz: 0, level: 0 }));
    expect(() => mesher.mesh({ rx: 0, rz: 0, level: 1 })).toThrow(/half-metre/);
    const quads = Array.from({ length: result.quads.length / 2 }, (_, i) => unpackQuad(result.quads[i * 2]!, result.quads[i * 2 + 1]!));
    expect(quads.some(q => q.face === 2 && q.material === HOSTED_PAVING && q.y === 7)).toBe(true);
    expect(quads.some(q => q.material === 36 && [0, 1, 4, 5].includes(q.face))).toBe(true);
    expect(quads.some(q => q.material === 36 && [2, 3].includes(q.face))).toBe(false);
    expectMeshBytes(decodeBakedRegion(encodeBakedRegion(result)), result);
    expect(Buffer.from(encodeBakedRegion(mesher.mesh({ rx: 0, rz: 0, level: 0 }))).equals(Buffer.from(encodeBakedRegion(result)))).toBe(true);
  });
  it('allows all four levels beyond the installed physical region with encodable skirts and chunk bounds', () => {
    const prepared = fixture(512), mesher = createInstalledRegionMesher(prepared);
    for (let level = 0; level < 4; level++) {
      const result = mesher.mesh({ rx: 1, rz: 1, level });
      expectMeshBytes(result, originalHostedMesh(prepared, { rx: 1, rz: 1, level }));
      expectMeshBytes(decodeBakedRegion(encodeBakedRegion(result)), result);
      expect(result.quads.length).toBeGreaterThan(0);
    }
  });
});
