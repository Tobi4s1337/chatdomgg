import { MAT, MATERIALS } from '@chatdom/content';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { haloIndex, HALO_VOLUME, meshVoxelChunk, packVoxelVertex, unpackVoxelVertex,
  type AssetChunkMesh, type MeshChunkRequest, type VoxelChunkMesh } from '@chatdom/voxel';
import { roadDistance, seedHash, terrainHeight, type KingdomLayout } from '@chatdom/world';

const CELL_METRES = VOXEL_METRES.terrain;
const CHUNK_METRES = CELL_METRES * 32;
const BOTTOM_Y = -4;
const MAX_CHUNK_COORDINATE = 31;
/** Surface tessellation, not a replacement for the authoritative 0.5 m occupancy lattice. */
export const TERRAIN_SURFACE_METRES = 1;
/** Expand render bounds by this much: the packed Y names the source voxel, before smoothing. */
export const TERRAIN_SURFACE_BOUNDS_PADDING = 2;

export interface TerrainField {
  readonly origin: Vec3;
  readonly chunkCounts: readonly [number, number];
  readonly columns: number;
  readonly rows: number;
  /** Column top in cells relative to origin.y; the first solid cell is one below it. */
  readonly heights: Int16Array;
  readonly surfaces: Uint16Array;
  /** Global integer-metre corner samples; Float32 agrees with the renderer's height texture. */
  readonly renderHeights: Float32Array;
  readonly key: string;
}

/**
 * Contact height of the rendered 1 m triangles, with the same 00→11 diagonal and Float32
 * corner samples as the GPU texture. Analytic terrainHeight is the authored continuous field;
 * it is not exactly the piecewise-planar surface between render vertices.
 */
export function sampleRenderedTerrainHeight(layout: KingdomLayout, x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Terrain contact needs finite coordinates.');
  const left = Math.floor(x), back = Math.floor(z), u = x - left, v = z - back;
  const h00 = Math.fround(terrainHeight(layout, left, back));
  const h01 = Math.fround(terrainHeight(layout, left, back + 1));
  const h11 = Math.fround(terrainHeight(layout, left + 1, back + 1));
  const h10 = Math.fround(terrainHeight(layout, left + 1, back));
  return u <= v ? h00 + u * (h11 - h01) + v * (h01 - h00)
    : h00 + u * (h10 - h00) + v * (h11 - h10);
}

export interface TerrainProgress {
  readonly completed: number;
  readonly total: number;
  readonly origin: Vec3;
  readonly chunk?: AssetChunkMesh;
}

export interface TerrainWorkerRequest { readonly kind: 'build-terrain'; readonly layout: KingdomLayout }
export type TerrainWorkerResponse =
  | { readonly kind: 'start'; readonly total: number; readonly origin: Vec3 }
  | { readonly kind: 'chunk'; readonly progress: TerrainProgress }
  | { readonly kind: 'complete'; readonly completed: number; readonly total: number }
  | { readonly kind: 'error'; readonly message: string };

