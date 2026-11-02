import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_QUADS, createTerrainChunk, MAX_RUNS, quadPlane, RUN_ORDER, runOrdered, visibleRuns } from './terrain-runs';

/** One packed quad: face bits, cell inside its 32³ chunk, chunk slot; the low 16 bits of the second word tag it. */
function quad(face: number, x: number, y: number, z: number, tag: number): [number, number] {
  const slot = (x >> 5) | ((y >> 5) << 4) | ((z >> 5) << 8);
  return [((face << 25) | ((z & 31) << 10) | ((y & 31) << 5) | (x & 31)) >>> 0, ((slot << 16) | (tag & 0xffff)) >>> 0];
}
/** A baked mesh of `count` quads per face at seeded cells inside a 256-cell region, in baked face order. */
function baked(counts: readonly number[], seed = 1) {
  let state = seed;
  const random = (n: number) => { state = (state * 1103515245 + 12345) >>> 0; return state % n; };
  const words: number[] = [], offsets = [0];
  let tag = 0;
  counts.forEach((count, face) => {
    for (let i = 0; i < count; i++) words.push(...quad(face, random(256), 32 + random(64), random(256), tag++));
    offsets.push(offsets.at(-1)! + count);
  });
  return { quads: new Uint32Array(words), offsets: new Int32Array(offsets) };
}
/** Does a quad face the eye: the eye on the front side of its plane (edge-on counts as facing). */
function facing(a: number, b: number, eye: { x: number; y: number; z: number }) {
  const face = (a >>> 25) & 7, plane = quadPlane(a, b), coordinate = [eye.x, eye.y, eye.z][face >> 1]!;
  return face & 1 ? plane >= coordinate : plane <= coordinate;
}
const tags = (quads: Uint32Array, ranges: readonly number[]) => {
  const out: number[] = [];
  for (let i = 0; i < ranges.length; i += 2) for (let q = ranges[i]!; q < ranges[i + 1]!; q++) out.push(quads[q * 2 + 1]! & 0xffff);
  return out.sort((a, b) => a - b);
};

