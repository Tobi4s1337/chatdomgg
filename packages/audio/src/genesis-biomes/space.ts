import {
  dist, distanceToPolygon, groundAt, insidePolygon, nearestOnPolyline, pointAlong, type Habitat, type SoundScene,
} from './scene';
import type { GenesisListener, Vec3, XZ } from './types';

/** Where something is for the ear: metres away (3-D) and listener-relative pan (-1 left … +1 right). */
export interface Bearing { distance: number; pan: number }

/** The land around the ear, sampled a few times a second. Presence values are 0..1. */
export interface SpaceSample {
  ear: Vec3;
  right: Vec3;
  /** Two points of the shore either side of the nearest, so the sea has width. */
  sea: { near: Bearing; left: Bearing; right: Bearing; arc: number };
  harbour: Bearing;
  river: { near: Bearing; flow: number; rush: Bearing; rushWeight: number; at: XZ };
  forest: { near: Bearing; inside: boolean };
  pass: Bearing;
  landmark: Bearing;
  /** 0 on the beach, 1 high on a ridge: more wind, more sky, less river. */
  altitude: number;
  /** 1 in the open, lower in the forest's shelter and among the houses. */
  exposure: number;
  /** 1 inside the built ground. */
  town: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (low: number, high: number, x: number) => {
  const t = clamp01((x - low) / (high - low));
  return t * t * (3 - 2 * t);
};

export function bearing(listener: GenesisListener, target: Vec3): Bearing {
  const [x, y, z] = listener.position, [rx, ry, rz] = listener.right;
  const dx = target[0] - x, dy = target[1] - y, dz = target[2] - z;
  const distance = Math.hypot(dx, dy, dz), rightLength = Math.hypot(rx, ry, rz);
  // Pan from the horizontal direction only: a bird overhead is not "left" because it is high.
  const flat = Math.hypot(dx, dz);
  const pan = flat > 1e-6 && rightLength > 1e-6 ? (dx * rx + dz * rz) / (flat * Math.hypot(rx, rz) || 1) : 0;
  return { distance, pan: Math.max(-1, Math.min(1, pan * Math.min(1, flat / 3))) };
}

/** A listener the layer can trust: finite numbers, a usable right vector; otherwise the scene's default ear. */
export function resolveListener(scene: SoundScene, listener: GenesisListener | undefined): GenesisListener {
  const ok = (v: Vec3 | undefined) => !!v && v.length === 3 && v.every(Number.isFinite);
  if (listener && ok(listener.position) && ok(listener.right) && Math.hypot(listener.right[0], listener.right[2]) > 1e-6) {
    return { position: [listener.position[0], listener.position[1], listener.position[2]], right: [listener.right[0], listener.right[1], listener.right[2]] };
  }
  return { position: scene.defaultEar, right: [1, 0, 0] };
}

const at3 = (point: XZ, y = 0): Vec3 => [point[0], y, point[1]];

export function sampleSpace(scene: SoundScene, listener: GenesisListener): SpaceSample {
  const ear = listener.position, here: XZ = [ear[0], ear[2]];
  const shore = nearestOnPolyline(scene.shoreline, here);
  const spread = 90;
  const sea = {
    near: bearing(listener, at3(shore.point)),
    left: bearing(listener, at3(pointAlong(scene.shoreline, Math.max(0, shore.arc - spread)))),
    right: bearing(listener, at3(pointAlong(scene.shoreline, Math.min(shore.length, shore.arc + spread)))),
    arc: shore.arc,
  };

  let river = { near: { distance: Infinity, pan: 0 } as Bearing, flow: 0, at: here as XZ };
  let nearest = Infinity;
  for (const stream of scene.streams) {
    const found = nearestOnPolyline(stream.points.map(point => point.position), here);
    if (found.distance >= nearest) continue;
    nearest = found.distance;
    // Flow where the ear meets it: wider water and a steeper fall talk louder.
    let walked = 0, flow = 0.5;
    for (let i = 0; i + 1 < stream.points.length; i++) {
      const a = stream.points[i]!, b = stream.points[i + 1]!, length = Math.max(1, dist(a.position, b.position));
      if (found.arc <= walked + length) {
        const fall = Math.max(0, a.level - b.level) / length;
        flow = clamp01(0.35 + Math.min(1, (a.width + b.width) / 2 / 14) * 0.35 + Math.min(1, fall * 40) * 0.5);
        break;
      }
      walked += length;
    }
    const level = groundAt(scene.hills, found.point);
    river = { near: bearing(listener, [found.point[0], Math.min(level, ear[1]), found.point[1]]), flow, at: found.point };
  }
  for (const water of scene.waters) {
    const d = Math.max(0, dist(water.centre, here) - water.radius);
    if (d < nearest) {
      nearest = d;
      river = { near: { distance: Math.hypot(d, ear[1]), pan: bearing(listener, at3(water.centre)).pan }, flow: 0.3, at: water.centre };
    }
  }
  // The rush: the steepest reach near town, and the meltwater falls under the pass in the mountains.
  const weir = bearing(listener, at3(scene.weir, groundAt(scene.hills, scene.weir)));
  const melt = scene.character === 'mountain-pass' ? bearing(listener, [scene.saddle[0], scene.saddle[1] * 0.5, scene.saddle[2]]) : null;
  const rush = melt && melt.distance < weir.distance ? melt : weir;
  const rushWeight = scene.character === 'river-valley' ? 1 : scene.character === 'mountain-pass' ? 0.9 : 0.5;

  const forestDistance = distanceToPolygon(scene.forest, here);
  const inside = insidePolygon(scene.forest, here);
  const forestPoint = inside ? scene.clearing : nearestOnPolyline([...scene.forest, scene.forest[0] ?? here], here).point;
  const forestBearing = bearing(listener, at3(forestPoint, ear[1]));

  const ground = groundAt(scene.hills, here);
  const height = Math.max(ear[1], ground);
  const altitude = smooth(8, 55, height);
  const { town } = scene;
  const outside = Math.hypot(Math.max(town.minX - here[0], 0, here[0] - town.maxX), Math.max(town.minZ - here[1], 0, here[1] - town.maxZ));
  const inTown = 1 - smooth(0, 35, outside);
  const exposure = clamp01((0.62 + altitude * 0.5) * (inside ? 0.55 : 1 - smooth(0, 40, -forestDistance + 20) * 0.2) * (1 - inTown * 0.18));
  return {
    ear, right: listener.right, sea,
    harbour: bearing(listener, at3(scene.harbour, 1)),
    river: { near: { distance: river.near.distance, pan: river.near.pan }, flow: river.flow, rush, rushWeight, at: river.at },
    forest: { near: { distance: forestDistance, pan: inside ? 0 : forestBearing.pan }, inside },
    pass: bearing(listener, scene.saddle),
    landmark: bearing(listener, at3(scene.landmarkAt, groundAt(scene.hills, scene.landmarkAt) + 6)),
    altitude, exposure, town: inTown,
  };
}

/** How much a habitat is at hand from here (0..1): calls only happen where their place is near enough. */
export function habitatPresence(habitat: Habitat, space: SpaceSample, scene: SoundScene): number {
  const falloff = (d: number, reach: number) => 1 / (1 + (Math.max(0, d) / reach) ** 2);
  switch (habitat) {
    case 'sea': return falloff(space.sea.near.distance, 260);
    case 'shore': return falloff(space.sea.near.distance, 200);
    case 'offshore': return falloff(Math.hypot(scene.buoy[0] - space.ear[0], scene.buoy[1] - space.ear[2]), 520);
    case 'harbour': return falloff(space.harbour.distance, 110);
    case 'river': return falloff(space.river.near.distance, 90);
    case 'forest': return falloff(space.forest.near.distance, 130);
    case 'open': return clamp01(1 - space.town * 0.6) * (space.forest.inside ? 0.3 : 1);
    case 'ridge': return scene.hills.some(hill => hill.height >= 15) ? 0.85 + space.altitude * 0.15 : 0.15;
    case 'pass': return falloff(space.pass.distance, 140);
    case 'town': return space.town;
    case 'landmark': return falloff(space.landmark.distance, 140);
    case 'sky': return 1;
  }
}
