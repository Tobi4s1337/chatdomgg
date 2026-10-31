import * as THREE from 'three';
import { MAT, MATERIALS } from '@chatdom/content';
import type { MaterialRegistry } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
// Main owns the package export; until it adds one, the fixture reads the lane-owned producer by path.
import type { TerrainArtCandidate, TerrainArtMaterial } from '../../../../../packages/world/src/terrain-art';

export type BoundsXZ = SettlementPlan['bounds'];
/** What the draw adapter and the fixture read: a producer candidate, or the accepted ground for comparison. */
export type LandSource = Pick<TerrainArtCandidate, 'bounds' | 'height' | 'corner' | 'material' | 'protection'>;

/**
 * Draw adapter for a land candidate (fixture only). It never displaces height in a shader: every vertex is
 * a candidate corner, joined with the accepted 00→11 diagonal, so what is drawn is exactly what a contact
 * query of the same candidate returns. Main alone decides whether a candidate becomes the rendered and
 * colliding authority.
 */

/** Fixture palette entries for land the content palette has no swatch for yet. Ids sit far above content's. */
export const FIXTURE_LAND = { rock: 240, scree: 241, ledge: 242, heath: 243 } as const;

export const LAND_PALETTE: Readonly<Record<TerrainArtMaterial, number>> = {
  grass: MAT.grass, heath: FIXTURE_LAND.heath, trail: MAT.earth, paving: MAT.paving,
  scree: FIXTURE_LAND.scree, rock: FIXTURE_LAND.rock, ledge: FIXTURE_LAND.ledge, waterbed: MAT.waterbed,
};

/** The content palette plus the fixture's land swatches. Earth-kind surfaces: no masonry joints on a cliff. */
export function landRegistry(): MaterialRegistry {
  const like = MATERIALS.materials.find(material => material.id === MAT.earth)!;
  const grass = MATERIALS.materials.find(material => material.id === MAT.grass)!;
  return { ...MATERIALS, materials: [...MATERIALS.materials,
    { ...like, id: FIXTURE_LAND.rock, name: 'fixture-land-rock', colour: '#8a8072' },
    { ...like, id: FIXTURE_LAND.scree, name: 'fixture-land-scree', colour: '#76695a' },
    { ...like, id: FIXTURE_LAND.ledge, name: 'fixture-land-ledge', colour: '#808158' },
    { ...grass, id: FIXTURE_LAND.heath, name: 'fixture-land-heath', colour: '#727a4c' },
  ] };
}

/**
 * Land treatment patched into a copy of the kingdom's own terrain shader: faceted normals and soft
 * strata on rock only. Lighting, fog, shadow and light-field terms are untouched.
 */
export function createLandMaterial(ground: THREE.ShaderMaterial): THREE.ShaderMaterial {
  const rock = `vMaterial>=${FIXTURE_LAND.rock}u&&vMaterial<=${FIXTURE_LAND.ledge}u`;
  const normalLine = 'vec3 n=normalize(vNormal);';
  const edgeLine = 'float edge=1.;';
  if (ground.fragmentShader.split(normalLine).length !== 2 || ground.fragmentShader.split(edgeLine).length !== 2) {
    throw new Error('The terrain shader changed; the land fixture treatment needs re-fitting.');
  }
  const fragmentShader = ground.fragmentShader
    .replace(normalLine, `${normalLine}
      if(${rock}){vec3 facet=normalize(cross(dFdx(vWorld),dFdy(vWorld)));if(dot(facet,n)<0.)facet=-facet;
        float near=1.-smoothstep(140.,360.,length(cameraPosition-vWorld));n=normalize(mix(n,facet,(vMaterial==${FIXTURE_LAND.ledge}u?.25:.8)*near));}`)
    .replace(edgeLine, `${edgeLine}
      if(${rock}&&vMaterial!=${FIXTURE_LAND.ledge}u){
        float band=vWorld.y*1.35+.55*sin(vWorld.x*.19+vWorld.z*.13)+1.2*sin((vWorld.x-vWorld.z)*.031);
        float layer=fract(band),course=floor(band);
        base*=.9+.14*fract(sin(course*12.9898)*43758.5453);
        edge=mix(.74,1.,smoothstep(.0,.16,layer))*mix(1.06,1.,smoothstep(.75,1.,layer));
      }`);
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: ground.uniforms, fragmentShader, defines: { ...ground.defines },
    vertexShader: `in float aMaterial;in float aAo;in float aSky;
      out vec3 vWorld;out vec3 vNormal;out float vAo;out float vSky;out float vLodFade;flat out uint vMaterial;
      void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*normal);
        vAo=aAo;vSky=aSky;vLodFade=1.;vMaterial=uint(aMaterial+.5);gl_Position=projectionMatrix*viewMatrix*world;}`,
  });
}

