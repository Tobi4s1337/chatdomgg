import * as THREE from 'three';
import { MAT } from '@chatdom/content';
import type { WindowHouse } from '@chatdom/render';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { rasterizeBlueprint, voxelIndex } from '@chatdom/voxel';
import { homeLifeAnchors, type SettlementPlan } from '@chatdom/world';
import type { DoorAnchor, GiftRoute, HomeAnchor, SpectaclePlaces, WindowAnchor } from '../../twitch-moments';

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


/** Resolve the highest surviving solid cell, including ordered air cuts, rather than the reserved blueprint extent. */
function highestSolid(house: WindowHouse): Vec3 | null {
  const { boxes } = house.blueprint;
  // Occupancy can change only at a box boundary. A carve can expose the layer
  // immediately below its lower boundary, so include both kinds of boundary.
  const planes = [...new Set(boxes.flatMap(box => [box.from[1] - 1, box.to[1] - 1]).filter(y => y >= 0))].sort((a, b) => b - a);
  const solidAt = (x: number, y: number, z: number) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const box = boxes[i]!;
      if (x >= box.from[0] && x < box.to[0] && y >= box.from[1] && y < box.to[1] && z >= box.from[2] && z < box.to[2]) return box.material !== MAT.air;
    }
    return false;
  };
  for (const y of planes) for (const box of boxes) {
    if (box.material === MAT.air || y < box.from[1] || y >= box.to[1]) continue;
    const cx = Math.floor((box.from[0] + box.to[0] - 1) / 2), cz = Math.floor((box.from[2] + box.to[2] - 1) / 2);
    if (solidAt(cx, y, cz)) return toWorld(house, [cx + .5, y + 1, cz + .5]).toArray();
    for (let z = box.from[2]; z < box.to[2]; z++) for (let x = box.from[0]; x < box.to[0]; x++) {
      if (solidAt(x, y, z)) return toWorld(house, [x + .5, y + 1, z + .5]).toArray();
    }
  }
  return null;
}

/** Only mounted geometry and the adopted public plan provide spectacle locations. */
export function spectaclePlacesOf(plan: SettlementPlan, houses: readonly WindowHouse[], keep?: WindowHouse): SpectaclePlaces {
  const roofs = new Map<number, { house: WindowHouse; point: Vec3 | null }>();
  const roof = (slot: number): Vec3 | null => {
    const house = houses.find(item => item.slot === slot);
    if (!house) { roofs.delete(slot); return null; }
    const cached = roofs.get(slot);
    if (cached?.house === house) return cached.point;
    const point = highestSolid(house); roofs.set(slot, { house, point }); return point;
  };
  let crown: Vec3 | null | undefined;
  const castle = () => {
    if (!keep) return null;
    if (crown === undefined) crown = highestSolid(keep);
    return crown ? { crown, walls: [] } : null;
  };
  const market = plan.nodes.find(node => node.id === plan.market.nodeId)?.position;
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  const centre: Vec3 = [(minX + maxX) / 2, plan.market.elevation, (minZ + maxZ) / 2];
  const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
  return {
    sky: () => ({ centre, radius, ceiling: Math.max(45, radius * .65, (castle()?.crown[1] ?? centre[1]) - centre[1] + 25) }),
    castle,
    plaza: () => market ?? null,
    lair: () => null, track: () => null, bunting: () => [],
    roof, homes: () => houses.map(house => house.slot).filter(slot => roof(slot) !== null),
  };
}
