import * as THREE from 'three';

/**
 * Packing a baked region's quads for drawing (GW12). A baked mesh stores its quads by face, +X,-X,+Y,-Y,+Z,-Z.
 * A quad faces an eye only when the eye is on its front side of the quad's plane: a +X face on plane p needs
 * eye.x > p. 62% of the grand land's quads are side faces, and for every camera roughly half of them face away.
 *
 * The faces are copied once into run order, and inside each face sorted by plane, one GPU buffer per chunk. For
 * any eye, the quads of a face that can face it are then a contiguous prefix or suffix of that face's run (a
 * binary search over its planes), and faces are paired so that the first face's part always ends where the second
 * face's part begins: every pass draws at most three ranges per chunk, each one instanced draw over a range of the
 * shared buffer (an attribute offset, so no data is duplicated). The GPU's own back-face culling already discarded
 * every skipped triangle; this only stops submitting them, with exactly the same picture.
 */
export const RUN_ORDER = [4, 0, 2, 1, 5, 3] as const;
/**
 * Where a face's visible part sits in its run: at the end (true) or the start (false). Pairs (0,1), (2,3), (4,5)
 * meet end to start, so a pair is always one range; and a whole face joins both its neighbours, so a camera
 * outside a region on both horizontal axes still draws one or two ranges.
 */
const AT_END = [true, false, true, false, true, false] as const;
/** One GPU buffer holds at most 1 MiB of packed quads (the laptop install budget per frame). */
export const CHUNK_QUADS = 131072;
/** A pass draws at most three ranges of a chunk. */
export const MAX_RUNS = 3;
/** Faces within this many cells of being edge-on stay drawn (the test is conservative, never lossy). */
const EDGE = 1e-3;

const CORNERS = new Float32Array(12);
const INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);

/** The extent a region's quads occupy in its own cells: x and z within [0, span], y within [minY, maxY]. */
export interface RegionCells { readonly span: number; readonly minY: number; readonly maxY: number }

/** A baked mesh's quads in run order, with the planes of each face run for selecting what faces an eye. */
export interface RunOrder {
  readonly quads: Uint32Array;
  /** Seven cumulative quad offsets, one run per RUN_ORDER position. */
  readonly starts: Int32Array;
  /** Per position: the distinct plane coordinates in the order they appear in the run. */
  readonly planes: readonly Int32Array[];
  /** Per position: the end (exclusive quad index) of each plane's group. */
  readonly ends: readonly Int32Array[];
}

/** The plane coordinate, in the region's cells, a quad lies on (a positive face lies on its cell's far side). */
export function quadPlane(a: number, b: number): number {
  const face = (a >>> 25) & 7, axis = face >> 1, slot = b >>> 16;
  const cell = axis === 0 ? a & 31 : axis === 1 ? (a >>> 5) & 31 : (a >>> 10) & 31;
  const chunk = axis === 0 ? slot & 15 : axis === 1 ? (slot >>> 4) & 15 : (slot >>> 8) & 15;
  return chunk * 32 + cell + (face & 1 ? 0 : 1);
}

/** Copy a baked mesh's quads into run order, each face sorted by plane. `offsets` are the 7 baked face offsets. */
export function runOrdered(quads: Uint32Array, offsets: ArrayLike<number>): RunOrder {
  const ordered = new Uint32Array(quads.length), starts = new Int32Array(RUN_ORDER.length + 1);
  const planes: Int32Array[] = [], ends: Int32Array[] = [];
  let at = 0;
  RUN_ORDER.forEach((face, position) => {
    starts[position] = at;
    const from = offsets[face]!, to = offsets[face + 1]!;
    let low = Infinity, high = -Infinity;
    for (let q = from; q < to; q++) { const plane = quadPlane(quads[q * 2]!, quads[q * 2 + 1]!); if (plane < low) low = plane; if (plane > high) high = plane; }
    if (to === from) { planes.push(new Int32Array(0)); ends.push(new Int32Array(0)); return; }
    // A counting sort by plane, ascending or descending so the part facing any eye sits at the chosen end.
    const positive = (face & 1) === 0, ascending = positive !== AT_END[position];
    const counts = new Int32Array(high - low + 1);
    for (let q = from; q < to; q++) counts[quadPlane(quads[q * 2]!, quads[q * 2 + 1]!) - low]!++;
    const used: number[] = [], groupEnds: number[] = [], cursor = new Int32Array(counts.length);
    let next = at;
    for (let k = 0; k < counts.length; k++) {
      const bucket = ascending ? k : counts.length - 1 - k;
      if (!counts[bucket]) continue;
      cursor[bucket] = next; next += counts[bucket]!;
      used.push(bucket + low); groupEnds.push(next);
    }
    for (let q = from; q < to; q++) {
      const target = cursor[quadPlane(quads[q * 2]!, quads[q * 2 + 1]!) - low]!++;
      ordered[target * 2] = quads[q * 2]!; ordered[target * 2 + 1] = quads[q * 2 + 1]!;
    }
    planes.push(Int32Array.from(used)); ends.push(Int32Array.from(groupEnds));
    at = next;
  });
  starts[RUN_ORDER.length] = at;
  return { quads: ordered, starts, planes, ends };
}

/**
 * Quad ranges [start, end) of a run order that can face an eye given in the region's cells, merged where they
 * touch. At most three ranges; an eye exactly on a plane keeps that plane's faces (edge-on, harmless).
 */