describe('terrain face runs', () => {
  it('reads the plane each face lies on: a positive face on its cell\'s far side', () => {
    expect(quadPlane(...quad(0, 37, 40, 9, 0))).toBe(38);
    expect(quadPlane(...quad(1, 37, 40, 9, 0))).toBe(37);
    expect(quadPlane(...quad(2, 37, 40, 9, 0))).toBe(41);
    expect(quadPlane(...quad(3, 37, 40, 9, 0))).toBe(40);
    expect(quadPlane(...quad(4, 37, 40, 255, 0))).toBe(256);
    expect(quadPlane(...quad(5, 37, 40, 255, 0))).toBe(255);
  });

  it('keeps every quad when reordering, each face sorted by plane', () => {
    const { quads, offsets } = baked([40, 30, 50, 20, 35, 25]), order = runOrdered(quads, offsets);
    expect(tags(order.quads, [0, order.starts[6]!])).toEqual(tags(quads, [0, quads.length / 2]));
    RUN_ORDER.forEach((face, position) => {
      const from = order.starts[position]!, to = order.starts[position + 1]!;
      expect(to - from).toBe(offsets[face + 1]! - offsets[face]!);
      const planes: number[] = [];
      for (let q = from; q < to; q++) { expect((order.quads[q * 2]! >>> 25) & 7).toBe(face); planes.push(quadPlane(order.quads[q * 2]!, order.quads[q * 2 + 1]!)); }
      const sorted = [...planes].sort((a, b) => a - b);
      expect(planes.join() === sorted.join() || planes.join() === [...sorted].reverse().join()).toBe(true);
      expect(order.ends[position]!.at(-1) ?? from).toBe(to);
    });
  });

  it('submits exactly the quads that face the eye, in at most three ranges, from anywhere', () => {
    const { quads, offsets } = baked([60, 45, 80, 30, 55, 40], 7), order = runOrdered(quads, offsets);
    let state = 99;
    const random = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 2 ** 32; };
    const eyes = [{ x: 128, y: 400, z: 128 }, { x: -50, y: 400, z: 300 }, { x: 37.5, y: 60, z: 200 }, { x: 0, y: 32, z: 256 }];
    for (let i = 0; i < 400; i++) eyes.push({ x: random() * 400 - 70, y: random() * 160, z: random() * 400 - 70 });
    for (const eye of eyes) {
      const ranges = visibleRuns(order, eye);
      expect(ranges.length / 2).toBeLessThanOrEqual(MAX_RUNS);
      for (let i = 2; i < ranges.length; i += 2) expect(ranges[i]!).toBeGreaterThan(ranges[i - 1]!);
      const expected: number[] = [];
      for (let q = 0; q < quads.length / 2; q++) if (facing(quads[q * 2]!, quads[q * 2 + 1]!, eye)) expected.push(quads[q * 2 + 1]! & 0xffff);
      expect(tags(order.quads, ranges)).toEqual(expected.sort((a, b) => a - b));
    }
  });

  it('draws one or two ranges for a camera above and outside a region on both axes', () => {
    const { quads, offsets } = baked([20, 20, 20, 20, 20, 20], 3), order = runOrdered(quads, offsets);
    const draws = [[300, 300], [-5, -5], [300, -5], [-5, 300]].map(([x, z]) => visibleRuns(order, { x: x!, y: 400, z: z! }).length / 2);
    expect(draws).toEqual([1, 1, 2, 2]);
    // Inside the region on one axis, the in-line faces are cut at the eye's plane and still join their pair.
    const inLine = visibleRuns(order, { x: 300, y: 400, z: 128 });
    expect(inLine.length / 2).toBeLessThanOrEqual(2);
    expect(inLine.reduce((n, v, i) => n + (i & 1 ? v : -v), 0)).toBeLessThan(order.starts[6]! - 40);
  });

  it('shares one buffer per chunk and draws each range from its own offset', () => {
    const { quads, offsets } = baked([3, 3, 3, 3, 3, 3]), order = runOrdered(quads, offsets);
    const box = new THREE.Box3(new THREE.Vector3(0, 32, 0), new THREE.Vector3(256, 96, 256));
    const material = new THREE.ShaderMaterial(), bound: THREE.Mesh[] = [];
    // A second chunk over the last 8 quads: its offsets are relative to its own buffer.
    const chunk = createTerrainChunk(order.quads, 10, 18, box, material, mesh => bound.push(mesh));
    expect(bound).toHaveLength(MAX_RUNS + 1);
    expect(chunk.showAll()).toBe(8);
    expect(chunk.runs.filter(run => run.visible)).toHaveLength(1);
    // Ranges outside the chunk are clipped away; a range crossing it starts at the chunk's own quad 2 (word 4).
    expect(chunk.show([0, 4, 12, 15])).toBe(3);
    const shown = chunk.runs.filter(run => run.visible).map(run => run.geometry as THREE.InstancedBufferGeometry);
    expect(shown).toHaveLength(1);
    const attribute = shown[0]!.getAttribute('aQuad') as THREE.InterleavedBufferAttribute;
    expect(attribute.offset).toBe(4); expect(shown[0]!.instanceCount).toBe(3);
    expect(chunk.show([10, 11, 12, 13, 17, 30])).toBe(3);
    expect(chunk.runs.filter(run => run.visible)).toHaveLength(3);
    const buffers = new Set(chunk.runs.concat(chunk.whole).map(run => (run.geometry.getAttribute('aQuad') as THREE.InterleavedBufferAttribute).data));
    expect(buffers.size).toBe(1);
    expect(chunk.whole.visible).toBe(false);
    expect((chunk.whole.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(8);
    chunk.hide(); expect(chunk.runs.some(run => run.visible)).toBe(false);
    chunk.dispose();
  });

  it('holds at most 1 MiB of quads in a chunk', () => {
    expect(CHUNK_QUADS * 8).toBe(1024 * 1024);
  });
});
