import type { Ring } from '../data/model';

/**
 * Pencil places for small live channels (Atlas.md §8.2): "in the realm of its language and main game, at the free
 * slot nearest a hash of its channel ID". Nothing is stored; a place may wander between frames until land is granted.
 *
 * The hamlet lattice `hex-1` is the cartography's (apps/surveyor/src/cartography/slots.ts), restated here because the
 * browser computes places from the world it already holds: rows 1.4 units apart, slots 1.6 along a row, odd rows
 * offset by 0.8; land by an even-odd ray over the coasts, the realm by power distance to the realm circles of that
 * land's region, and a slot free when a hamlet's disc keeps the shore and the gap from every holding.
 */
export const LATTICE = Object.freeze({ pitchX: 32, rowY: 28, scale: 20, shore: 0.9 });
export const HAMLET_RADIUS = 0.5;
export const HOLDING_GAP = 0.6;

export interface LatticePoint { i: number; j: number; x: number; y: number }

export function latticePoint(i: number, j: number): LatticePoint {
  return { i, j, x: (i * LATTICE.pitchX + (j & 1) * (LATTICE.pitchX / 2)) / LATTICE.scale, y: (j * LATTICE.rowY) / LATTICE.scale };
}

interface Segment { ring: number; ax: number; ay: number; bx: number; by: number }
export interface RealmCircle { index: number; region: number; x: number; y: number; r: number }

const ROW_BUCKET = 2;
const GRID_CELL = 2;
const key = (gx: number, gy: number) => (gx + 32_768) * 65_536 + (gy + 32_768);

function push(map: Map<number, Segment[]>, k: number, segment: Segment): void {
  const list = map.get(k);
  if (list) {
    if (list[list.length - 1] !== segment) list.push(segment);
  } else map.set(k, [segment]);
}

function segmentDistance(x: number, y: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / length));
  return Math.hypot(x - (s.ax + t * dx), y - (s.ay + t * dy));
}

/** Read-only index over the drawn coasts and realm circles. */
export class LandIndex {
  private readonly rows = new Map<number, Segment[]>();
  private readonly grid = new Map<number, Segment[]>();
  private readonly ringArea: number[] = [];
  private readonly ringRegion: number[] = [];
  private readonly realmsByRegion = new Map<number, RealmCircle[]>();

  constructor(rings: readonly Pick<Ring, 'region' | 'points'>[], readonly realms: readonly RealmCircle[]) {
    rings.forEach((ring, index) => {
      const pts = ring.points;
      const n = pts.length / 2;
      let area = 0;
      for (let p = 0; p < n; p++) {
        const q = (p + 1) % n;
        const ax = pts[p * 2]!;
        const ay = pts[p * 2 + 1]!;
        const bx = pts[q * 2]!;
        const by = pts[q * 2 + 1]!;
        area += ax * by - bx * ay;
        const segment: Segment = { ring: index, ax, ay, bx, by };
        for (let row = Math.floor(Math.min(ay, by) / ROW_BUCKET); row <= Math.floor(Math.max(ay, by) / ROW_BUCKET); row++) push(this.rows, row, segment);
        for (let gy = Math.floor(Math.min(ay, by) / GRID_CELL); gy <= Math.floor(Math.max(ay, by) / GRID_CELL); gy++) {
          for (let gx = Math.floor(Math.min(ax, bx) / GRID_CELL); gx <= Math.floor(Math.max(ax, bx) / GRID_CELL); gx++) push(this.grid, key(gx, gy), segment);
        }
      }
      this.ringArea.push(Math.abs(area / 2));
      this.ringRegion.push(ring.region);
    });
    for (const realm of realms) {
      const list = this.realmsByRegion.get(realm.region);
      if (list) list.push(realm);
      else this.realmsByRegion.set(realm.region, [realm]);
    }
  }

  regionAt(x: number, y: number): number {
    const crossings: { x: number; ring: number }[] = [];
    for (const s of this.rows.get(Math.floor(y / ROW_BUCKET)) ?? []) {
      if ((s.ay > y) === (s.by > y)) continue;
      crossings.push({ x: s.ax + ((y - s.ay) * (s.bx - s.ax)) / (s.by - s.ay), ring: s.ring });
    }
    crossings.sort((a, b) => a.x - b.x || a.ring - b.ring);
    const inside = new Set<number>();
    for (const c of crossings) {
      if (c.x >= x) break;
      if (inside.has(c.ring)) inside.delete(c.ring);
      else inside.add(c.ring);
    }
    if (inside.size % 2 === 0) return -1;
    let best = -1;
    for (const ring of inside) if (best < 0 || this.ringArea[ring]! > this.ringArea[best]! || (this.ringArea[ring] === this.ringArea[best] && ring < best)) best = ring;
    return this.ringRegion[best]!;
  }

