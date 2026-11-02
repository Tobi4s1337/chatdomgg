import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { segmentClear } from '@chatdom/world/interactions';

/*
 * The kingdom host's answers to raid-show's physical questions (raid-show SEAMS §8, §9 and the gate shot): may a
 * lamp stand, a pennant wall bay or a torch post stand here on the adopted floor, and can the director's camera see
 * its subject. Both read the scene's one adopted collision world and its founded ground, never a reconstructed plan,
 * and both say no once the scene that owns that world is gone. No second collision store or raycaster is built.
 */

export interface RaidSupportSite { readonly foot: Vec3; readonly radius: number; readonly height: number }
export interface RaidRegion { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

export interface RaidSupportHost {
  /** The adopted base world (founded placements and floor). Unknown space outside the region is solid. */
  readonly world: CollisionWorld;
  /** The installed, walkable region: founded ground is known only inside it. */
  readonly region: RaidRegion;
  /** The founded ground top at (x, z), or null where none is known. */
  groundAt(x: number, z: number): Vec3 | null;
  /** Standing water depth over the drawn ground, 0 when dry, null when unknown. */
  waterDepth(x: number, z: number): number | null;
  /** False once the adopted world retires (the scene closed or was replaced). */
  live(): boolean;
}

/** The two props raid-show stands (lamp .65 m, wall bay 1.5 m) and the wider visual approach road (1.9 m). */
const WALL_RADIUS = 1, ROAD_RADIUS = 1.5, SAMPLE_SPACING = .5, MAX_RADIUS = 3, MAX_HEIGHT = 8;

const inside = (region: RaidRegion, x: number, z: number) => x >= region.minX && x < region.maxX && z >= region.minZ && z < region.maxZ;

/**
 * Support for a raid prop's footprint. Every half-metre sample inside the footprint must stand on dry founded ground
 * between 2 cm under the foot and the prop's own allowed rise above it (8 cm for a lamp, 18 cm for a wall bay), and
 * nothing solid may overlap the body above its foot. The approach road is a visual road: outside the installed region
 * the caller's own terrain check decides, inside it the same floor and solids rules hold with the road's .9 m rise.
 */
export function createRaidSupport(host: RaidSupportHost): (site: RaidSupportSite) => boolean {
  return site => {
    if (!host.live()) return false;
    const { foot, radius, height } = site;
    if (!Array.isArray(foot) || foot.length !== 3 || !foot.every(Number.isFinite) || !Number.isFinite(radius) || !Number.isFinite(height)
      || radius <= 0 || radius > MAX_RADIUS || height <= 0 || height > MAX_HEIGHT) return false;
    const road = radius > ROAD_RADIUS, rise = road ? .9 : radius > WALL_RADIUS ? .18 : .08;
    const [x, y, z] = foot, region = host.region;
    const minX = x - radius, maxX = x + radius, minZ = z - radius, maxZ = z + radius;
    const whollyInside = minX >= region.minX && maxX <= region.maxX && minZ >= region.minZ && maxZ <= region.maxZ;
    if (!road && !whollyInside) return false;
    const divisions = Math.min(24, Math.max(1, Math.ceil(2 * radius / SAMPLE_SPACING)));
    let sampled = 0;
    for (let ix = 0; ix <= divisions; ix++) for (let iz = 0; iz <= divisions; iz++) {
      // Sample centres just inside the edge, so a footprint flush with a lot line reads its own ground.
      const sx = Math.min(maxX - 1e-3, Math.max(minX + 1e-3, minX + 2 * radius * ix / divisions));
      const sz = Math.min(maxZ - 1e-3, Math.max(minZ + 1e-3, minZ + 2 * radius * iz / divisions));
      if (!inside(region, sx, sz)) continue;
      const top = host.groundAt(sx, sz);
      if (!top || !Number.isFinite(top[1])) return false;
      const water = host.waterDepth(sx, sz);
      if (water === null || water > 0) return false;
      if (top[1] < y - .02 || top[1] > y + rise) return false;
      sampled++;
    }
    if (!sampled) return road;
    // Strict overlap with any solid above the foot. The road's floor may rise .9 m, so its body starts above that.
    const bottom = y + (road ? rise + .1 : radius > WALL_RADIUS ? .25 : .1);
    const box = { min: [Math.max(minX, region.minX + 1e-3), bottom, Math.max(minZ, region.minZ + 1e-3)] as Vec3,
      max: [Math.min(maxX, region.maxX - 1e-3), y + height, Math.min(maxZ, region.maxZ - 1e-3)] as Vec3 };
    if (box.min[1] >= box.max[1]) return true;
    try {
      for (const solid of host.world.query(box)) {
        if (solid.min.every((v, i) => v < box.max[i]!) && solid.max.every((v, i) => v > box.min[i]!)) return false;
      }
    } catch { return false; }
    return host.live();
  };
}

export interface ShotPose { readonly eye: readonly number[]; readonly target: readonly number[]; readonly fov: number }

export interface ShotSightHost {
  readonly world: CollisionWorld;
  readonly region: RaidRegion;
  /** The drawn land height everywhere the camera may stand, including the land beyond the town. */
  height(x: number, z: number): number;
  live(): boolean;
}

/**
 * The director's sightline for a moment shot: the eye stands above the drawn land, the land does not rise between
 * the eye and the subject, and no founded solid (a roof, a wall, a tree trunk) stands in the way inside the walkable
 * region. A solid that holds the subject itself is its own body and does not hide it.
 */
export function createShotSight(host: ShotSightHost): <T extends ShotPose>(pose: T) => T | null {
  return pose => {
    if (!host.live()) return null;
    const eye = pose.eye, target = pose.target;
    if (eye.length !== 3 || target.length !== 3 || ![...eye, ...target].every(Number.isFinite)) return null;
    const [ex, ey, ez] = eye as [number, number, number], [tx, ty, tz] = target as [number, number, number];
    const ground = host.height(ex, ez);
    if (Number.isFinite(ground) && ey < ground + .6) return null;
    const length = Math.hypot(tx - ex, ty - ey, tz - ez);
    if (length < .01) return null;
    // The land: every 2 m up to 2 m short of the subject (the subject often stands on the ground it is seen on).
    const steps = Math.min(400, Math.floor((length - 2) / 2));
    for (let i = 1; i <= steps; i++) {
      const t = i * 2 / length, x = ex + (tx - ex) * t, y = ey + (ty - ey) * t, z = ez + (tz - ez) * t;
      const land = host.height(x, z);
      if (Number.isFinite(land) && land > y + .25) return null;
    }
    // Solids: the part of the line inside the walkable region, where the founded world is known.
    const clipped = clipToRegion([ex, ey, ez], [tx, ty, tz], host.region);
    if (clipped) {
      const [from, to] = clipped;
      try { if (!segmentClear(host.world, from, to)) return null; } catch { return null; }
    }
    return host.live() ? pose : null;
  };
}

/** The segment's part strictly inside the region (shrunk by a millimetre), or null when it misses it. */
export function clipToRegion(a: Vec3, b: Vec3, region: RaidRegion): readonly [Vec3, Vec3] | null {
  const e = 1e-3;
  let low = 0, high = 1;
  for (const [start, end, min, max] of [[a[0], b[0], region.minX + e, region.maxX - e], [a[2], b[2], region.minZ + e, region.maxZ - e]] as const) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-12) { if (start < min || start > max) return null; continue; }
    const u = (min - start) / delta, v = (max - start) / delta;
    low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v));
    if (low > high) return null;
  }
  const at = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // Keep the subject as the segment's end when it lies inside, so its own body is exempt.
  return [at(low), high >= 1 ? [b[0], b[1], b[2]] : at(high)];
}