export interface LandRegion {
  readonly bounds: BoundsXZ;
  /** Corner spacing in metres; 1 m near the town, whole metres beyond. */
  readonly step: number;
  /** A cut-out already drawn by a finer region; must align with `step`. */
  readonly hole?: BoundsXZ;
  /** Hide the T-junctions where a finer region meets a coarser one. */
  readonly skirt?: number;
}

const OPEN_DIRECTIONS = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)] as const);

/** One region of land as indexed metre (or coarser) patches: four vertices each, one material each. */
export function buildLandGeometry(candidate: LandSource, region: LandRegion): THREE.BufferGeometry {
  const { bounds, step, hole } = region;
  const nx = Math.round((bounds.maxX - bounds.minX) / step), nz = Math.round((bounds.maxZ - bounds.minZ) / step);
  if (nx <= 0 || nz <= 0 || nx * step !== bounds.maxX - bounds.minX || nz * step !== bounds.maxZ - bounds.minZ) {
    throw new Error('Land region must be a whole number of steps.');
  }
  // A ring of extra corners feeds normals and sky openness at the region's edge.
  const pad = Math.max(2, Math.ceil(8 / step)), w = nx + 1 + pad * 2, d = nz + 1 + pad * 2;
  const heights = new Float32Array(w * d);
  const cb = candidate.bounds;
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const x = Math.min(cb.maxX, Math.max(cb.minX, bounds.minX + (i - pad) * step));
    const z = Math.min(cb.maxZ, Math.max(cb.minZ, bounds.minZ + (j - pad) * step));
    heights[i + j * w] = candidate.corner(x, z);
  }
  const at = (i: number, j: number): number => heights[Math.min(w - 1, Math.max(0, i + pad)) + Math.min(d - 1, Math.max(0, j + pad)) * w]!;
  const inHole = (i: number, j: number): boolean => !!hole
    && bounds.minX + i * step >= hole.minX && bounds.minX + (i + 1) * step <= hole.maxX
    && bounds.minZ + j * step >= hole.minZ && bounds.minZ + (j + 1) * step <= hole.maxZ;

  // Per-corner normal (same central difference as the terrain shader), sky openness and contact shade.
  const cornerNormal = new Float32Array((nx + 1) * (nz + 1) * 3), cornerSky = new Float32Array((nx + 1) * (nz + 1)), cornerAo = new Float32Array((nx + 1) * (nz + 1));
  const reach = [1, 2, 4, 7].map(m => Math.max(1, Math.round(m / step)));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const h = at(i, j), k = i + j * (nx + 1);
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
    const length = Math.hypot(gx, 1, gz);
    cornerNormal[k * 3] = -gx / length; cornerNormal[k * 3 + 1] = 1 / length; cornerNormal[k * 3 + 2] = -gz / length;
    let occlusion = 0;
    for (const [dx, dz] of OPEN_DIRECTIONS) {
      let tangent = 0;
      for (const r of reach) tangent = Math.max(tangent, (at(i + Math.round(dx * r), j + Math.round(dz * r)) - h) / (r * step));
      occlusion += tangent / Math.hypot(1, tangent);
    }
    cornerSky[k] = Math.max(0.35, 1 - 0.85 * occlusion / OPEN_DIRECTIONS.length);
    const concave = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) / 4 - h;
    cornerAo[k] = Math.min(1, Math.max(0, 1 - Math.max(0, concave) * 0.45 / step));
  }

  const patches = nx * nz, skirtEdges = region.skirt ? (nx + nz) * 2 : 0;
  const vertexCount = (patches + skirtEdges) * 4;
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
  const materials = new Float32Array(vertexCount), skies = new Float32Array(vertexCount), aos = new Float32Array(vertexCount);
  const indices = new Uint32Array((patches + skirtEdges) * 6);
  let v = 0, n = 0;
  const push = (i: number, j: number, y: number, material: number, normalFrom = i + j * (nx + 1)): void => {
    positions[v * 3] = bounds.minX + i * step; positions[v * 3 + 1] = y; positions[v * 3 + 2] = bounds.minZ + j * step;
    normals[v * 3] = cornerNormal[normalFrom * 3]!; normals[v * 3 + 1] = cornerNormal[normalFrom * 3 + 1]!; normals[v * 3 + 2] = cornerNormal[normalFrom * 3 + 2]!;
    materials[v] = material; skies[v] = cornerSky[normalFrom]!; aos[v] = 0.8 + 0.2 * cornerAo[normalFrom]!; v++;
  };
  const patchMaterial = (i: number, j: number): number => {
    const x = bounds.minX + i * step, z = bounds.minZ + j * step;
    if (step === 1) return LAND_PALETTE[candidate.material(x, z)];
    // Coarse land classifies its own (larger) triangles the same way, by rise per metre across them.
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), e = at(i + 1, j + 1);
    const rise = Math.max(Math.abs(e - a), Math.abs(b - c), Math.abs(b - a), Math.abs(c - a), Math.abs(e - b), Math.abs(e - c)) / step;
    if (rise >= 0.95) return FIXTURE_LAND.rock;
    if (rise >= 0.58) return FIXTURE_LAND.scree;
    const high = Math.max(a, b, c, e);
    return high > 34 + 8 * Math.sin(x * 0.013) * Math.sin(z * 0.011) ? FIXTURE_LAND.heath : MAT.grass;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (inHole(i, j)) continue;
    const material = patchMaterial(i, j), base = v;
    push(i, j, at(i, j), material); push(i, j + 1, at(i, j + 1), material);
    push(i + 1, j + 1, at(i + 1, j + 1), material); push(i + 1, j, at(i + 1, j), material);
    // Fixed 00→11 diagonal: the same two triangles a contact query of this candidate interpolates.
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], n); n += 6;
  }
  if (region.skirt) {
    const drop = region.skirt;
    const edge = (i0: number, j0: number, i1: number, j1: number, material: number): void => {
      const base = v;
      push(i0, j0, at(i0, j0), material); push(i0, j0, at(i0, j0) - drop, material, i0 + j0 * (nx + 1));
      push(i1, j1, at(i1, j1) - drop, material, i1 + j1 * (nx + 1)); push(i1, j1, at(i1, j1), material);
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], n); n += 6;
    };
    for (let i = 0; i < nx; i++) { edge(i + 1, 0, i, 0, patchMaterial(i, 0)); edge(i, nz, i + 1, nz, patchMaterial(i, nz - 1)); }
    for (let j = 0; j < nz; j++) { edge(0, j, 0, j + 1, patchMaterial(0, j)); edge(nx, j + 1, nx, j, patchMaterial(nx - 1, j)); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, v * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, v * 3), 3));
  geometry.setAttribute('aMaterial', new THREE.BufferAttribute(materials.subarray(0, v), 1));
  geometry.setAttribute('aSky', new THREE.BufferAttribute(skies.subarray(0, v), 1));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(aos.subarray(0, v), 1));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, n), 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Corner heights on a regular grid, for consumers (water) that need the same land as a texture. */
export function landHeightGrid(candidate: LandSource, origin: readonly [number, number], width: number, depth: number): Float32Array {
  const data = new Float32Array(width * depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) data[x + z * width] = candidate.corner(origin[0] + x, origin[1] + z);
  return data;
}
