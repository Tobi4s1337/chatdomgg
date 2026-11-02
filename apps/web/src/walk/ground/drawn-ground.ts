import * as THREE from 'three';
import { sampleTerrainTriangles } from '../../kingdom/terrain-worker';

/**
 * Height of the DRAWN ground at (x, z), in world metres: the surface a person sees, not the physical support.
 * `null` where nothing drawn answers (no terrain tile there, the grand land's blocky ground, a seam that does not
 * know). Presentation only: never a camera target, a collision decision or a prediction input.
 */
export type DrawnGroundAt = (x: number, z: number) => number | null;

/** The part of grand-world's `LandSurfaceSample` (SEAMS A2) the walker needs. */
export interface DrawnSurfaceSample { readonly drawnY: number }
export type DrawnSurfaceAt = (x: number, z: number) => DrawnSurfaceSample | null;

export interface DrawnGroundOptions {
  /**
   * The land seam's drawn surface (`KingdomLandInterface.surfaceAt`, SEAMS A2). When given it is the only source:
   * the scene is never read.
   */
  readonly surfaceAt?: DrawnSurfaceAt | undefined;
  /** The scene holding the drawn terrain tiles, for the fallback until the seam exists. */
  readonly scene?: THREE.Object3D | undefined;
  /** Milliseconds, for throttling rescans of a scene whose terrain is not drawn yet. */
  readonly clock?: (() => number) | undefined;
}

export interface DrawnGround {
  readonly at: DrawnGroundAt;
  /** Which source answered last: the land seam, the drawn terrain tiles, or nothing drawn yet. */
  readonly source: 'seam' | 'terrain' | 'none';
  /** Forget the cached tiles; the next sample walks the scene again (after terrain is rebuilt or replaced). */
  refresh(): void;
}

/** The smoothed terrain's height texture, exactly as `packages/render` voxel-material's `groundHeight` reads it. */
export interface TerrainHeightField {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly depth: number;
  readonly originX: number;
  readonly originZ: number;
  readonly step: number;
}

interface TerrainTile {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  /** The field last read from the material, and the texture it was read from: re-read only when that changes. */
  field: TerrainHeightField | null;
  texture: unknown;
  /** World translation of the tile: the shader's vertex grid is integer metres in the mesh's local frame. */
  readonly tx: number;
  readonly tz: number;
  readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number;
}

const RESCAN_MS = 500;
/**
 * A scene still without terrain tiles after twenty looks (ten seconds: the grand land's blocky ground has none) is
 * looked at again ever less often, up to this. Terrain drawn just after the walk starts is still found within .5 s.
 */
const RESCAN_MAX_MS = 8000, RESCAN_PATIENCE = 20;

/** Still drawn: attached all the way up to `root` and visible along the way. */
function drawnIn(object: THREE.Object3D, root: THREE.Object3D | undefined): boolean {
  let at: THREE.Object3D | null = object;
  while (at) {
    if (!at.visible) return false;
    if (at === root) return true;
    at = at.parent;
  }
  return root === undefined;
}

/**
 * Read the height field a terrain material displaces its vertices with (`uTerrain`, `uTerrainHeight`,
 * `uTerrainOrigin`, `uTerrainSize`, `uTerrainStep`). Null for any other material, including the grand land's.
 */
export function terrainHeightField(material: THREE.Material): TerrainHeightField | null {
  if (!(material instanceof THREE.ShaderMaterial)) return null;
  const u = material.uniforms;
  if (u.uTerrain?.value !== 1) return null;
  const texture = u.uTerrainHeight?.value as THREE.DataTexture | undefined;
  const origin = u.uTerrainOrigin?.value as THREE.Vector2 | undefined, size = u.uTerrainSize?.value as THREE.Vector2 | undefined;
  const step = u.uTerrainStep?.value as number | undefined;
  const image = texture?.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
  if (!image?.data || !origin || !size || typeof step !== 'number' || !(step > 0)) return null;
  const width = size.x, depth = size.y;
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 2 || depth < 2 || image.data.length < width * depth
    || ![origin.x, origin.y].every(Number.isFinite)) return null;
  return { data: image.data, width, depth, originX: origin.x, originZ: origin.y, step };
}

/** The shader's `groundHeight(world.xz)`: clamped, bilinear between texels. */
export function sampleHeightField(field: TerrainHeightField, x: number, z: number): number {
  const u = Math.min(Math.max((x - field.originX) / field.step, 0), field.width - 1.001);
  const v = Math.min(Math.max((z - field.originZ) / field.step, 0), field.depth - 1.001);
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, w = field.width, d = field.data;
  const a = d[i + j * w]!, b = d[i + 1 + j * w]!, c = d[i + (j + 1) * w]!, e = d[i + 1 + (j + 1) * w]!;
  return (a + (b - a) * fu) * (1 - fv) + (c + (e - c) * fu) * fv;
}

