import type { Vec3 } from '@chatdom/shared';
import { expandBounds, pointBounds, polygonDistance, rectangleDistance, segmentProjection, SpatialIndex, transformCardinalPoint } from '../../../settlement/geometry';
import type { BoundsXZ, PublicSquare, SettlementPlan, StreetEdge, XZ } from '../../../settlement/types';

/** How far the lot and street indexes answer exactly; beyond it a distance query reports this reach. */
const REACH = 16;

export interface SiteLot { readonly id: string; readonly lot: BoundsXZ; readonly home: boolean }
export interface Corridor {
  readonly street: StreetEdge;
  readonly a: Vec3;
  readonly b: Vec3;
  /** Half the street's width plus its verge: nothing solid stands closer to the centre line below headroom. */
  readonly half: number;
}

/**
 * Everything a town wall must keep clear of, indexed once per plan: every lot (home or reserved), the market, the
 * courts and the castle court, each castle module's footprint, each street's width-plus-verge corridor, the waters and
 * the physical region. Shared by the ring planner and by the voxel carving, so the two can never disagree.
 */
export class WallSite {
  readonly lots: readonly SiteLot[];
  readonly squares: readonly PublicSquare[];
  readonly modules: readonly BoundsXZ[];
  readonly castle: BoundsXZ;
  readonly streets: readonly StreetEdge[];
  private readonly lotIndex = new SpatialIndex<SiteLot>(16);
  private readonly corridorIndex = new SpatialIndex<Corridor>(16);
  private readonly squareBounds: readonly BoundsXZ[];

  constructor(readonly plan: SettlementPlan, readonly region: BoundsXZ, readonly water: (x: number, z: number) => number | null,
    readonly ground: (x: number, z: number) => number) {
    const homes = new Set(plan.homes.map(home => home.id)), lots: SiteLot[] = [], seen = new Set<string>();
    for (const plot of [...plan.homes, ...plan.reservations]) {
      if (seen.has(plot.id)) continue;
      seen.add(plot.id);
      const lot = { minX: plot.lot.minX, maxX: plot.lot.maxX, minZ: plot.lot.minZ, maxZ: plot.lot.maxZ };
      const entry = { id: plot.id, lot, home: homes.has(plot.id) };
      lots.push(entry); this.lotIndex.add(expandBounds(lot, REACH), entry);
    }
    this.lots = lots;
    this.squares = [plan.market, ...plan.courts, plan.castle.court];
    this.squareBounds = this.squares.map(square => pointBounds(square.boundary));
    this.modules = plan.castle.modules.map(module => {
      const corners: XZ[] = [];
      for (const x of [0, module.size[0]]) for (const z of [0, module.size[2]]) {
        const p = transformCardinalPoint(module.position, module.rotation, [x, 0, z]);
        corners.push([p[0], p[2]]);
      }
      return pointBounds(corners);
    });
    this.castle = plan.castle.bounds;
    this.streets = plan.streets;
    for (const street of plan.streets) {
      const half = street.width / 2 + street.verge;
      for (let i = 1; i < street.points.length; i++) {
        const a = street.points[i - 1]!, b = street.points[i]!;
        this.corridorIndex.add(expandBounds(pointBounds([[a[0], a[2]], [b[0], b[2]]]), half + REACH), { street, a, b, half });
      }
    }
  }

  /** Signed distance to the nearest lot passing `filter` (negative inside), capped at the index reach. */
  lotDistance(x: number, z: number, filter?: (lot: SiteLot) => boolean): number {
    let best = REACH;
    for (const entry of this.lotIndex.at(x, z)) if (!filter || filter(entry)) best = Math.min(best, rectangleDistance(entry.lot, x, z));
    return best;
  }
  nearLots(x: number, z: number): readonly SiteLot[] { return this.lotIndex.at(x, z); }

  squareDistance(x: number, z: number, filter?: (square: PublicSquare) => boolean): number {
    let best = Infinity;
    this.squares.forEach((square, i) => {
      if (filter && !filter(square)) return;
      if (rectangleDistance(this.squareBounds[i]!, x, z) > REACH) return;
      best = Math.min(best, polygonDistance(square.boundary, x, z));
    });
    return best;
  }

  moduleDistance(x: number, z: number): number {
    let best = Infinity;
    for (const module of this.modules) best = Math.min(best, rectangleDistance(module, x, z));
    return best;
  }

  /** Distance to the region's edge, negative outside. */
  regionDistance(x: number, z: number): number {
    const r = this.region;
    return Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z);
  }

  /** Corridors whose clear zone, padded by `pad`, contains (x, z), with the street's surface height there. */
  corridorsAt(x: number, z: number, pad: number): { corridor: Corridor; y: number; distance: number }[] {
    const hits: { corridor: Corridor; y: number; distance: number }[] = [];
    for (const corridor of this.corridorIndex.at(x, z)) {
      const p = segmentProjection([corridor.a[0], corridor.a[2]], [corridor.b[0], corridor.b[2]], x, z);
      if (p.distance < corridor.half + pad) hits.push({ corridor, y: corridor.a[1] + (corridor.b[1] - corridor.a[1]) * p.t, distance: p.distance });
    }
    return hits;
  }

  /** Corridor segments near (x, z), within `reach` ≤ REACH of their clear zone. */
  corridorsNear(x: number, z: number): readonly Corridor[] { return this.corridorIndex.at(x, z); }

  /**
   * What may stand in the column at (x, z): `-Infinity` (anything), a height in metres below which nothing solid
   * may stand (a street's clear corridor: headroom over its surface), or `Infinity` (nothing at all).
   * `clearance` pads every footprint so a column's whole quarter-metre cell stays out.
   */
  forbiddenBelow(x: number, z: number, headroom: number, clearance: number): number {
    if (this.regionDistance(x, z) < 2 + clearance) return Infinity;
    for (const entry of this.lotIndex.at(x, z)) if (rectangleDistance(entry.lot, x, z) < clearance) return Infinity;
    for (let i = 0; i < this.squares.length; i++) {
      if (rectangleDistance(this.squareBounds[i]!, x, z) >= clearance) continue;
      if (polygonDistance(this.squares[i]!.boundary, x, z) < clearance) return Infinity;
    }
    if (this.moduleDistance(x, z) < clearance) return Infinity;
    if (this.water(x, z) !== null) return Infinity;
    let below = -Infinity;
    for (const hit of this.corridorsAt(x, z, clearance)) below = Math.max(below, Math.max(hit.y, this.ground(x, z)) + headroom);
    return below;
  }
}
