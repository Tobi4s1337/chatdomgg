import * as THREE from 'three';
import type { WaterBody } from '@chatdom/world';
import type { WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import { BASIN_FEATHER, REACH_MARGIN } from './coverage';

/**
 * Surfaces in world coordinates. A basin is one flat quad over its outline; the shader trims it to the outline and
 * to the real bed. A course is a ribbon along its supplied point records: each cross-section lies at that point's
 * own surface level and carries its derived flow, so the surface falls with the course and joins without a step.
 * `aFlow` is (flow x, flow z, lateral position −1 bank … +1 bank).
 */
export function basinGeometry(body: WaterBody): THREE.BufferGeometry {
  const hx = body.radiusX + BASIN_FEATHER + 0.5, hz = body.radiusZ + BASIN_FEATHER + 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    body.x - hx, body.level, body.z - hz, body.x + hx, body.level, body.z - hz,
    body.x - hx, body.level, body.z + hz, body.x + hx, body.level, body.z + hz,
  ], 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Lateral columns across a course: enough for the bank slowdown to read, few enough to stay cheap. */
export const REACH_COLUMNS = 4;

export function reachGeometry(reach: WaterReach): THREE.BufferGeometry {
  const pts = reach.points;
  if (pts.length < 2) throw new RangeError(`Course ${reach.id} needs at least two points`);
  const positions: number[] = [], flows: number[] = [], index: number[] = [];
  const across = REACH_COLUMNS + 1;
  pts.forEach(point => {
    if (![point.position[0], point.position[1], point.level, point.width].every(Number.isFinite) || !(point.width > 0))
      throw new RangeError(`Course ${reach.id} has an unusable point`);
    const [tx, tz] = point.tangent, half = point.width / 2 + REACH_MARGIN;
    for (let c = 0; c < across; c++) {
      const lateral = (c / REACH_COLUMNS) * 2 - 1;
      // Normal to the left of the flow: (−tz, tx).
      positions.push(point.position[0] - tz * lateral * half, point.level, point.position[1] + tx * lateral * half);
      flows.push(point.flow[0], point.flow[1], lateral);
    }
  });
  for (let i = 1; i < pts.length; i++) for (let c = 0; c < REACH_COLUMNS; c++) {
    const a = (i - 1) * across + c, b = a + 1, d = i * across + c, e = d + 1;
    index.push(a, b, d, b, e, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 3));
  geometry.setIndex(index);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