/** A terrain tile only when its world transform is a pure translation (the shader's grid stays metre-aligned). */
function tileOf(mesh: THREE.Mesh): TerrainTile | null {
  const material = Array.isArray(mesh.material) ? undefined : mesh.material;
  if (!material || !(material instanceof THREE.ShaderMaterial) || !terrainHeightField(material)) return null;
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) return null;
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements;
  if (Math.abs(e[0]! - 1) > 1e-9 || Math.abs(e[5]! - 1) > 1e-9 || Math.abs(e[10]! - 1) > 1e-9
    || [e[1], e[2], e[4], e[6], e[8], e[9]].some(n => Math.abs(n!) > 1e-9)) return null;
  const tx = e[12]!, tz = e[14]!;
  return { mesh, material, field: null, texture: undefined, tx, tz, minX: box.min.x + tx, maxX: box.max.x + tx, minZ: box.min.z + tz, maxZ: box.max.z + tz };
}

/**
 * The drawn ground under a point. With the land seam's `surfaceAt` it simply reads that. Until grand-world ships
 * it, it answers from the drawn terrain tiles in the scene: their shader replaces every vertex height with the
 * material's height texture on a 1 m grid with the fixed 00→11 diagonal, so a downward ray meets exactly the
 * triangle `sampleTerrainTriangles` evaluates over those texels. Tiles are found once and cached; each sample is a
 * footprint check plus four texel reads, cheap enough for every walker's feet each frame.
 */
export function createDrawnGround(options: DrawnGroundOptions): DrawnGround {
  const clock = options.clock ?? (() => performance.now());
  let tiles: TerrainTile[] = [], scanned = false, lastScan = -Infinity, hint = 0, wait = RESCAN_MS, empty = 0;
  let source: DrawnGround['source'] = 'none';
  const scan = () => {
    tiles = []; scanned = true; lastScan = clock(); hint = 0;
    options.scene?.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      const tile = tileOf(object);
      if (tile) tiles.push(tile);
    });
    empty = tiles.length ? 0 : empty + 1;
    wait = empty < RESCAN_PATIENCE ? RESCAN_MS : Math.min(RESCAN_MAX_MS, wait * 2);
  };
  // One sampler for every call, pointed at the tile being read: no closure per sample.
  let tileField: TerrainHeightField | null = null, tileX = 0, tileZ = 0;
  const sampleTile = (a: number, b: number) => sampleHeightField(tileField!, a + tileX, b + tileZ);
  const inside = (tile: TerrainTile, x: number, z: number) => x >= tile.minX && x <= tile.maxX && z >= tile.minZ && z <= tile.maxZ;
  const fromTerrain: DrawnGroundAt = (x, z) => {
    if (!scanned || (!tiles.length && clock() - lastScan >= wait)) scan();
    for (let n = 0; n < tiles.length; n++) {
      const index = (hint + n) % tiles.length, tile = tiles[index]!;
      if (!inside(tile, x, z)) continue;
      if (!drawnIn(tile.mesh, options.scene)) {
        // A removed or hidden tile is not drawn ground; look again soon rather than trusting a stale cache.
        if (clock() - lastScan >= RESCAN_MS) { scan(); return fromTerrain(x, z); }
        continue;
      }
      // The material replaces its height texture when terrain is rebuilt (and its origin and size with it).
      const uniforms = tile.material.uniforms, texture = uniforms.uTerrainHeight?.value as unknown;
      if (texture !== tile.texture || uniforms.uTerrain?.value !== 1) { tile.texture = texture; tile.field = terrainHeightField(tile.material); }
      const field = tile.field;
      if (!field) continue;
      hint = index;
      tileField = field; tileX = tile.tx; tileZ = tile.tz;
      return sampleTerrainTriangles(sampleTile, x - tile.tx, z - tile.tz);
    }
    return null;
  };
  const surfaceAt = options.surfaceAt;
  const at: DrawnGroundAt = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    if (surfaceAt) {
      const sample = surfaceAt(x, z), y = sample?.drawnY;
      source = 'seam';
      return typeof y === 'number' && Number.isFinite(y) ? y : null;
    }
    const y = fromTerrain(x, z);
    source = y === null ? 'none' : 'terrain';
    return y !== null && Number.isFinite(y) ? y : null;
  };
  return {
    at,
    get source() { return source; },
    refresh() { scanned = false; tiles = []; wait = RESCAN_MS; empty = 0; },
  };
}