export function visibleRuns(order: Pick<RunOrder, 'starts' | 'planes' | 'ends'>, eye: { readonly x: number; readonly y: number; readonly z: number }, out: number[] = []): number[] {
  out.length = 0;
  RUN_ORDER.forEach((face, position) => {
    const start = order.starts[position]!, end = order.starts[position + 1]!;
    if (end === start) return;
    const planes = order.planes[position]!, ends = order.ends[position]!, count = planes.length;
    const coordinate = face < 2 ? eye.x : face < 4 ? eye.y : eye.z;
    const positive = (face & 1) === 0;
    const faces = (plane: number) => positive ? plane < coordinate + EDGE : plane > coordinate - EDGE;
    // Planes facing the eye form a prefix (visible part at the start) or a suffix (at the end) of the groups.
    let from = start, to = start;
    if (AT_END[position]) {
      let low = 0, high = count; // first facing group: everything from it to the end faces the eye
      while (low < high) { const mid = (low + high) >> 1; if (faces(planes[mid]!)) high = mid; else low = mid + 1; }
      from = low === 0 ? start : ends[low - 1]!; to = end;
      if (low === count) from = to = end;
    } else {
      let low = 0, high = count; // first group that does not face the eye
      while (low < high) { const mid = (low + high) >> 1; if (faces(planes[mid]!)) low = mid + 1; else high = mid; }
      to = low === 0 ? start : ends[low - 1]!;
    }
    if (to <= from) return;
    if (out.length && out[out.length - 1] === from) out[out.length - 1] = to;
    else out.push(from, to);
  });
  return out;
}

/** One GPU buffer of a region mesh: its run meshes for drawing and one whole mesh for the shadow owner. */
export interface TerrainChunk {
  /** The run-order quads [from, to) this chunk's buffer holds. */
  readonly from: number;
  readonly to: number;
  /** Drawn by passes; each shows one range, or is hidden. */
  readonly runs: readonly THREE.Mesh[];
  /** Every face, never drawn by the scene itself: the shadow owner's caster copies it (casters are two-sided). */
  readonly whole: THREE.Mesh;
  /** Show the parts of run-order ranges (from visibleRuns) inside this chunk; returns the quads submitted. */
  show(ranges: readonly number[]): number;
  /** Show every quad. */
  showAll(): number;
  hide(): void;
  dispose(): void;
}

/**
 * Build one chunk over [from, to) of a run-ordered quad array. `bounds` are the region's cells (local units),
 * used for the three.js frustum culling of every run.
 */
export function createTerrainChunk(quads: Uint32Array, from: number, to: number,
  bounds: THREE.Box3, material: THREE.Material, bind?: (mesh: THREE.Mesh) => void): TerrainChunk {
  const buffer = new THREE.InstancedInterleavedBuffer(quads.subarray(from * 2, to * 2), 2, 1);
  // three releases a geometry's attributes (and their GPU buffers) when it is disposed, so attributes are shared
  // only inside this chunk, whose geometries are always disposed together.
  const corners = new THREE.BufferAttribute(CORNERS, 3), index = new THREE.BufferAttribute(INDEX, 1);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  // Range geometries are made once per distinct range and kept: a camera moving through a region revisits them.
  const geometries = new Map<number, THREE.InstancedBufferGeometry>();
  function geometry(start: number, end: number): THREE.InstancedBufferGeometry {
    const key = start * (CHUNK_QUADS + 1) + end;
    let made = geometries.get(key);
    if (!made) {
      made = new THREE.InstancedBufferGeometry();
      made.setAttribute('position', corners); made.setIndex(index);
      // One GPU buffer per chunk: an offset attribute view starts the draw at quad `start` (stride 2 words).
      made.setAttribute('aQuad', new THREE.InterleavedBufferAttribute(buffer, 2, start * 2));
      made.instanceCount = end - start;
      made.boundingBox = bounds.clone(); made.boundingSphere = sphere.clone();
      geometries.set(key, made);
    }
    return made;
  }
  const mesh = (made: THREE.InstancedBufferGeometry) => {
    const item = new THREE.Mesh(made, material);
    item.matrixAutoUpdate = false; item.userData.grandLodFade = 1; bind?.(item);
    return item;
  };
  const whole = mesh(geometry(0, to - from)); whole.visible = false;
  const runs = Array.from({ length: MAX_RUNS }, () => { const item = mesh(geometry(0, to - from)); item.visible = false; return item; });
  const all = [from, to];
  const chunk: TerrainChunk = {
    from, to, runs, whole,
    show(ranges) {
      let used = 0, shown = 0;
      for (let i = 0; i < ranges.length && used < MAX_RUNS; i += 2) {
        const start = Math.max(from, ranges[i]!), end = Math.min(to, ranges[i + 1]!);
        if (end <= start) continue;
        const run = runs[used++]!;
        run.geometry = geometry(start - from, end - from); run.visible = true; shown += end - start;
      }
      for (let i = used; i < MAX_RUNS; i++) runs[i]!.visible = false;
      return shown;
    },
    showAll() { return chunk.show(all); },
    hide() { for (const run of runs) run.visible = false; },
    dispose() {
      // Every geometry of a chunk shares one GPU buffer; dispose them together, never one alone.
      for (const made of geometries.values()) made.dispose();
      geometries.clear();
    },
  };
  return chunk;
}
