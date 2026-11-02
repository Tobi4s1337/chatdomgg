import type * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import type { PlayMapView, PlayWayHomeLights } from './host';
import { createLanternTrail, type LanternTrail } from './lantern/trail';
import { mapPeople, type FriendAuthority, type MapWalker } from './map/people';
import { routeHome, streetGraph, trailStops, type HomeRoute } from './map/route';
import { createTownMapCache, homeDoor } from './map/town';

/**
 * The map and the lantern path home for one walk (PL12). The walk lends it the founded plan, your home, where you
 * stand and the walkers drawn now; it answers the map view the HUD and the ledger read, and lights the trail.
 *
 * - The trail lights once on arrival, when the room has told you your home and you stand well away from it, and
 *   again whenever you ask (the ledger's Way home page, the big map).
 * - While lit, wandering well off the route for a while lights a fresh one from where you are.
 * - It goes out at your door, and as you step inside. Your door's plaque glows as you come close either way.
 */

export interface WayHomeRuntimeOptions {
  readonly plan: SettlementPlan;
  readonly scene: THREE.Scene;
  /** The drawn ground at (x, z), or null; lanterns stand on it. */
  readonly groundAt?: (x: number, z: number) => number | null;
  readonly reducedMotion: () => boolean;
  /** Your home's plot here, as the room says, or null. */
  readonly ownedPlotId: () => string | null;
  /** True while you are inside your own home. */
  readonly inside: () => boolean;
  /** Your feet (the physics pose), or null before the room placed you. */
  readonly feet: () => Vec3 | null;
  /** Everyone drawn now, you included. Only you and mutual friends ever reach the map. */
  readonly walkers: () => readonly MapWalker[];
  /** The friend authority, or null (no one but you on the map). */
  readonly friends: () => FriendAuthority | null;
  /** The camera's heading (radians, 0 looks along +Z), or null. */
  readonly heading: () => number | null;
  readonly hour: () => number;
  /** Lights on arrival. Default true; the stills turn it off to stage their own. */
  readonly lightOnArrival?: boolean;
}

export interface WayHomeRuntime {
  map(): PlayMapView | null;
  readonly lights: PlayWayHomeLights;
  /** Once per drawn frame, before the render. */
  frame(now: number): void;
  readonly trail: LanternTrail;
  dispose(): void;
}

/** Arrival lights the way only from further than this; nearer, your door is in sight. */
export const ARRIVAL_LIGHT_METRES = 25;
/** Further than this from the lit route for `STRAY_MS` lights a fresh one from where you are. */
export const STRAY_METRES = 10;
export const STRAY_MS = 2500;
/** The route is worked out again once you have walked this far from where it was last worked out. */
const REROUTE_METRES = 3;

function distanceToPolyline(points: readonly Vec3[], x: number, z: number): number {
  let low = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, dx = b[0] - a[0], dz = b[2] - a[2], span = dx * dx + dz * dz;
    const t = span > 1e-9 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / span)) : 0;
    low = Math.min(low, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t));
  }
  return low;
}

let active: WayHomeRuntime | null = null;
/** The way home of the walk on this page, or null: for the dev stills, which stage the trail from where they stand. */
export function activeWayHome(): WayHomeRuntime | null { return active; }

export function createWayHomeRuntime(options: WayHomeRuntimeOptions): WayHomeRuntime {
  const { plan } = options;
  const town = createTownMapCache()(plan);
  const graph = streetGraph(plan);
  const trail = createLanternTrail({ scene: options.scene, reducedMotion: options.reducedMotion,
    ...(options.groundAt ? { groundAt: options.groundAt } : {}) });
  const listeners = new Set<(lit: boolean) => void>();
  let route: HomeRoute | null = null, routedAt: Vec3 | null = null, routedFor: string | null = null;
  let litRoute: HomeRoute | null = null, arrivalDone = options.lightOnArrival === false, strayingSince: number | null = null;
  let doorFor: string | null = null, wasLit = false, disposed = false;

  const announce = () => {
    if (trail.lit === wasLit) return;
    wasLit = trail.lit;
    for (const listener of [...listeners]) { try { listener(wasLit); } catch (error) { console.error('A way home listener failed', error); } }
  };

  const currentRoute = (): HomeRoute | null => {
    const plot = options.ownedPlotId(), feet = options.feet();
    if (!plot || !feet || options.inside()) { route = null; routedAt = null; routedFor = plot; return null; }
    if (route && routedFor === plot && routedAt && Math.hypot(feet[0] - routedAt[0], feet[2] - routedAt[2]) < REROUTE_METRES) return route;
    route = routeHome(plan, graph, feet, plot);
    routedAt = feet; routedFor = plot;
    return route;
  };

  const setDoor = (plot: string | null) => {
    if (plot === doorFor) return;
    doorFor = plot;
    const home = plot ? plan.homes.find(candidate => candidate.id === plot) : undefined;
    if (!home) { trail.setDoor(null); return; }
    const door = homeDoor(plan, home);
    // Outward: from the door along its approach, toward the street.
    const approach = plan.streets.find(street => street.id === home.approachId);
    const near = approach?.points.find(point => Math.hypot(point[0] - door[0], point[2] - door[2]) > .5);
    const ox = near ? near[0] - door[0] : 0, oz = near ? near[2] - door[2] : 1, length = Math.hypot(ox, oz) || 1;
    trail.setDoor({ position: door, outward: [ox / length, oz / length] });
  };

  const light = (now: number): boolean => {
    const next = currentRoute();
    if (!next || next.length < 4) return false;
    const stops = trailStops(next);
    if (!stops.length) return false;
    trail.light(stops, now);
    litRoute = next; strayingSince = null;
    announce();
    return true;
  };

  const lights: PlayWayHomeLights = {
    light: () => !disposed && light(performance.now()),
    get lit() { return trail.lit; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };

  const runtime: WayHomeRuntime = {
    trail,
    lights,
    map() {
      if (disposed) return null;
      const plot = options.ownedPlotId(), inside = options.inside();
      return { town, people: mapPeople(options.walkers(), options.friends()), home: plot, inside, route: currentRoute(), view: options.heading() };
    },
    frame(now) {
      if (disposed) return;
      const plot = options.ownedPlotId(), feet = options.feet();
      setDoor(plot);
      if (trail.lit && (options.inside() || !plot)) trail.douse(now);
      if (!arrivalDone && plot && feet) {
        arrivalDone = true;
        const home = plan.homes.find(candidate => candidate.id === plot);
        const door = home ? homeDoor(plan, home) : null;
        if (door && !options.inside() && Math.hypot(door[0] - feet[0], door[2] - feet[2]) > ARRIVAL_LIGHT_METRES) light(now);
      }
      if (trail.lit && litRoute && feet) {
        const off = distanceToPolyline(litRoute.points, feet[0], feet[2]) > STRAY_METRES;
        if (!off) strayingSince = null;
        else if (strayingSince === null) strayingSince = now;
        else if (now - strayingSince > STRAY_MS) light(now);
      }
      trail.frame(now, feet, options.hour());
      announce();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active === runtime) active = null;
      listeners.clear();
      trail.dispose();
    },
  };
  active = runtime;
  return runtime;
}
