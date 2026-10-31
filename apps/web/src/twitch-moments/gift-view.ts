import * as THREE from 'three';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { CELL, type BannerKit } from './banner';
import { cartPose, GIFT_LIMITS, parcelPose } from './choreography';
import type { CartFrame, MomentFrame, ParcelFrame } from './controller';
import {
  CANOPY_CELLS, CART_CELLS, PARCEL_CELLS, PONY_CELLS, canopyBlueprint, cartBlueprint, parcelBlueprint, ponyBlueprint, ponyLegBlueprint, ponyTailBlueprint,
  wheelBlueprint, type GiftTier, type SealKind,
} from './gift-art';
import type { GiftDestination } from './gift-beat';

/** A supplied doorstep: where a parcel settles, and which way the door faces. */
export interface DoorAnchor { readonly doorstep: Vec3; readonly normal: Vec3; readonly right: Vec3 }
/** A supplied public place: its ground point and the direction a shot of it looks from. */
export interface PlaceAnchor { readonly position: Vec3; readonly facing: Vec3 }
/** The cart's real street route: in from the gate to its stop, and on out. Both polylines are on the ground. */
export interface GiftRoute { readonly inbound: readonly Vec3[]; readonly outbound: readonly Vec3[] }

export interface GiftLayerHost {
  readonly kit: BannerKit;
  door(slot: number): DoorAnchor | null;
  place(place: 'market' | 'gate'): PlaceAnchor | null;
  route(): GiftRoute | null;
  mesh(blueprint: VoxelBlueprint, offset: THREE.Vector3): THREE.Mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const cells = (x: number, y: number, z: number) => new THREE.Vector3(x * CELL, y * CELL, z * CELL);
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

export function giftBlueprints(kit: BannerKit): VoxelBlueprint[] {
  const tiers: GiftTier[] = ['1', '2', '3'], seals: SealKind[] = ['named', 'friend', 'forward'];
  return [...tiers.flatMap(t => seals.map(s => parcelBlueprint(t, s, kit))), canopyBlueprint(kit), cartBlueprint(kit), wheelBlueprint(kit), ponyBlueprint(kit),
    ponyLegBlueprint(kit), ponyTailBlueprint(kit)];
}

/** A polyline sampled by arc length, extended straight past either end so a pony can lead a cart off the map edge. */
class Path {
  private readonly points: THREE.Vector3[];
  private readonly lengths: number[] = [0];
  constructor(points: readonly Vec3[]) {
    this.points = points.map(v3);
    for (let i = 1; i < this.points.length; i++) this.lengths.push(this.lengths[i - 1]! + this.points[i]!.distanceTo(this.points[i - 1]!));
  }
  get length() { return this.lengths.at(-1)!; }
  at(distance: number): { position: THREE.Vector3; tangent: THREE.Vector3 } {
    const n = this.points.length;
    if (n === 1) return { position: this.points[0]!.clone(), tangent: new THREE.Vector3(1, 0, 0) };
    let i = 1;
    while (i < n - 1 && this.lengths[i]! < distance) i++;
    const a = this.points[i - 1]!, b = this.points[i]!, span = this.lengths[i]! - this.lengths[i - 1]!;
    const tangent = b.clone().sub(a).setY(0).normalize();
    const k = span > 0 ? (distance - this.lengths[i - 1]!) / span : 0;
    return { position: a.clone().lerp(b, k), tangent };
  }
}

interface ParcelObject { readonly group: THREE.Group; readonly body: THREE.Mesh; readonly canopy: THREE.Group; readonly blueprint: string }
interface CartObject {
  readonly group: THREE.Group; readonly wheels: THREE.Group[]; readonly pony: THREE.Group; readonly legs: THREE.Group[]; readonly tail: THREE.Group;
  readonly load: THREE.Mesh[]; readonly blueprint: string;
}

/**
 * Parcels, canopies and the gift cart. Every object is keyed by its public parcel or beat key and removed the
 * frame it leaves; pools are bounded by the controller's own caps.
 */
export function createGiftLayer(root: THREE.Group, host: GiftLayerHost) {
  const layer = new THREE.Group();
  layer.name = 'gifts';
  root.add(layer);
  const parcels = new Map<string, ParcelObject>(), carts = new Map<string, CartObject>();
  /** Stable places at each destination, first come first placed, so a parcel never hops when its neighbour lands. */
  const spots = new Map<string, Map<string, number>>();
  let routes: { inbound: Path; outbound: Path } | null | undefined;

  const paths = () => {
    if (routes === undefined) {
      const route = host.route();
      routes = route && route.inbound.length >= 2 && route.outbound.length >= 2 ? { inbound: new Path(route.inbound), outbound: new Path(route.outbound) } : null;
    }
    return routes;
  };
  /** The cart's stop: the end of its inbound route, or the supplied market when no route is supplied. */
  const stop = () => { const r = paths(); return r ? r.inbound.at(r.inbound.length).position : (() => { const m = host.place('market'); return m ? v3(m.position) : null; })(); };

  const destKey = (to: GiftDestination) => (to.kind === 'home' ? `home:${to.slot}` : 'gate');
  function spotIndex(to: GiftDestination, key: string): number {
    const id = destKey(to);
    let map = spots.get(id);
    if (!map) { map = new Map(); spots.set(id, map); }
    let index = map.get(key);
    if (index === undefined) { const used = new Set(map.values()); index = 0; while (used.has(index)) index++; map.set(key, index); }
    return index;
  }

  /** Where a parcel rests and which way its seal faces; null when the destination has no supplied anchor. */
  function restingPlace(to: GiftDestination, key: string): { position: THREE.Vector3; facing: THREE.Vector3 } | null {
    const i = spotIndex(to, key);
    if (to.kind === 'home') {
      const door = host.door(to.slot);
      if (!door) return null;
      const normal = v3(door.normal), right = v3(door.right);
      // Beside the door, never on its threshold: right, left, right, left, then a second layer on top.
      const side = i % 2 === 0 ? 1 : -1, column = Math.floor((i % 8) / 2), layerUp = Math.floor(i / 8);
      const position = v3(door.doorstep).addScaledVector(normal, 0.42 + (column % 2) * 0.3).addScaledVector(right, side * (0.78 + column * 0.42))
        .addScaledVector(UP, layerUp * PARCEL_CELLS.top * CELL);
      return { position, facing: normal };
    }
    const gate = host.place('gate');
    if (!gate) return null;
    // At the gate the welcomed gifts wait in a shallow arc, facing the road in.
    const facing = v3(gate.facing).setY(0).normalize(), across = new THREE.Vector3().crossVectors(UP, facing).normalize();
    const ring = Math.floor(i / 7), k = (i % 7) - 3;
    const position = v3(gate.position).addScaledVector(across, k * 0.62).addScaledVector(facing, 0.6 + ring * 0.55 - Math.abs(k) * 0.08);
    return { position, facing };
  }

  function buildParcel(frame: ParcelFrame): ParcelObject {
    const group = new THREE.Group(), canopy = new THREE.Group(), id = parcelBlueprint(frame.tier, frame.seal, host.kit).id;
    const body = host.mesh(parcelBlueprint(frame.tier, frame.seal, host.kit), cells(-PARCEL_CELLS.pivot[0], 0, -PARCEL_CELLS.pivot[2]));
    canopy.add(host.mesh(canopyBlueprint(host.kit), cells(-CANOPY_CELLS.pivot[0], 0, -CANOPY_CELLS.pivot[2])));
    canopy.position.y = PARCEL_CELLS.top * CELL;
    group.add(body, canopy);
    layer.add(group);
    return { group, body, canopy, blueprint: id };
  }

  function poseParcel(object: ParcelObject, frame: ParcelFrame): boolean {
    const rest = restingPlace(frame.to, frame.key);
    if (!rest) return false;
    const yaw = Math.atan2(rest.facing.x, rest.facing.z);
    const { group, body, canopy } = object;
    if (frame.elapsed === null) {
      group.position.copy(rest.position); group.rotation.set(0, yaw, 0);
      body.scale.set(1, 1, 1); canopy.visible = false;
      return true;
    }
    const from = frame.fromSky ? rest.position : stop()?.add(new THREE.Vector3(0, 0.7, 0)) ?? null;
    if (!from) return false;
    const distance = from.distanceTo(rest.position);
    const pose = parcelPose(frame.elapsed, frame.flight, frame.fromSky, frame.fromSky ? 7.5 : Math.min(11, 4.5 + distance * 0.16));
    group.position.copy(from).lerp(rest.position, pose.travel).addScaledVector(UP, pose.height);
    // Hanging from its canopy the parcel sways across its direction of travel and turns slowly to face its door.
    group.rotation.set(pose.sway, yaw + (1 - pose.travel) * 0.6, pose.sway * 0.5, 'YXZ');
    const squash = pose.squash;
    body.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
    canopy.visible = pose.canopy > 0.02;
    // Folding away it lifts off the parcel and shrinks, as if its cords were let go.
    canopy.scale.set(0.35 + 0.65 * pose.canopy, 0.6 + 0.4 * pose.canopy, 0.35 + 0.65 * pose.canopy);
    canopy.position.y = PARCEL_CELLS.top * CELL * squash + (pose.phase === 'settle' || pose.phase === 'hold' ? (1 - pose.canopy) * 1.6 : 0);
    canopy.rotation.set(-pose.sway * 0.6, 0, 0);
    return true;
  }

  function buildCart(frame: CartFrame): CartObject {
    const group = new THREE.Group(), [px, , pz] = CART_CELLS.pivot;
    const parcel = parcelBlueprint(frame.tier, frame.seal, host.kit);
    group.add(host.mesh(cartBlueprint(host.kit), cells(-px, 0, -pz)));
    const wheels = CART_CELLS.wheels.map(([x, y, z]) => {
      const wheel = new THREE.Group();
      wheel.position.copy(cells(x - px, y, z + 0.5 - pz));
      wheel.add(host.mesh(wheelBlueprint(host.kit), cells(-3.5, -3.5, -0.5)));
      group.add(wheel);
      return wheel;
    });
    const load = CART_CELLS.load.map(([x, y, z]) => {
      const mesh = host.mesh(parcel, cells(x - px - PARCEL_CELLS.pivot[0], y, z - pz - PARCEL_CELLS.pivot[2]));
      group.add(mesh);
      return mesh;
    });
    const pony = new THREE.Group(), [qx, , qz] = PONY_CELLS.pivot;
    pony.position.copy(cells(CART_CELLS.pony[0] - px, 0, CART_CELLS.pony[2] - pz));
    pony.add(host.mesh(ponyBlueprint(host.kit), cells(-qx, 0, -qz)));
    const legs = PONY_CELLS.legs.map(([x, y, z]) => {
      const leg = new THREE.Group();
      leg.position.copy(cells(x - qx, y, z - qz));
      leg.add(host.mesh(ponyLegBlueprint(host.kit), cells(-1, -6, -0.5)));
      pony.add(leg);
      return leg;
    });
    const tail = new THREE.Group();
    tail.position.copy(cells(PONY_CELLS.tail[0] - qx, PONY_CELLS.tail[1], PONY_CELLS.tail[2] - qz));
    tail.add(host.mesh(ponyTailBlueprint(host.kit), cells(-0.5, -5, -0.5)));
    pony.add(tail);
    group.add(pony);
    layer.add(group);
    return { group, wheels, pony, legs, tail, load, blueprint: parcel.id };
  }

  function poseCart(object: CartObject, frame: CartFrame): boolean {
    const r = paths();
    const pose = cartPose(frame.t, frame.departAt, r ? r.inbound.length : 0);
    let place: { position: THREE.Vector3; tangent: THREE.Vector3 };
    if (r) {
      // Travel 0..1 is the inbound street, 1..2 the outbound one; the pony leads by its own length.
      place = pose.travel <= 1 ? r.inbound.at(pose.travel * r.inbound.length) : r.outbound.at((pose.travel - 1) * r.outbound.length);
    } else {
      const market = host.place('market');
      if (!market) return false;
      place = { position: v3(market.position), tangent: new THREE.Vector3().crossVectors(v3(market.facing), UP).normalize() };
    }
    object.group.position.copy(place.position);
    object.group.rotation.set(0, Math.atan2(-place.tangent.z, place.tangent.x), 0);
    object.group.visible = pose.opacity > 0.04;
    for (const wheel of object.wheels) wheel.rotation.z = r ? pose.wheel : 0;
    const stride = r ? pose.stride : 0, step = pose.gait * Math.PI * 2;
    // A trot: diagonal pairs swing together, the body bobbing twice per stride.
    object.legs.forEach((leg, i) => { leg.rotation.z = Math.sin(step + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.42 * stride; });
    object.pony.position.y = Math.abs(Math.sin(step)) * 0.035 * stride;
    object.tail.rotation.x = Math.sin(frame.t / 1000 * 2.1) * (0.12 + 0.18 * stride);
    object.load.forEach((mesh, i) => { mesh.visible = i < frame.load; });
    return true;
  }

  function drop(map: Map<string, { group: THREE.Group }>, key: string): void {
    const object = map.get(key);
    if (!object) return;
    layer.remove(object.group);
    map.delete(key);
  }

  return {
    blueprints: () => giftBlueprints(host.kit),
    apply(frame: MomentFrame): void {
      const seen = new Set<string>();
      for (const p of frame.parcels.slice(0, GIFT_LIMITS.flights + GIFT_LIMITS.resting)) {
        let object = parcels.get(p.key);
        if (object && object.blueprint !== parcelBlueprint(p.tier, p.seal, host.kit).id) { drop(parcels, p.key); object = undefined; }
        object ??= buildParcel(p);
        parcels.set(p.key, object);
        object.group.visible = poseParcel(object, p);
        seen.add(p.key);
      }
      for (const key of [...parcels.keys()]) if (!seen.has(key)) drop(parcels, key);
      for (const map of spots.values()) for (const key of [...map.keys()]) if (!seen.has(key)) map.delete(key);
      const live = new Set<string>();
      for (const c of frame.carts) {
        let object = carts.get(c.id);
        if (object && object.blueprint !== parcelBlueprint(c.tier, c.seal, host.kit).id) { drop(carts, c.id); object = undefined; }
        object ??= buildCart(c);
        carts.set(c.id, object);
        if (!poseCart(object, c)) object.group.visible = false;
        live.add(c.id);
      }
      for (const id of [...carts.keys()]) if (!live.has(id)) drop(carts, id);
    },
    /** World point of a parcel's destination, for captions and shots. */
    destination(to: GiftDestination): THREE.Vector3 | null {
      if (to.kind === 'home') { const door = host.door(to.slot); return door ? v3(door.doorstep) : null; }
      const gate = host.place('gate');
      return gate ? v3(gate.position) : null;
    },
    /** The cart's stop and the direction of its street there, for the gathering shot. */
    stop(): { position: THREE.Vector3; tangent: THREE.Vector3 } | null {
      const r = paths();
      if (r) return r.inbound.at(r.inbound.length);
      const market = host.place('market');
      return market ? { position: v3(market.position), tangent: new THREE.Vector3().crossVectors(v3(market.facing), UP).normalize() } : null;
    },
    stats: () => ({ parcels: parcels.size, carts: carts.size }),
    clear(): void {
      for (const key of [...parcels.keys()]) drop(parcels, key);
      for (const key of [...carts.keys()]) drop(carts, key);
      spots.clear();
    },
    dispose(): void { this.clear(); root.remove(layer); },
  };
}
export type GiftLayer = ReturnType<typeof createGiftLayer>;
