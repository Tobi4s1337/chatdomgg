import { LandIndex, LATTICE, latticePoint, Occupancy, type LandRing, type RealmCircle } from './slots';

/** The immutable geometry needed by both the search service and the browser's live dabs. */
export interface PencilWorld {
  coordScale: number;
  coasts: readonly { region: number; points: readonly number[] }[];
  realms: readonly RealmCircle[];
  lattice: { id: string; hamletRadius: number; shore: number; gap: number };
}

/** Holding coordinates and radius are in world units, including withheld holdings' reserved ground. */
export interface PencilHolding { x: number; y: number; r: number }
export interface PencilPoint { x: number; y: number }
export interface PencilRegionPlaces {
  /** First eight SHA-256 bytes, as sixteen hexadecimal characters; realm is already resolved by realmFor. */
  place(channelHash: string, realmIndex: number): PencilPoint | null;
}
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** The existing dab target: an area-uniform point inside 85% of its realm circle, before snapping to actual land. */
export function pencilTarget(channelHash: string, realm: RealmCircle): PencilPoint {
  const a = Number.parseInt(channelHash.slice(0, 8), 16) / 0x1_0000_0000;
  const b = Number.parseInt(channelHash.slice(8, 16), 16) / 0x1_0000_0000;
  const angle = a * Math.PI * 2;
  const radius = Math.sqrt(b) * realm.r * 0.85;
  return { x: realm.x + Math.cos(angle) * radius, y: realm.y + Math.sin(angle) * radius };
}

/**
 * Build once per frozen world; build each region's occupancy once after all its holdings arrive. Lookups use the
 * cartography's coast/realm index and hex-1 lattice, never a live frame, dab order, username or stored assignment.
 *
 * Different hashes may choose the same provisional slot. Without a permanent claim, reserving that slot for one
 * of them would move another channel when the live set changes. No temporary point is added to occupancy here.
 */
export class PencilPlaces {
  private readonly land: LandIndex;
  private readonly realms: Map<number, RealmCircle>;
  private readonly bounds = new Map<number, Bounds>();
  private readonly hamletRadius: number;
  private readonly shore: number;
  private readonly gap: number;

  constructor(world: PencilWorld, decodedRings?: readonly LandRing[]) {
    if (world.lattice.id !== LATTICE.id || world.coordScale !== LATTICE.scale) throw new Error('Unsupported pencil lattice.');
    this.hamletRadius = world.lattice.hamletRadius;
    this.shore = world.lattice.shore;
    this.gap = world.lattice.gap;
    const scale = world.coordScale;
    const circles = world.realms.map(realm => ({ ...realm, x: realm.x / scale, y: realm.y / scale, r: realm.r / scale }));
    this.realms = new Map(circles.map(realm => [realm.index, realm]));
    const rings = decodedRings ?? world.coasts.map(coast => {
      const points = new Float64Array(coast.points.length);
      let x = 0;
      let y = 0;
      for (let p = 0; p < points.length; p += 2) {
        x += coast.points[p]!;
        y += coast.points[p + 1]!;
        points[p] = x / scale;
        points[p + 1] = y / scale;
      }
      return { region: coast.region, points };
    });
    this.land = new LandIndex(rings, circles);
    for (const ring of rings) {
      const bounds = this.bounds.get(ring.region) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let p = 0; p < ring.points.length; p += 2) {
        bounds.minX = Math.min(bounds.minX, ring.points[p]!);
        bounds.minY = Math.min(bounds.minY, ring.points[p + 1]!);
        bounds.maxX = Math.max(bounds.maxX, ring.points[p]!);
        bounds.maxY = Math.max(bounds.maxY, ring.points[p + 1]!);
      }
      this.bounds.set(ring.region, bounds);
    }
  }

  /** Supply the complete immutable holdings of this region, in any order. This snapshots their numeric geometry. */
  forRegion(region: number, holdings: Iterable<PencilHolding>): PencilRegionPlaces {
    const occupancy = new Occupancy(this.gap);
    for (const holding of holdings) occupancy.add(holding.x, holding.y, holding.r);
    const bounds = this.bounds.get(region);
    // Empty realms need only one exhaustive check, even when many channels ask for the same overflow isle.
    const empty = new Set<number>();
    return {
      place: (channelHash, realmIndex) => {
        const realm = this.realms.get(realmIndex);
        if (!realm || realm.region !== region || !bounds || empty.has(realmIndex) || !/^[a-f0-9]{16}$/i.test(channelHash)) return null;
        const target = pencilTarget(channelHash, realm);
        const point = this.nearest(occupancy, realm, target, bounds);
        if (!point) empty.add(realmIndex);
        return point;
      },
    };
  }

  private nearest(occupancy: Occupancy, realm: RealmCircle, target: PencilPoint, bounds: Bounds): PencilPoint | null {
    // The drawn coast can extend beyond its realm circle. Search all the region's land before declaring it full.
    const reach = Math.hypot(Math.max(Math.abs(bounds.minX - target.x), Math.abs(bounds.maxX - target.x)),
      Math.max(Math.abs(bounds.minY - target.y), Math.abs(bounds.maxY - target.y))) + 1e-9;
    const clearance = this.hamletRadius + this.shore;
    let inner = -1;
    for (let radius = Math.min(3, reach); ; radius = Math.min(reach, radius * 2)) {
      const candidates: { i: number; j: number; x: number; y: number; d: number }[] = [];
      const j0 = Math.ceil(Math.max(target.y - radius, bounds.minY) * LATTICE.scale / LATTICE.rowY);
      const j1 = Math.floor(Math.min(target.y + radius, bounds.maxY) * LATTICE.scale / LATTICE.rowY);
      for (let j = j0; j <= j1; j++) {
        const offset = (j & 1) * LATTICE.pitchX / 2;
        const i0 = Math.ceil((Math.max(target.x - radius, bounds.minX) * LATTICE.scale - offset) / LATTICE.pitchX);
        const i1 = Math.floor((Math.min(target.x + radius, bounds.maxX) * LATTICE.scale - offset) / LATTICE.pitchX);
        for (let i = i0; i <= i1; i++) {
          const p = latticePoint(i, j);
          const d = Math.hypot(p.x - target.x, p.y - target.y);
          if (d <= radius && d > inner) candidates.push({ ...p, d });
        }
      }
      candidates.sort((a, b) => a.d - b.d || a.j - b.j || a.i - b.i);
      for (const p of candidates) {
        if (!occupancy.fits(p.x, p.y, this.hamletRadius)) continue;
        if (this.land.realmAt(p.x, p.y) !== realm.index) continue;
        if (this.land.distanceToCoast(p.x, p.y, clearance) < clearance) continue;
        return { x: p.x, y: p.y };
      }
      if (radius >= reach) return null;
      inner = radius;
    }
  }
}
