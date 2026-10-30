import * as THREE from 'three';
import { VOXEL_METRES, type BuildDraftPolicy, type Vec3, type VoxelBlueprint } from '@chatdom/shared';

/** Authored houses are frontage-aligned; a draft always keeps the entire 16 m reservation. */
export function blueprintInReserve(blueprint: VoxelBlueprint, policy: BuildDraftPolicy): VoxelBlueprint {
  const dz = policy.size[2] - blueprint.size[2];
  const shift = (point: Vec3): [number, number, number] => [point[0], point[1], point[2] + dz];
  return { ...blueprint, size: [...policy.size],
    boxes: blueprint.boxes.map(box => ({ ...box, from: shift(box.from), to: shift(box.to) })),
    windows: blueprint.windows.map(window => ({ ...window, centre: shift(window.centre) })) };
}

/** Source dimensions contain reserved air. Only occupied bounds compose the home in the camera. */
export function buildBounds(blueprint: VoxelBlueprint): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (const box of blueprint.boxes) if (box.material) {
    bounds.expandByPoint(new THREE.Vector3(...box.from).multiplyScalar(VOXEL_METRES.build));
    bounds.expandByPoint(new THREE.Vector3(...box.to).multiplyScalar(VOXEL_METRES.build));
  }
  return bounds;
}

export interface BuildCameraComposition {
  position: THREE.Vector3; target: THREE.Vector3; fov: number;
  offsetX: number; offsetY: number;
}

/** Fit every occupied corner into the free canvas beside the tools, with a level horizon. */
export function composeBuildCamera(bounds: THREE.Box3, position: Vec3, yaw: number,
  viewport: { width: number; height: number },
  view: { azimuth: number; elevation: number; zoom: number; tools: boolean }): BuildCameraComposition {
  const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height), portrait = width < 640;
  const side = view.tools && !portrait ? Math.min(392, width * .42) : 0;
  const bottom = view.tools && portrait ? Math.min(370, height * .49) : 0;
  const top = view.tools ? 62 : 30;
  const freeWidth = width - side - 40, freeHeight = height - bottom - top - 24;
  const fov = 43, tangent = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const tanH = tangent * width / height * Math.max(.2, freeWidth / width);
  const tanV = tangent * Math.max(.2, freeHeight / height);
  const angle = yaw + view.azimuth;
  const backward = new THREE.Vector3(Math.sin(angle) * Math.cos(view.elevation), Math.sin(view.elevation), Math.cos(angle) * Math.cos(view.elevation));
  const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
  const up = new THREE.Vector3().crossVectors(backward, right);
  const local = bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(1, 0, 9), new THREE.Vector3(7, 4, 15)) : bounds;
  const centre = local.getCenter(new THREE.Vector3()), target = centre.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(...position));
  let distance = 5;
  for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) {
    const corner = new THREE.Vector3(x, y, z).sub(centre).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const depth = corner.dot(backward);
    distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tanH, depth + Math.abs(corner.dot(up)) / tanV);
  }
  distance = (distance + 1.2) * view.zoom;
  return { position: target.clone().addScaledVector(backward, distance), target, fov,
    offsetX: side / 2, offsetY: (bottom - top) / 2 };
}