  distanceToCoast(x: number, y: number, limit: number): number {
    let best = limit;
    const g0 = Math.floor((x - limit) / GRID_CELL);
    const g1 = Math.floor((x + limit) / GRID_CELL);
    const h0 = Math.floor((y - limit) / GRID_CELL);
    const h1 = Math.floor((y + limit) / GRID_CELL);
    for (let gy = h0; gy <= h1; gy++) {
      for (let gx = g0; gx <= g1; gx++) {
        for (const s of this.grid.get(key(gx, gy)) ?? []) best = Math.min(best, segmentDistance(x, y, s));
      }
    }
    return best;
  }

  realmAt(x: number, y: number): number {
    const region = this.regionAt(x, y);
    if (region < 0) return -1;
    let best = -1;
    let bestDistance = Infinity;
    for (const realm of this.realmsByRegion.get(region) ?? []) {
      const d = Math.hypot(x - realm.x, y - realm.y) - realm.r;
      if (d < bestDistance) {
        best = realm.index;
        bestDistance = d;
      }
    }
    return best;
  }
}

/** Holdings on the map, for the gap test. */
export class Occupancy {
  private readonly grid = new Map<number, { x: number; y: number; r: number }[]>();
  private maxR = 0;
  constructor(private readonly gap = HOLDING_GAP, private readonly cell = 8) {}

  add(x: number, y: number, r: number): void {
    const k = key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.grid.get(k);
    if (list) list.push({ x, y, r });
    else this.grid.set(k, [{ x, y, r }]);
    this.maxR = Math.max(this.maxR, r);
  }

  fits(x: number, y: number, r: number): boolean {
    const reach = r + this.maxR + this.gap;
    for (let gy = Math.floor((y - reach) / this.cell); gy <= Math.floor((y + reach) / this.cell); gy++) {
      for (let gx = Math.floor((x - reach) / this.cell); gx <= Math.floor((x + reach) / this.cell); gx++) {
        for (const h of this.grid.get(key(gx, gy)) ?? []) {
          const min = r + h.r + this.gap - 1e-9;
          const dx = h.x - x;
          const dy = h.y - y;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    return true;
  }
}

/**
 * Where a hash points inside its realm: an angle and an area-uniform radius from the dab hash's own bytes, inside
 * 85 % of the realm circle (the circle's rim often lies over the sea or a neighbour).
 */
export function pencilTarget(channelHash: string, realm: RealmCircle): { x: number; y: number } {
  const a = parseInt(channelHash.slice(0, 8), 16) / 0x1_0000_0000;
  const b = parseInt(channelHash.slice(8, 16), 16) / 0x1_0000_0000;
  const angle = a * Math.PI * 2;
  const radius = Math.sqrt(b) * realm.r * 0.85;
  return { x: realm.x + Math.cos(angle) * radius, y: realm.y + Math.sin(angle) * radius };
}

/**
 * The free lattice slot of a realm nearest a target, skipping slots already taken by an earlier dab. Searched
 * outward in growing rings, ties by row then column, exactly as the cartography orders candidates.
 */
export function nearestFreeSlot(land: LandIndex, occupancy: Occupancy, taken: ReadonlySet<string>, realm: RealmCircle, target: { x: number; y: number }): LatticePoint | null {
  const reach = Math.hypot(target.x - realm.x, target.y - realm.y) + realm.r * 1.6 + 12;
  const clearance = HAMLET_RADIUS + LATTICE.shore;
  let inner = -1;
  for (let radius = 3; ; radius = Math.min(reach, radius * 2)) {
    const candidates: { p: LatticePoint; d: number }[] = [];
    const j0 = Math.floor(((target.y - radius) * LATTICE.scale) / LATTICE.rowY);
    const j1 = Math.ceil(((target.y + radius) * LATTICE.scale) / LATTICE.rowY);
    for (let j = j0; j <= j1; j++) {
      const offset = (j & 1) * (LATTICE.pitchX / 2);
      const i0 = Math.floor(((target.x - radius) * LATTICE.scale - offset) / LATTICE.pitchX);
      const i1 = Math.ceil(((target.x + radius) * LATTICE.scale - offset) / LATTICE.pitchX);
      for (let i = i0; i <= i1; i++) {
        const p = latticePoint(i, j);
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d <= radius && d > inner) candidates.push({ p, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d || a.p.j - b.p.j || a.p.i - b.p.i);
    for (const { p } of candidates) {
      if (taken.has(`${p.i}:${p.j}`)) continue;
      if (land.realmAt(p.x, p.y) !== realm.index) continue;
      if (land.distanceToCoast(p.x, p.y, clearance) < clearance) continue;
      if (!occupancy.fits(p.x, p.y, HAMLET_RADIUS)) continue;
      return p;
    }
    if (radius >= reach) return null;
    inner = radius;
  }
}
