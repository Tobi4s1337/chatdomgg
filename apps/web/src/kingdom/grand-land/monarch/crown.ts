import * as THREE from 'three';
import type { VoxelRenderState } from '@chatdom/render';
import { createWalkerFigureMaterial } from '../../walker-figures';

/**
 * The monarch's crown, worn on their own avatar wherever they walk (Monarch.md §7.6). A small gold circlet of
 * half-avatar voxels with eight points and three set stones, painted with the citizens' material so it takes the
 * kingdom's light, dusk and windows like the person wearing it. One draw, only while a monarch is in view.
 */
const CELL = .03125, SIDE = 11, BAND = 2;
const GOLD = '#d9a441', GOLD_LIGHT = '#f0c869', GOLD_DEEP = '#a8752a', RUBY = '#b3263a', SAPPHIRE = '#2f5fa8';

type Box = { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number]; readonly paint: string; readonly ao: number };

/** The crown's boxes in metres, centred on x/z, base at y = 0, front toward +Z (the wearer's facing). */
export function crownBoxes(): readonly Box[] {
  const boxes: Box[] = [], half = SIDE * CELL / 2;
  const cell = (x: number, y: number, z: number, paint: string, ao = 1, h = 1): Box =>
    ({ min: [x * CELL - half, y * CELL, z * CELL - half], max: [(x + 1) * CELL - half, (y + h) * CELL, (z + 1) * CELL - half], paint, ao });
  for (let x = 0; x < SIDE; x++) for (let z = 0; z < SIDE; z++) {
    if (x !== 0 && x !== SIDE - 1 && z !== 0 && z !== SIDE - 1) continue;
    // The lower row a shade deeper, the rim bright: a band that reads as metal from across a street.
    boxes.push(cell(x, 0, z, GOLD_DEEP, .9), cell(x, 1, z, GOLD));
  }
  // Eight points: corners and side middles, the middles a cell taller and tipped bright.
  const points: (readonly [number, number, boolean])[] = [[0, 0, false], [5, 0, true], [10, 0, false], [0, 5, true], [10, 5, true], [0, 10, false], [5, 10, true], [10, 10, false]];
  for (const [x, z, tall] of points) {
    boxes.push(cell(x, BAND, z, GOLD, 1, tall ? 2 : 1));
    boxes.push(cell(x, BAND + (tall ? 2 : 1), z, GOLD_LIGHT, 1.05));
  }
  // Stones set into the band: a ruby at the brow, sapphires at the temples, standing proud by a third of a cell.
  const proud = CELL / 3;
  boxes.push({ min: [-CELL / 2, CELL * .4, half - CELL + .002], max: [CELL / 2, CELL * 1.6, half + proud], paint: RUBY, ao: 1.05 });
  boxes.push({ min: [-half - proud, CELL * .5, -CELL / 2], max: [-half + CELL - .002, CELL * 1.5, CELL / 2], paint: SAPPHIRE, ao: 1 });
  boxes.push({ min: [half - CELL + .002, CELL * .5, -CELL / 2], max: [half + proud, CELL * 1.5, CELL / 2], paint: SAPPHIRE, ao: 1 });
  return boxes;
}

/** Box geometry with the citizens' paint attributes (limb 0, no dye), as the simple walker figures use. */
export function crownGeometry(): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], paint: number[] = [], faceUv: number[] = [];
  const tangentU: number[] = [], tangentV: number[] = [], mask: number[] = [], index: number[] = [];
  const faces: readonly { n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }[] = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  for (const box of crownBoxes()) {
    const colour = new THREE.Color(box.paint);
    const centre = box.min.map((value, axis) => (value + box.max[axis]!) / 2), size = box.min.map((value, axis) => (box.max[axis]! - value) / 2);
    for (const face of faces) {
      const base = position.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        for (let axis = 0; axis < 3; axis++) position.push(centre[axis]! + (face.n[axis]! + face.u[axis]! * su + face.v[axis]! * sv) * size[axis]!);
        normal.push(...face.n); tangentU.push(...face.u); tangentV.push(...face.v);
        paint.push(colour.r, colour.g, colour.b);
        mask.push(0, 0, box.ao * (face.n[1] < 0 ? .6 : face.n[1] > 0 ? 1.08 : sv < 0 ? .86 : 1));
        faceUv.push((su + 1) / 2, (sv + 1) / 2);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 3));
  geometry.setAttribute('aFaceUv', new THREE.Float32BufferAttribute(faceUv, 2));
  geometry.setAttribute('aTangentU', new THREE.Float32BufferAttribute(tangentU, 3));
  geometry.setAttribute('aTangentV', new THREE.Float32BufferAttribute(tangentV, 3));
  geometry.setAttribute('aMask', new THREE.Float32BufferAttribute(mask, 3));
  geometry.setIndex(index);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** How far the circlet sits into the hair below the head's visible top (the head anchor adds 8 cm above it). */
export const CROWN_SEAT_M = .08 + .035;

/** The crown on one head. `place(null)` takes it off; a fading wearer fades it with them. */
export function createMonarchCrown(scene: THREE.Object3D, lighting: VoxelRenderState) {
  const geometry = crownGeometry(), material = createWalkerFigureMaterial(lighting);
  material.name = 'Monarch crown';
  const tint = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
  const gait = new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 1]), 3);
  gait.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aTint', tint); geometry.setAttribute('aGait', gait);
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  mesh.name = 'monarch-crown'; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    /** `head` is the renderer's head anchor (visible top centre plus 8 cm); `heading` the body's, in radians. */
    place(head: THREE.Vector3 | null | undefined, heading = 0, opacity = 1) {
      if (!head || ![head.x, head.y, head.z, heading, opacity].every(Number.isFinite) || opacity <= .02) { mesh.count = 0; return; }
      rotation.setFromAxisAngle(up, heading);
      matrix.compose(at.set(head.x, head.y - CROWN_SEAT_M, head.z), rotation, unit);
      mesh.setMatrixAt(0, matrix); mesh.count = 1; mesh.instanceMatrix.needsUpdate = true;
      gait.setZ(0, Math.min(1, opacity)); gait.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}
