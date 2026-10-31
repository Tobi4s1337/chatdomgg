import * as THREE from 'three';
import { MAT } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { rasterizeBlueprint, voxelIndex } from '@chatdom/voxel';
import { homeLifeAnchors, type SettlementPlan } from '@chatdom/world';
import type { DoorAnchor, GiftRoute, HomeAnchor, WindowAnchor } from '../../twitch-moments';

const toWorld = (house: WindowHouse, cell: Vec3) => new THREE.Vector3(...cell).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw).add(new THREE.Vector3(...house.position));
const yawed = (house: WindowHouse, x: number, z: number) => new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), house.yaw);

/** Only an actual final-solid portal establishes a doorstep. */
export function doorOf(house: WindowHouse): DoorAnchor | null {
  const door = homeLifeAnchors(house.blueprint).door;
  if (!door) return null;
  return { doorstep: toWorld(house, [(door.from[0] + door.to[0]) / 2, door.from[1], door.to[2] + 3]).toArray(), normal: yawed(house, 0, 1).toArray(), right: yawed(house, 1, 0).toArray() };
}

/** A mount requires an unbroken, window-free final wall and a real doorway. */
export function bannerMount(house: WindowHouse): HomeAnchor | null {
  const door = homeLifeAnchors(house.blueprint).door, doorstep = doorOf(house);
  if (!door || !doorstep) return null;
  const blueprint = house.blueprint, [sx, sy, sz] = blueprint.size, asset = rasterizeBlueprint(blueprint);
  const front = (x: number, y: number) => { for (let z = sz - 1; z >= 0; z--) if (asset.voxels[voxelIndex(x, y, z, blueprint.size)] !== MAT.air) return z; return -1; };
  const doorX = (door.from[0] + door.to[0]) / 2, floor = door.from[1];
  for (const rodY of [floor + 27, floor + 29, floor + 25, floor + 31]) for (const offset of [13, -13, 15, -15, 17, -17, 19, -19, 11, -11]) {
    const centre = Math.round(doorX + offset) + .5, x0 = centre - 7.5;
    if (x0 < 0 || centre + 7.5 > sx || rodY + 3 >= sy || rodY - 16 < 1) continue;
    const wall = front(Math.floor(centre), rodY);
    if (wall < sz * .5) continue;
    let ok = true;
    for (let x = x0; x < centre + 7.5 && ok; x++) for (let y = rodY - 16; y <= rodY + 3 && ok; y++) {
      const z = front(x, y), cloth = x >= centre - 4.5 && x < centre + 4.5 && y < rodY;
      if (z > wall + 1 || (cloth && z < wall - 2)) ok = false;
      if (cloth) for (let d = 0; d <= 3; d++) if (wall - d >= 0 && asset.voxels[voxelIndex(x, y, wall - d, blueprint.size)] === MAT.glass) ok = false;
    }
    for (const plate of [centre - 5.5, centre + 4.5]) for (let y = rodY - 3; y <= rodY + 2 && ok; y++) if (front(plate, y) < wall - 1) ok = false;
    if (!ok) continue;
    return { mount: toWorld(house, [centre, rodY + .5, wall + 1]).toArray(), normal: doorstep.normal, right: doorstep.right, doorstep: doorstep.doorstep };
  }
  return null;
}

export function windowOf(house: WindowHouse): WindowAnchor | null {
  const window = house.blueprint.windows[0];
  if (!window) return null;
  const angle = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 }[window.facing] + house.yaw;
  const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)), right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
  return { centre: toWorld(house, window.centre).addScaledVector(normal, .006).toArray(), normal: normal.toArray(), right: right.toArray(), width: window.width * VOXEL_METRES.build, height: window.height * VOXEL_METRES.build };
}

export function giftRouteOf(layout: SettlementPlan): GiftRoute | null {
  const active = new Set(layout.activeStreetIds), market = layout.market.nodeId;
  const node = new Map(layout.nodes.map(n => [n.id, n]));
  const edges = layout.streets.filter(s => active.has(s.id) && s.kind !== 'approach' && s.kind !== 'trail');
  const length = (points: readonly Vec3[]) => points.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - points[i - 1]![0], p[2] - points[i - 1]![2]) : 0, 0);
  // Shortest road from the market to every junction.
  const best = new Map<string, { distance: number; points: Vec3[] }>([[market, { distance: 0, points: [node.get(market)!.position] }]]);
  const open = [market];
  while (open.length) {
    open.sort((a, b) => best.get(a)!.distance - best.get(b)!.distance);
    const here = open.shift()!, from = best.get(here)!;
    for (const edge of edges) {
      if (edge.from !== here && edge.to !== here) continue;
      const there = edge.from === here ? edge.to : edge.from, points = edge.from === here ? [...edge.points] : [...edge.points].reverse();
      const distance = from.distance + length(points);
      if ((best.get(there)?.distance ?? Infinity) <= distance) continue;
      best.set(there, { distance, points: [...from.points, ...points.slice(1)] });
      if (!open.includes(there)) open.push(there);
    }
  }
  const gate = layout.castle.gateNodeId;
  const entries = [...best.entries()].filter(([id]) => id !== market && id !== gate && best.get(id)!.distance > 30);
  const [, entry] = entries.sort((a, b) => Math.abs(a[1].distance - 55) - Math.abs(b[1].distance - 55))[0] ?? [];
  const castle = best.get(gate);
  if (!entry || !castle) return null;
  // On out up the castle road, as far as the first 60 m of it.
  let run = 0, end = castle.points.length;
  for (let i = 1; i < castle.points.length; i++) { run += Math.hypot(castle.points[i]![0] - castle.points[i - 1]![0], castle.points[i]![2] - castle.points[i - 1]![2]); if (run > 60) { end = i + 1; break; } }
  return { inbound: [...entry.points].reverse(), outbound: castle.points.slice(0, Math.max(2, end)) };
}

