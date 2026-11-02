import * as THREE from 'three';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { WindowHouse } from '@chatdom/render';
import type { SceneView } from '../kingdom/scene';

/** A lit window in a painting: its public slot, then x and y in ten-thousandths of the frame. */
export type PaintedWindow = readonly [slot: number, x: number, y: number];

const MARGIN = .97;
/** The share of the frame lit windows must sit inside before the painter widens the shot for them. */
const FRAMED = .82;

const paneOf = (house: WindowHouse) => {
  const pane = house.blueprint.windows[0];
  return pane ? new THREE.Vector3(...pane.centre).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw).add(new THREE.Vector3(...house.position)) : null;
};
const cameraFor = (view: SceneView, aspect: number) => {
  const camera = new THREE.PerspectiveCamera(view.fov, aspect, .15, 2200);
  camera.position.set(...view.eye); camera.lookAt(new THREE.Vector3(...view.target));
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return camera;
};
const inside = (camera: THREE.PerspectiveCamera, points: readonly THREE.Vector3[], margin: number) => points.every(point => {
  const ndc = point.clone().project(camera);
  return ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= margin && Math.abs(ndc.y) <= margin;
});

/**
 * The painting's shot. The renderer's own hero view is kept whenever every lit window already sits well inside it.
 * When a lit window falls outside (newcomers are often given homes at the edge of town), the painter keeps the hero's
 * direction, eases its aim toward the lit homes and steps back just far enough to hold the castle and every lit
 * window. Nobody's window is left out of the picture of tonight's kingdom, and an empty night keeps the hero shot.
 */
export function paintingView(hero: SceneView, houses: readonly WindowHouse[], present: ReadonlySet<number>, width: number, height: number): SceneView {
  if (!(width > 0 && height > 0)) return hero;
  const aspect = width / height, lit = houses.filter(house => present.has(house.slot)).map(paneOf).filter((point): point is THREE.Vector3 => !!point);
  if (!lit.length || inside(cameraFor(hero, aspect), lit, FRAMED)) return hero;
  const eye = new THREE.Vector3(...hero.eye), target = new THREE.Vector3(...hero.target);
  const back = eye.clone().sub(target), keep = target.clone();
  const bounds = new THREE.Box3().setFromPoints([...lit, keep]), centre = bounds.getCenter(new THREE.Vector3());
  const aim = target.clone().lerp(centre, .5), points = [...lit, keep];
  let view: SceneView = hero;
  for (let step = 0; step <= 24; step++) {
    const scale = 1 + step * .1;
    view = { eye: aim.clone().addScaledVector(back, scale).toArray() as Vec3, target: aim.toArray() as Vec3, fov: hero.fov };
    if (inside(cameraFor(view, aspect), points, FRAMED)) break;
  }
  return view;
}

/**
 * Where each present window sits in the painting, read from the renderer's own camera. The presence light is the
 * first authored window of each house (as `createWindowLights` places it), so the mark lands on the glowing glass.
 * Windows outside the frame or behind the camera are left out; nothing is guessed.
 */
export function paintedWindows(houses: readonly WindowHouse[], present: ReadonlySet<number>, view: SceneView, width: number, height: number): PaintedWindow[] {
  if (!(width > 0 && height > 0)) return [];
  const camera = cameraFor(view, width / height), marks: PaintedWindow[] = [], seen = new Set<number>();
  for (const house of houses) {
    const point = present.has(house.slot) && !seen.has(house.slot) ? paneOf(house) : null;
    if (!point) continue;
    const ndc = point.project(camera);
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z <= -1 || ndc.z >= 1 || Math.abs(ndc.x) > MARGIN || Math.abs(ndc.y) > MARGIN) continue;
    seen.add(house.slot);
    marks.push([house.slot, Math.round((ndc.x + 1) * 5000), Math.round((1 - ndc.y) * 5000)]);
  }
  return marks;
}