/**
 * Pennant sight from the current camera: a bay is visible when the line to its cloth is clear at any of three
 * heights (low, middle and high on the bay), through the same sightline as moment shots. The pennants' own stands
 * are not in the adopted world, so they never hide themselves.
 */
export function createSiteVisibility(sight: ReturnType<typeof createShotSight>, eye: () => Vec3):
  (site: { readonly foot: Vec3; readonly height: number; readonly radius?: number }) => boolean {
  return site => {
    if (!site.foot.every(Number.isFinite) || !Number.isFinite(site.height) || site.height <= 0) return false;
    const from = eye();
    return [.3, .6, .9].some(part => sight({ eye: from, target: [site.foot[0], site.foot[1] + site.height * part, site.foot[2]], fov: 45 }) !== null);
  };
}

/**
 * The hooks the kingdom scene offers raid-show's moments, under the option names raid-show's SEAMS asks for
 * (§8 support, native sight, the gate shot). raid-show owns `kingdom/moments/index.ts`; the scene spreads this bundle
 * into its single `createKingdomMoments` call, so the hooks take effect the moment raid-show forwards those options.
 */
export interface RaidMomentHooks {
  readonly raidChatSupport: (site: RaidSupportSite) => boolean;
  readonly raidPennantVisible: (site: { readonly foot: Vec3; readonly height: number; readonly radius?: number }) => boolean;
  readonly validatePose: ReturnType<typeof createShotSight>;
}

export function createRaidMomentHooks(host: RaidSupportHost & { height(x: number, z: number): number; eye(): Vec3 }): RaidMomentHooks {
  const sight = createShotSight(host);
  return { raidChatSupport: createRaidSupport(host), raidPennantVisible: createSiteVisibility(sight, host.eye), validatePose: sight };
}

/**
 * The raid avenue's drawn torch posts as light-field sources (raid-show SEAMS §9: at most twelve, flame 2.2 m above
 * the foot). Reads the additive `raidTorchSites` field of the moments' metrics once raid-show exposes it; until then,
 * and once the gate sleeps, it yields nothing.
 */
export function raidTorchLights(metrics: object | undefined): { position: Vec3; strength: number }[] {
  const sites = metrics && 'raidTorchSites' in metrics ? (metrics as { raidTorchSites?: unknown }).raidTorchSites : undefined;
  if (!Array.isArray(sites)) return [];
  const lights: { position: Vec3; strength: number }[] = [];
  for (const site of sites) {
    const foot = (site as { foot?: unknown } | null)?.foot;
    if (!Array.isArray(foot) || foot.length !== 3 || !foot.every(Number.isFinite)) continue;
    lights.push({ position: [foot[0], foot[1] + 2.2, foot[2]], strength: .85 });
    if (lights.length === 12) break;
  }
  return lights;
}
