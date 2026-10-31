/**
 * The hamlet lattice (Spec 01 R5): a fine, deterministic grid of slots over every realm's waiting land. A slot is
 * computed from the frozen world alone (its coasts and realm circles), never stored until a holding takes it.
 *
 * Every coordinate here is a multiple of 1/20 world unit, the fixed point the world files are written in, so a slot
 * means the same point on every machine: rows are 1.4 units apart, slots 1.6 along a row, odd rows offset by 0.8.
 * Land is decided by an even-odd ray cast over the stored coasts, membership of a realm by the power distance to
 * the realm circles of that land's region, and a slot fits a holding when its disc keeps a shore and a gap from
 * every holding already on the map.
 */
export const LATTICE = Object.freeze({
  id: 'hex-1',
  /** Units of 1/20. */
  pitchX: 32,
  rowY: 28,
  scale: 20,
  /** Dry land kept between a holding's edge and the coast. */
  shore: 0.9,
});

export interface LatticePoint { i: number; j: number; x: number; y: number }

export function latticePoint(i: number, j: number): LatticePoint {
  return { i, j, x: (i * LATTICE.pitchX + (j & 1) * (LATTICE.pitchX / 2)) / LATTICE.scale, y: (j * LATTICE.rowY) / LATTICE.scale };
}

/** Lattice coordinates in a holding ID: `s:<i>:<j>`. */
export const slotHoldingId = (i: number, j: number) => `s:${i}:${j}`;
export function parseSlotHoldingId(id: string): { i: number; j: number } | null {
  // Canonical integers only (no leading zeros, no -0), so one slot has exactly one holding ID.
  const match = /^s:(0|-?[1-9]\d{0,6}):(0|-?[1-9]\d{0,6})$/.exec(id);
  return match ? { i: Number(match[1]), j: Number(match[2]) } : null;
}

export interface LandRing { region: number; points: ArrayLike<number> }
export interface RealmCircle { index: number; region: number; x: number; y: number; r: number }

interface Segment { ring: number; ax: number; ay: number; bx: number; by: number }

const ROW_BUCKET = 2;
const GRID_CELL = 2;

/** Read-only index over a world's coasts and realms. */
export class LandIndex {
  private readonly rows = new Map<number, Segment[]>();
  private readonly grid = new Map<number, Segment[]>();
  private readonly ringArea: number[];
  private readonly ringRegion: number[];
  private readonly realmsByRegion = new Map<number, RealmCircle[]>();

  constructor(rings: readonly LandRing[], readonly realms: readonly RealmCircle[]) {
    this.ringArea = [];
    this.ringRegion = [];
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

  /**
   * Crossings of the horizontal line through `y`, sorted by x, each with its ring. Half-open on y, so a vertex
   * exactly on the line is counted once.
   */
  crossings(y: number): { x: number; ring: number }[] {
    const out: { x: number; ring: number }[] = [];
    for (const s of this.rows.get(Math.floor(y / ROW_BUCKET)) ?? []) {
      if ((s.ay > y) === (s.by > y)) continue;
      out.push({ x: s.ax + ((y - s.ay) * (s.bx - s.ax)) / (s.by - s.ay), ring: s.ring });
    }
    return out.sort((a, b) => a.x - b.x || a.ring - b.ring);
  }

  /** The region of the land at a point, or -1 at sea (inside an even number of coasts, as in a lake). */
  regionAt(x: number, y: number): number {
    const inside = new Set<number>();
    for (const c of this.crossings(y)) {
      if (c.x >= x) break;
      if (inside.has(c.ring)) inside.delete(c.ring);
      else inside.add(c.ring);
    }
    return this.regionOf(inside);
  }

  /** Region from the set of rings that enclose a point: land when odd, the region of the largest enclosing ring. */
  regionOf(inside: ReadonlySet<number>): number {
    if (inside.size % 2 === 0) return -1;
    let best = -1;
    for (const ring of inside) if (best < 0 || this.ringArea[ring]! > this.ringArea[best]! || (this.ringArea[ring] === this.ringArea[best] && ring < best)) best = ring;
    return this.ringRegion[best]!;
  }

  /** Nearest coast within `limit`, or `limit` when none is closer. */
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

  /** The realm of a point on land: the nearest realm circle of that region by power distance (|p − c| − r). */
  realmAt(x: number, y: number, region = this.regionAt(x, y)): number {
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

function push<K>(map: Map<K, Segment[]>, k: K, segment: Segment): void {
  const list = map.get(k);
  if (list) {
    if (list[list.length - 1] !== segment) list.push(segment);
  } else map.set(k, [segment]);
}

const key = (gx: number, gy: number) => (gx + 32_768) * 65_536 + (gy + 32_768);

function segmentDistance(x: number, y: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / length));
  return Math.hypot(x - (s.ax + t * dx), y - (s.ay + t * dy));
}

/** Every holding already on the map, for the gap test. */
export class Occupancy {
  private readonly grid = new Map<number, { x: number; y: number; r: number }[]>();
  private maxR = 0;
  private count = 0;
  constructor(private readonly gap: number, private readonly cell = 8) {}

