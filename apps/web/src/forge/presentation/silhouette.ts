import * as THREE from 'three';
import { VOXEL_METRES } from '@chatdom/shared';

/** The clone's real surface in its own local space, read once; the caller's geometry is never modified. */
export interface Silhouette {
  /** Non-indexed triangle soup in clone-local metres. */
  positions: Float32Array;
  /** Flat face normals matching `positions`. */
  normals: Float32Array;
  /** Edge length of one build cell in clone-local metres. */
  cell: number;
  bounds: THREE.Box3;
  /** Evenly spread surface points (clone-local) where the gathered runes land. */
  landings: THREE.Vector3[];
}

const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

function voxelScale(material: THREE.Material | THREE.Material[]): number {
  const first = Array.isArray(material) ? material[0] : material;
  const value = (first as THREE.ShaderMaterial | undefined)?.uniforms?.uScale?.value;
  return typeof value === 'number' && value > 0 ? value : VOXEL_METRES.build;
}

/**
 * Production voxel meshes carry packed integer corners (`aPacked` + chunk bits in `aMaterial`), the same
 * encoding the voxel shader decodes. Ordinary meshes use `position`. Either becomes a flat-shaded soup.
 */
export function traceSilhouette(piece: THREE.Object3D, landingCount: number): Silhouette {
  piece.updateWorldMatrix(true, true);
  const toPiece = piece.matrixWorld.clone().invert();
  const chunks: { positions: Float32Array; count: number }[] = [];
  let cell = 0, total = 0;
  const v = new THREE.Vector3(), relative = new THREE.Matrix4();
  piece.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const packed = geometry.getAttribute('aPacked'), chunk = geometry.getAttribute('aMaterial');
    const position = geometry.getAttribute('position');
    const vertexCount = packed ? packed.count : position ? position.count : 0;
    if (vertexCount === 0) return;
    relative.multiplyMatrices(toPiece, mesh.matrixWorld);
    const scale = packed && chunk ? voxelScale(mesh.material) : VOXEL_METRES.build;
    cell = cell || scale * new THREE.Vector3().setFromMatrixScale(relative).x;
    const index = geometry.getIndex();
    const corners = index ? index.count : vertexCount;
    const out = new Float32Array(corners * 3);
    for (let i = 0; i < corners; i++) {
      const at = index ? index.getX(i) : i;
      if (packed && chunk) {
        const p = packed.getX(at) >>> 0, m = chunk.getX(at) >>> 0;
        v.set(((p & 63) + 32 * ((m >>> 16) & 31)) * scale, (((p >>> 6) & 63) + 32 * ((m >>> 21) & 31)) * scale, (((p >>> 12) & 63) + 32 * ((m >>> 26) & 31)) * scale);
      } else {
        v.fromBufferAttribute(position!, at);
      }
      v.applyMatrix4(relative);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    chunks.push({ positions: out, count: corners - (corners % 3) });
    total += corners - (corners % 3);
  });
  if (total === 0) throw new Error('The Forge presentation needs the part’s real geometry.');
  const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3);
  let offset = 0;
  for (const c of chunks) { positions.set(c.positions.subarray(0, c.count * 3), offset * 3); offset += c.count; }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), ac = new THREE.Vector3();
  const bounds = new THREE.Box3();
  for (let i = 0; i < total; i += 3) {
    a.fromArray(positions, i * 3); b.fromArray(positions, i * 3 + 3); c.fromArray(positions, i * 3 + 6);
    n.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
    // Voxel faces are axis-aligned; snapping removes float noise from decoded corners.
    let best = 0, dot = -Infinity;
    FACE_NORMALS.forEach((f, k) => { const d = n.x * f[0] + n.y * f[1] + n.z * f[2]; if (d > dot) { dot = d; best = k; } });
    if (dot > .999) n.fromArray(FACE_NORMALS[best]!);
    for (let k = 0; k < 3; k++) n.toArray(normals, (i + k) * 3);
    bounds.expandByPoint(a); bounds.expandByPoint(b); bounds.expandByPoint(c);
  }
  return { positions, normals, cell: cell || VOXEL_METRES.build, bounds, landings: spreadLandings(positions, normals, total, landingCount) };
}

/** Farthest-point sampling over outward-facing triangle centres: deterministic and spread across the shape. */
function spreadLandings(positions: Float32Array, normals: Float32Array, count: number, wanted: number): THREE.Vector3[] {
  const centres: THREE.Vector3[] = [];
  const stride = Math.max(1, Math.floor(count / 3 / 600));
  for (let t = 0; t < count / 3; t += stride) {
    const i = t * 9;
    // Prefer faces a viewer can see: tops and sides, not undersides.
    if (normals[i + 1]! < -.5) continue;
    centres.push(new THREE.Vector3((positions[i]! + positions[i + 3]! + positions[i + 6]!) / 3, (positions[i + 1]! + positions[i + 4]! + positions[i + 7]!) / 3, (positions[i + 2]! + positions[i + 5]! + positions[i + 8]!) / 3));
  }
  if (centres.length === 0) return [];
  const centre = centres.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(centres.length);
  let first = centres[0]!;
  for (const p of centres) if (p.distanceToSquared(centre) < first.distanceToSquared(centre)) first = p;
  const picked = [first.clone()];
  const nearest = centres.map(p => p.distanceToSquared(first));
  while (picked.length < wanted && picked.length < centres.length) {
    let far = 0;
    for (let i = 1; i < centres.length; i++) if (nearest[i]! > nearest[far]!) far = i;
    const p = centres[far]!; picked.push(p.clone());
    for (let i = 0; i < centres.length; i++) nearest[i] = Math.min(nearest[i]!, centres[i]!.distanceToSquared(p));
  }
  return picked;
}
