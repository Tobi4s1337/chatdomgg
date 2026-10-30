import * as THREE from 'three';
import { terrainHeight, type KingdomLayout } from '@chatdom/world';

type Bounds = [minX: number, maxX: number, minZ: number, maxZ: number];
const FAR_EXTENT = 1100;
const CHUNK_METRES = 16;

export interface HorizonSurfaceOptions {
  /** Distant cell size in metres; the detailed-terrain join always remains at 1 m. */
  readonly farStep?: 10 | 20;
}

/**
 * The horizon starts at the worker's actual chunk-aligned footprint. A 1 m collar joins
 * its exact surface to 10 m (default) or 20 m distant triangles. Far tiles beside the collar
 * split their shared edges too, so neither join contains a T-junction or overlapping land.
 * Use this surface's sampleHeight when grounding props: each detail setting has its own
 * actual triangle planes, including the Float32-rounded collar and edge fans.
 */
export function createHorizonSurface(layout: KingdomLayout, { farStep = 10 }: HorizonSurfaceOptions = {}): {
  geometry: THREE.BufferGeometry;
  clipBounds: Bounds;
  /** Contact with the actual detailed, collar or distant triangles; no analytic-height shortcut. */
  sampleHeight(x: number, z: number): number;
} {
  if (farStep !== 10 && farStep !== 20) throw new Error('Horizon distant step must be 10 or 20 metres.');
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) {
    throw new Error('Horizon needs finite, nonempty terrain bounds.');
  }
  const inner: Bounds = [Math.floor(minX / CHUNK_METRES) * CHUNK_METRES,
    Math.ceil(maxX / CHUNK_METRES) * CHUNK_METRES, Math.floor(minZ / CHUNK_METRES) * CHUNK_METRES,
    Math.ceil(maxZ / CHUNK_METRES) * CHUNK_METRES];
  const outer: Bounds = [Math.floor(inner[0] / farStep) * farStep - farStep,
    Math.ceil(inner[1] / farStep) * farStep + farStep, Math.floor(inner[2] / farStep) * farStep - farStep,
    Math.ceil(inner[3] / farStep) * farStep + farStep];
  if (inner[1] - inner[0] > 512 || inner[3] - inner[2] > 512
    || outer[0] <= -FAR_EXTENT || outer[1] >= FAR_EXTENT || outer[2] <= -FAR_EXTENT || outer[3] >= FAR_EXTENT) {
    throw new Error('Terrain exceeds the bounded horizon footprint.');
  }
  const positions: number[] = [], indices: number[] = [], vertexIds = new Map<string, number>();
  const coarseHeights = new Map<string, number>();
  const fanTriangles = new Map<string, number[]>();
  const farHeight = (x: number, z: number): number => {
    const key = `${x},${z}`, cached = coarseHeights.get(key);
    if (cached !== undefined) return cached;
    const d = Math.hypot(x, z - 50);
    const height = Math.fround(terrainHeight(layout, x, z) - 0.55 + Math.max(0, d - 350) * 0.025
      + (Math.sin(x * 0.009) + Math.sin(z * 0.013)) * Math.min(22, Math.max(0, d - 330) * 0.05));
    coarseHeights.set(key, height);
    return height;
  };
  // The original PlaneGeometry uses the 01→10 diagonal, opposite the detailed terrain.
  const farTriangleHeight = (x: number, z: number): number => {
    const ix = Math.floor(x / farStep) * farStep, iz = Math.floor(z / farStep) * farStep;
    const u = (x - ix) / farStep, v = (z - iz) / farStep;
    const a = farHeight(ix, iz), b = farHeight(ix, iz + farStep);
    const c = farHeight(ix + farStep, iz + farStep), d = farHeight(ix + farStep, iz);
    return u + v <= 1 ? a + u * (d - a) + v * (b - a)
      : c + (1 - u) * (b - c) + (1 - v) * (d - c);
  };
  const vertex = (x: number, z: number, height: number): number => {
    const key = `${x},${z}`, existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const id = positions.length / 3;
    positions.push(x, Math.fround(height), z); vertexIds.set(key, id);
    return id;
  };
  for (let z = -FAR_EXTENT; z < FAR_EXTENT; z += farStep) for (let x = -FAR_EXTENT; x < FAR_EXTENT; x += farStep) {
    if (x >= outer[0] && x + farStep <= outer[1] && z >= outer[2] && z + farStep <= outer[3]) continue;
    const corners = [[x, z], [x, z + farStep], [x + farStep, z + farStep], [x + farStep, z]] as const;
    const segments = corners.map(([ax, az], side) => {
      const [bx, bz] = corners[(side + 1) % 4]!;
      const collarEdge = ax === bx
        ? (ax === outer[0] || ax === outer[1]) && Math.min(az, bz) >= outer[2] && Math.max(az, bz) <= outer[3]
        : (az === outer[2] || az === outer[3]) && Math.min(ax, bx) >= outer[0] && Math.max(ax, bx) <= outer[1];
      return collarEdge ? farStep : 1;
    });
    if (segments.every(count => count === 1)) {
      const [a, b, c, d] = corners.map(([cx, cz]) => vertex(cx, cz, farHeight(cx, cz)));
      indices.push(a!, b!, d!, b!, c!, d!);
    } else {
      const boundary: number[] = [];
      for (let side = 0; side < 4; side++) {
        const [ax, az] = corners[side]!, [bx, bz] = corners[(side + 1) % 4]!;
        for (let i = 0; i < segments[side]!; i++) {
          const t = i / segments[side]!, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
          boundary.push(vertex(px, pz, farTriangleHeight(px, pz)));
        }
      }
      // This centre lies on the old diagonal; the fan preserves both original triangle planes.
      const centre = vertex(x + farStep / 2, z + farStep / 2, farTriangleHeight(x + farStep / 2, z + farStep / 2));
      const triangles: number[] = [];
      for (let i = 0; i < boundary.length; i++) triangles.push(centre, boundary[i]!, boundary[(i + 1) % boundary.length]!);
      indices.push(...triangles); fanTriangles.set(`${x},${z}`, triangles);
    }
  }
  const collarHeight = (x: number, z: number): number => {
    const tx = x < inner[0] ? (inner[0] - x) / (inner[0] - outer[0])
      : x > inner[1] ? (x - inner[1]) / (outer[1] - inner[1]) : 0;
    const tz = z < inner[2] ? (inner[2] - z) / (inner[2] - outer[2])
      : z > inner[3] ? (z - inner[3]) / (outer[3] - inner[3]) : 0;
    const t = Math.max(tx, tz), blend = t * t * (3 - 2 * t);
    const near = Math.fround(terrainHeight(layout, x, z));
    return near + (farTriangleHeight(x, z) - near) * blend;
  };
  for (let z = outer[2]; z < outer[3]; z++) for (let x = outer[0]; x < outer[1]; x++) {
    if (x >= inner[0] && x < inner[1] && z >= inner[2] && z < inner[3]) continue;
    const a = vertex(x, z, collarHeight(x, z)), b = vertex(x, z + 1, collarHeight(x, z + 1));
    const c = vertex(x + 1, z + 1, collarHeight(x + 1, z + 1)), d = vertex(x + 1, z, collarHeight(x + 1, z));
    indices.push(a, b, c, a, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  geometry.computeVertexNormals();
  // Exact same central differences as the terrain shader at the shared integer-metre edge.
  const normal = geometry.getAttribute('normal');
  for (let id = 0; id < positions.length / 3; id++) {
    const x = positions[id * 3]!, z = positions[id * 3 + 2]!;
    const shared = ((x === inner[0] || x === inner[1]) && z >= inner[2] && z <= inner[3])
      || ((z === inner[2] || z === inner[3]) && x >= inner[0] && x <= inner[1]);
    if (!shared) continue;
    const nx = (Math.fround(terrainHeight(layout, x - 1, z)) - Math.fround(terrainHeight(layout, x + 1, z))) / 2;
    const nz = (Math.fround(terrainHeight(layout, x, z - 1)) - Math.fround(terrainHeight(layout, x, z + 1))) / 2;
    const length = Math.hypot(nx, 1, nz);
    normal.setXYZ(id, nx / length, 1 / length, nz / length);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const points = geometry.getAttribute('position');
  // Construction touches the entire horizon; runtime contact queries need only a few local corners.
  coarseHeights.clear();
  const sampleHeight = (x: number, z: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > FAR_EXTENT || Math.abs(z) > FAR_EXTENT) {
      throw new Error('Terrain contact is outside the bounded horizon.');
    }
    const detailed = x >= inner[0] && x <= inner[1] && z >= inner[2] && z <= inner[3];
    if (detailed || (x >= outer[0] && x <= outer[1] && z >= outer[2] && z <= outer[3])) {
      const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
      const height = detailed ? (px: number, pz: number): number => Math.fround(terrainHeight(layout, px, pz))
        : (px: number, pz: number): number => Math.fround(collarHeight(px, pz));
      const a = height(ix, iz), b = height(ix, iz + 1), c = height(ix + 1, iz + 1), d = height(ix + 1, iz);
      return u <= v ? a + u * (c - b) + v * (b - a) : a + u * (d - a) + v * (c - d);
    }
    const fan = fanTriangles.get(`${Math.floor(x / farStep) * farStep},${Math.floor(z / farStep) * farStep}`);
    if (fan) {
      // Only collar-adjacent tiles need this lookup: at most farStep + 3 triangles, never a mesh scan.
      // Using actual Float32 vertices also accounts for the centre's sub-ULP rounding.
      for (let i = 0; i < fan.length; i += 3) {
        const a = fan[i]!, b = fan[i + 1]!, c = fan[i + 2]!;
        const ax = points.getX(a), az = points.getZ(a), bx = points.getX(b), bz = points.getZ(b);
        const cx = points.getX(c), cz = points.getZ(c);
        const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / determinant;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / determinant;
        if (u >= -1e-10 && v >= -1e-10 && u + v <= 1 + 1e-10) {
          return u * points.getY(a) + v * points.getY(b) + (1 - u - v) * points.getY(c);
        }
      }
      throw new Error('Terrain contact missed its horizon tile.');
    }
    return farTriangleHeight(x, z);
  };
  return { geometry, clipBounds: inner, sampleHeight };
}