  get size(): number {
    return this.count;
  }

  add(x: number, y: number, r: number): void {
    const k = key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    const list = this.grid.get(k);
    const holding = { x, y, r };
    if (list) list.push(holding);
    else this.grid.set(k, [holding]);
    this.maxR = Math.max(this.maxR, r);
    this.count++;
  }

  /** True when a disc of radius `r` at the point keeps the gap from every holding. */
  fits(x: number, y: number, r: number): boolean {
    const reach = r + this.maxR + this.gap;
    const g0 = Math.floor((x - reach) / this.cell);
    const g1 = Math.floor((x + reach) / this.cell);
    const h0 = Math.floor((y - reach) / this.cell);
    const h1 = Math.floor((y + reach) / this.cell);
    for (let gy = h0; gy <= h1; gy++) {
      for (let gx = g0; gx <= g1; gx++) {
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

/** Whether a holding of radius `r` may stand at a lattice point of a realm. */
export function slotFits(land: LandIndex, occupancy: Occupancy, realm: RealmCircle, point: LatticePoint, r: number): boolean {
  if (land.realmAt(point.x, point.y) !== realm.index) return false;
  if (land.distanceToCoast(point.x, point.y, r + LATTICE.shore) < r + LATTICE.shore) return false;
  return occupancy.fits(point.x, point.y, r);
}

/**
 * The free lattice point of a realm nearest a target, for a holding of radius `r`. Candidates are taken in order of
 * distance (ties: lower row, then lower column), searched outward until the realm's reach is covered.
 */
export function nearestFreeSlot(land: LandIndex, occupancy: Occupancy, realm: RealmCircle, target: { x: number; y: number }, r: number): LatticePoint | null {
  const reach = Math.hypot(target.x - realm.x, target.y - realm.y) + realm.r * 1.6 + 12;
  let inner = -1;
  for (let radius = 6; ; radius = Math.min(reach, radius * 2)) {
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
    for (const { p } of candidates) if (slotFits(land, occupancy, realm, p, r)) return p;
    if (radius >= reach) return null;
    inner = radius;
  }
}

/**
 * Free hamlet slots per realm across the whole world: one row sweep per lattice row. Used to report each realm's
 * room for hamlets and to prove the lattice never needs a border to move.
 */
export function realmCapacity(land: LandIndex, occupancy: Occupancy, bounds: { minY: number; maxY: number }, hamletRadius: number): Map<number, number> {
  const counts = new Map<number, number>();
  const j0 = Math.ceil((bounds.minY * LATTICE.scale) / LATTICE.rowY);
  const j1 = Math.floor((bounds.maxY * LATTICE.scale) / LATTICE.rowY);
  const clearance = hamletRadius + LATTICE.shore;
  for (let j = j0; j <= j1; j++) {
    const y = (j * LATTICE.rowY) / LATTICE.scale;
    const crossings = land.crossings(y);
    if (crossings.length === 0) continue;
    const inside = new Set<number>();
    const offset = (j & 1) * (LATTICE.pitchX / 2);
    for (let c = 0; c < crossings.length; c++) {
      const crossing = crossings[c]!;
      if (inside.has(crossing.ring)) inside.delete(crossing.ring);
      else inside.add(crossing.ring);
      const next = crossings[c + 1];
      if (!next) break;
      const region = land.regionOf(inside);
      if (region < 0) continue;
      const i0 = Math.ceil((crossing.x * LATTICE.scale - offset) / LATTICE.pitchX);
      const i1 = Math.floor((next.x * LATTICE.scale - offset) / LATTICE.pitchX);
      for (let i = i0; i <= i1; i++) {
        const x = (i * LATTICE.pitchX + offset) / LATTICE.scale;
        if (x <= crossing.x || x >= next.x) continue;
        if (land.distanceToCoast(x, y, clearance) < clearance) continue;
        if (!occupancy.fits(x, y, hamletRadius)) continue;
        const realm = land.realmAt(x, y, region);
        if (realm >= 0) counts.set(realm, (counts.get(realm) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** The land index of a stored world: delta-encoded coasts and integer realm circles, both in 1/coordScale units. */
export function landIndexOfWorld(world: {
  coordScale: number;
  coasts: readonly { region: number; points: readonly number[] }[];
  realms: readonly { index: number; region: number; x: number; y: number; r: number }[];
}): LandIndex {
  const s = world.coordScale;
  const rings = world.coasts.map((coast) => {
    const points = new Float64Array(coast.points.length);
    let x = 0;
    let y = 0;
    for (let p = 0; p < coast.points.length; p += 2) {
      x += coast.points[p]!;
      y += coast.points[p + 1]!;
      points[p] = x / s;
      points[p + 1] = y / s;
    }
    return { region: coast.region, points };
  });
  return new LandIndex(rings, world.realms.map((realm) => ({ index: realm.index, region: realm.region, x: realm.x / s, y: realm.y / s, r: realm.r / s })));
}