/** One globally sampled grid includes every neighbouring column needed by all 34³ halos. */
export function prepareTerrainField(layout: KingdomLayout): TerrainField {
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) {
    throw new Error('Terrain needs finite, nonempty bounds.');
  }
  const origin: Vec3 = [Math.floor(minX / CHUNK_METRES) * CHUNK_METRES,
    Math.floor(BOTTOM_Y / CHUNK_METRES) * CHUNK_METRES, Math.floor(minZ / CHUNK_METRES) * CHUNK_METRES];
  const countX = Math.ceil((maxX - origin[0]) / CHUNK_METRES);
  const countZ = Math.ceil((maxZ - origin[2]) / CHUNK_METRES);
  if (countX > MAX_CHUNK_COORDINATE + 1 || countZ > MAX_CHUNK_COORDINATE + 1) {
    throw new Error('Terrain exceeds the 32-chunk render-coordinate budget.');
  }
  const columns = countX * 32 + 2, rows = countZ * 32 + 2;
  const heights = new Int16Array(columns * rows);
  const surfaces = new Uint16Array(columns * rows);
  const phase = (seedHash(layout.config.seed) % 6283) / 1000;
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    // Sampling at cell centres is identical on both sides of every chunk seam.
    const worldX = origin[0] + (x - 0.5) * CELL_METRES;
    const worldZ = origin[2] + (z - 0.5) * CELL_METRES;
    const height = terrainHeight(layout, worldX, worldZ);
    if (!Number.isFinite(height) || height <= BOTTOM_Y || height >= origin[1] + 512) {
      throw new Error('Terrain height exceeds the reserved vertical volume.');
    }
    const top = Math.round(height / CELL_METRES) - origin[1] / CELL_METRES;
    if (top <= 0 || top > 1024) throw new Error('Terrain exceeds the 32-chunk vertical budget.');
    const index = x + columns * z;
    heights[index] = top;
    const distance = roadDistance(layout, worldX, worldZ);
    // Long, continuous worn edges read as a path; there is no per-voxel colour noise.
    const roadWidth = 1.8 + 0.22 * Math.sin(worldX * 0.12 + worldZ * 0.09 + phase)
      + 0.1 * Math.sin(worldX * 0.29 - worldZ * 0.17);
    surfaces[index] = height < layout.lake.level + 0.25 ? MAT.waterbed
      : distance <= roadWidth ? MAT.paving : MAT.grass;
  }
  const renderColumns = countX * 16 + 1, renderRows = countZ * 16 + 1;
  const renderHeights = new Float32Array(renderColumns * renderRows);
  for (let z = 0; z < renderRows; z++) for (let x = 0; x < renderColumns; x++) {
    renderHeights[x + renderColumns * z] = terrainHeight(layout, origin[0] + x, origin[2] + z);
  }
  return { origin, chunkCounts: [countX, countZ], columns, rows, heights, surfaces, renderHeights,
    key: `terrain:${seedHash(JSON.stringify({ config: layout.config, bounds: layout.bounds })).toString(16)}` };
}

/** Real terrain continues into every halo, even beyond the rendered footprint and below its base. */
export function terrainChunkRequest(field: TerrainField, coordinate: Vec3): MeshChunkRequest {
  if (coordinate.some(n => !Number.isInteger(n) || n < 0 || n > MAX_CHUNK_COORDINATE)
    || coordinate[0] >= field.chunkCounts[0] || coordinate[2] >= field.chunkCounts[1]) {
    throw new Error('Terrain chunk coordinate is outside the renderable footprint.');
  }
  const halo = new Uint16Array(HALO_VOLUME);
  const sky = new Uint8Array(HALO_VOLUME);
  for (let z = -1; z <= 32; z++) for (let x = -1; x <= 32; x++) {
    const column = coordinate[0] * 32 + x + 1 + field.columns * (coordinate[2] * 32 + z + 1);
    const top = field.heights[column]!, surface = field.surfaces[column]!;
    for (let y = -1; y <= 32; y++) {
      const localY = coordinate[1] * 32 + y;
      const material = localY >= top ? MAT.air : localY === top - 1 ? surface
        : localY >= top - 4 ? MAT.earth : MAT.stone;
      const index = haloIndex(x, y, z);
      halo[index] = material;
      sky[index] = material === MAT.air ? 15 : 0;
    }
  }
  const key = (x: number, y: number, z: number): string => `${field.key}:${x},${y},${z}`;
  const dependencies = [];
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    if (x === 0 && y === 0 && z === 0) continue;
    // A generated neighbour is known through its height samples, whether or not it has a mesh.
    dependencies.push({ key: key(coordinate[0] + x, coordinate[1] + y, coordinate[2] + z), revision: 1 });
  }
  return { halo, sky, materials: MATERIALS.materials,
    stamp: { key: key(...coordinate), revision: 1, materialRevision: MATERIALS.revision, dependencies } };
}

