import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { geometryFromChunks, getEnvironment, type Environment } from '@chatdom/render';
import { executeVoxelJob } from '@chatdom/voxel';
import { createAnvilMaterial } from './material';
import { MARK_CENTRE } from './runes';
import { GRID_MIN, H, sculptAnvilStage, Y_OFFSET } from './sculpt';

/** The engraving's SVG units to metres, and its plate's front bevel, from engraving/index.ts. */
const ENGRAVING_UNIT = .32 / 24;
const ENGRAVING_FRONT_BEVEL = .13;
/** Uniform scale for the unchanged engraving root: the cloud is about 0.24 m across. */
export const MARK_SCALE = .9;
/**
 * The plate's face sits this far behind the cheek, inside the window cut for it. The cheek's own edge
 * frames the plate and hides its bevelled rim, so no seam outlines the mark; half a millimetre is too
 * little to see as a step and enough to keep the two planes from fighting.
 */
const PLATE_SET_BACK = .0005;

export interface AnvilHero {
  root: THREE.Group;
  engravingMount: { position: THREE.Vector3; rotation: THREE.Euler; scale: number };
  runeOrigin: THREE.Vector3;
  update(input: { time: number; heat: number; shaping: boolean }): void;
  /** Optional: follow the kingdom's hour for the steel's dusk rim and the stone's light. Defaults to 19:00. */
  setEnvironment(grade: Environment): void;
  dispose(): void;
}

/**
 * The Forge's physical stage: an iron anvil on a worn stone block, meshed once by the
 * production voxel mesher. Metres, +Y up, horn toward +X, the mark's cheek toward +Z.
 * The caller owns the engraving and anything else it parents under `root`.
 */
export function createAnvilHero(parent: THREE.Object3D): AnvilHero {
  const sculpt = sculptAnvilStage();
  const result = executeVoxelJob({
    id: 0, kind: 'asset', materials: MATERIALS.materials, materialRevision: MATERIALS.revision,
    asset: { id: 'forge-anvil-hero', revision: 1, lattice: 'avatar', size: sculpt.size, voxels: sculpt.voxels },
  });
  if (result.kind !== 'asset' || !result.chunks.length) throw new Error('The anvil could not be cast.');
  const geometry = geometryFromChunks(result.chunks, 'avatar');
  // Tight bounds from the occupied cells, not the 2 m mesher chunks: honest culling and framing.
  const bounds = new THREE.Box3();
  for (const { mesh, coordinate } of result.chunks) if (mesh.bounds) {
    bounds.expandByPoint(new THREE.Vector3(...mesh.bounds.min).addScaledVector(new THREE.Vector3(...coordinate), 32).multiplyScalar(H));
    bounds.expandByPoint(new THREE.Vector3(...mesh.bounds.max).addScaledVector(new THREE.Vector3(...coordinate), 32).multiplyScalar(H));
  }
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  const material = createAnvilMaterial(sculpt);
  material.state.setEnvironment(getEnvironment(19));

  const root = new THREE.Group();
  root.name = 'forge-anvil-hero';
  const stage = new THREE.Mesh(geometry, material.material);
  stage.name = 'forge-anvil-hero:stage';
  stage.position.set(GRID_MIN[0] * H, GRID_MIN[1] * H + Y_OFFSET, GRID_MIN[2] * H);
  root.add(stage);
  parent.add(root);

  const centre = MARK_CENTRE.clone();
  const engravingMount = {
    position: centre.clone().setZ(centre.z - PLATE_SET_BACK - ENGRAVING_FRONT_BEVEL * ENGRAVING_UNIT * MARK_SCALE),
    rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
    scale: MARK_SCALE,
  };
  const runeOrigin = centre.clone().setZ(centre.z + .02);
  let disposed = false;

  return {
    root, engravingMount, runeOrigin,
    update({ time, heat, shaping }) {
      material.uniforms.uAnvilTime.value = Number.isFinite(time) ? time : 0;
      material.uniforms.uAnvilHeat.value = THREE.MathUtils.clamp(Number.isFinite(heat) ? heat : 0, 0, 1);
      material.uniforms.uAnvilShaping.value = shaping ? 1 : 0;
    },
    setEnvironment(grade) { material.state.setEnvironment(grade); },
    dispose() {
      if (disposed) return;
      disposed = true;
      parent.remove(root);
      root.remove(stage);
      geometry.dispose();
      material.dispose();
    },
  };
}