export function terrainSurfaceChunks(field: TerrainField): Vec3[] {
  const coordinates: Vec3[] = [];
  for (let z = 0; z < field.chunkCounts[1]; z++) for (let x = 0; x < field.chunkCounts[0]; x++) {
    let low = Infinity, high = -Infinity;
    // Include neighbours: a cliff on a border can expose a lower chunk's side.
    for (let dz = -1; dz <= 32; dz++) for (let dx = -1; dx <= 32; dx++) {
      const top = field.heights[x * 32 + dx + 1 + field.columns * (z * 32 + dz + 1)]!;
      low = Math.min(low, top - 1); high = Math.max(high, top - 1);
    }
    for (let y = Math.floor(low / 32); y <= Math.floor(high / 32); y++) coordinates.push([x, y, z]);
  }
  // The oldest streets and castle approach arrive before distant landscape.
  const distance = (c: Vec3): number => (field.origin[0] + (c[0] + 0.5) * CHUNK_METRES) ** 2
    + (field.origin[2] + (c[2] + 0.5) * CHUNK_METRES + 16) ** 2;
  coordinates.sort((a, b) => distance(a) - distance(b) || a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  return coordinates;
}

interface ColumnShading { readonly ao: Uint8Array; readonly sky: Uint16Array }

/** Recover the exact 0.5 m face-corner samples preserved by the ordinary voxel mesher. */
function captureTopShading(field: TerrainField, coordinate: Vec3, mesh: VoxelChunkMesh, shading: ColumnShading): number {
  let captured = 0;
  for (let offset = 0; offset < mesh.vertices.length; offset += 8) {
    const a = unpackVoxelVertex(mesh.vertices[offset]!, mesh.vertices[offset + 1]!);
    if (a.face !== 2) continue;
    const b = unpackVoxelVertex(mesh.vertices[offset + 2]!, mesh.vertices[offset + 3]!);
    const c = unpackVoxelVertex(mesh.vertices[offset + 4]!, mesh.vertices[offset + 5]!);
    const d = unpackVoxelVertex(mesh.vertices[offset + 6]!, mesh.vertices[offset + 7]!);
    const interpolate = (channel: 'ao' | 'sky', x: number, z: number): number => {
      const u = (x - a.x) / (d.x - a.x), v = (z - a.z) / (b.z - a.z);
      return Math.round((1 - u) * ((1 - v) * a[channel] + v * b[channel])
        + u * ((1 - v) * d[channel] + v * c[channel]));
    };
    for (let z = a.z; z < b.z; z++) for (let x = a.x; x < d.x; x++) {
      const column = coordinate[0] * 32 + x + 1 + field.columns * (coordinate[2] * 32 + z + 1);
      shading.ao[column] = interpolate('ao', x, z) | (interpolate('ao', x, z + 1) << 2)
        | (interpolate('ao', x + 1, z + 1) << 4) | (interpolate('ao', x + 1, z) << 6);
      shading.sky[column] = interpolate('sky', x, z) | (interpolate('sky', x, z + 1) << 4)
        | (interpolate('sky', x + 1, z + 1) << 8) | (interpolate('sky', x + 1, z) << 12);
      captured++;
    }
  }
  return captured;
}

/** Every incident patch reads the same four source columns, even across chunk/layer boundaries. */
function surfaceCornerShade(field: TerrainField, shading: ColumnShading, x: number, z: number): { ao: number; sky: number } {
  let ao = 0, sky = 0, count = 0;
  for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
    const cx = x + dx, cz = z + dz;
    if (cx < 0 || cz < 0 || cx >= field.columns - 2 || cz >= field.rows - 2) continue;
    const corner = dx === -1 ? (dz === -1 ? 2 : 3) : (dz === -1 ? 1 : 0);
    const column = cx + 1 + field.columns * (cz + 1);
    ao += (shading.ao[column]! >>> (corner * 2)) & 3;
    sky += (shading.sky[column]! >>> (corner * 4)) & 15;
    count++;
  }
  return { ao: Math.round(ao / count), sky: Math.round(sky / count) };
}

/**
 * A conforming heightfield skin over real voxel columns. Greedy top rectangles cannot be
 * deformed safely: their T-junctions sample different points along the same curved edge.
 * Uniform 1 m patches share identical XZ endpoints, diagonal, AO and sky. We omit voxel
 * stair risers because a single-valued smooth heightfield has no exposed vertical faces.
 */
function meshTerrainSurface(field: TerrainField, coordinate: Vec3, stamp: VoxelChunkMesh['stamp'], shading: ColumnShading): VoxelChunkMesh {
  const vertices: number[] = [], indices: number[] = [];
  const renderColumns = field.chunkCounts[0] * 16 + 1;
  let minY = 32, maxY = 0;
  for (let z = 0; z < 32; z += 2) for (let x = 0; x < 32; x += 2) {
    const fieldX = coordinate[0] * 32 + x, fieldZ = coordinate[2] * 32 + z;
    const column = fieldX + 1 + field.columns * (fieldZ + 1), top = field.heights[column]!;
    // The southwest 0.5 m column owns this patch. Only this vertical chunk may emit it.
    if (Math.floor((top - 1) / 32) !== coordinate[1]) continue;
    const y = top - coordinate[1] * 32;
    const materials = [field.surfaces[column]!, field.surfaces[column + 1]!,
      field.surfaces[column + field.columns]!, field.surfaces[column + field.columns + 1]!];
    // One stable material per metre; ties retain the southwest sample. No painted road overlay.
    let material = materials[0]!, votes = 0;
    for (const candidate of materials) {
      const count = materials.filter(value => value === candidate).length;
      if (count > votes) { material = candidate; votes = count; }
    }
    const base = vertices.length / 2;
    for (const [dx, dz] of [[0, 0], [0, 2], [2, 2], [2, 0]] as const) {
      const height = field.renderHeights[(fieldX + dx) / 2 + renderColumns * ((fieldZ + dz) / 2)]!;
      if (!Number.isFinite(height) || Math.abs(height - (field.origin[1] + top * CELL_METRES)) > TERRAIN_SURFACE_BOUNDS_PADDING) {
        throw new Error('Terrain smoothing exceeds its render bounds.');
      }
      const shade = surfaceCornerShade(field, shading, fieldX + dx, fieldZ + dz);
      vertices.push(...packVoxelVertex({ x: x + dx, y, z: z + dz, face: 2, material, ...shade }));
    }
    // Fixed 00→11 diagonal: sampleRenderedTerrainHeight implements precisely these triangles.
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { stamp, vertices: Uint32Array.from(vertices), indices: Uint32Array.from(indices), quadCount: indices.length / 6,
    bounds: vertices.length === 0 ? null : { min: [0, minY, 0], max: [32, maxY, 32] } };
}

/** Two bounded worker passes retain compact column shading and only one transient voxel mesh. */
export function buildTerrain(layout: KingdomLayout, emit: (response: TerrainWorkerResponse) => void): void {
  const field = prepareTerrainField(layout);
  const coordinates = terrainSurfaceChunks(field);
  const total = coordinates.length * 2;
  const shading: ColumnShading = { ao: new Uint8Array(field.heights.length), sky: new Uint16Array(field.heights.length) };
  const stamps: VoxelChunkMesh['stamp'][] = [];
  let captured = 0;
  emit({ kind: 'start', total, origin: field.origin });
  for (let index = 0; index < coordinates.length; index++) {
    const coordinate = coordinates[index]!;
    const mesh = meshVoxelChunk(terrainChunkRequest(field, coordinate));
    captured += captureTopShading(field, coordinate, mesh, shading);
    stamps.push(mesh.stamp);
    emit({ kind: 'chunk', progress: { completed: index + 1, total, origin: field.origin } });
  }
  if (captured !== (field.columns - 2) * (field.rows - 2)) throw new Error('Terrain surface is missing voxel shading.');
  for (let index = 0; index < coordinates.length; index++) {
    const coordinate = coordinates[index]!;
    const mesh = meshTerrainSurface(field, coordinate, stamps[index]!, shading);
    const completed = coordinates.length + index + 1;
    const progress: TerrainProgress = mesh.quadCount === 0
      ? { completed, total, origin: field.origin }
      : { completed, total, origin: field.origin, chunk: { coordinate, mesh } };
    emit({ kind: 'chunk', progress });
  }
  emit({ kind: 'complete', completed: total, total });
}

const scope = globalThis as unknown as {
  readonly document?: unknown;
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null;
  postMessage?: (response: TerrainWorkerResponse, transfer: ArrayBuffer[]) => void;
};
if (scope.document === undefined && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => {
    try {
      if (event.data.kind !== 'build-terrain') throw new Error('Unknown terrain worker request.');
      buildTerrain(event.data.layout, response => {
        const mesh = response.kind === 'chunk' ? response.progress.chunk?.mesh : undefined;
        scope.postMessage!(response, mesh ? [mesh.vertices.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer] : []);
      });
    } catch (error) {
      scope.postMessage!({ kind: 'error', message: error instanceof Error ? error.message : 'Terrain could not be prepared.' }, []);
    }
  };
}
