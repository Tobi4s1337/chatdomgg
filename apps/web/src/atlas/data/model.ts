import { DECOR_KINDS, TIER_CODES, type DecorKind, type PreviewChunk, type PreviewWorld, type RealmKind, type RegionKind, type ServedNames, type SettlerColumns, type Tier } from './preview';

/**
 * One drawn holding, in world units. Its login and name come from the names projection and are held only while
 * fresh: a name the source has not confirmed for a day, or one never received, is null and the holding keeps only
 * its shield. A withheld holding is bare land: no mark, shield, name or card.
 */
export interface Settler {
  index: number;
  id: string;
  login: string | null;
  name: string | null;
  freshUntil: number;
  withheld: boolean;
  tier: Tier;
  tierRank: number;
  x: number;
  y: number;
  average: number;
  game: string | null;
  region: number;
  realm: number;
  /** The realm's map name: its family of games, the Crossroads, the Wilds, or the isle's language. */
  realmName: string;
}

export interface Ring {
  region: number;
  points: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DecorMark { kind: DecorKind; bands: number; variant: number; x: number; y: number }

export interface Circle { name: string; x: number; y: number; r: number }

export interface GeoRealm { index: number; region: number; kind: RealmKind; family: number; name: string; x: number; y: number; r: number; members: number }

/** The preview's geometry in world units (the file stores fixed-point integers at `coordScale`). */
export interface Geography {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  regions: { index: number; name: string; englishName: string; kind: RegionKind; x: number; y: number; r: number; members: number }[];
  realms: GeoRealm[];
  clusters: { region: number; realm: number; name: string | null; x: number; y: number; r: number; members: number }[];
  isles: Circle | null;
  /** The empty islands kept for overflow, labelled once as one archipelago. */
  outer: Circle;
}

export function geographyOf(world: PreviewWorld): Geography {
  const s = world.coordScale;
  return {
    bounds: { minX: world.bounds.minX / s, minY: world.bounds.minY / s, maxX: world.bounds.maxX / s, maxY: world.bounds.maxY / s },
    regions: world.regions.map((region) => ({
      index: region.index, name: region.name, englishName: region.englishName, kind: region.kind,
      x: region.x / s, y: region.y / s, r: region.r / s, members: region.members,
    })),
    realms: world.realms.map((realm) => ({
      index: realm.index, region: realm.region, kind: realm.kind, family: realm.family, name: realm.name,
      x: realm.x / s, y: realm.y / s, r: realm.r / s, members: realm.members,
    })),
    clusters: world.clusters.map((cluster) => ({
      region: cluster.region, realm: cluster.realm, name: cluster.game >= 0 ? world.games[cluster.game]?.name ?? null : null,
      x: cluster.x / s, y: cluster.y / s, r: cluster.r / s, members: cluster.members,
    })),
    isles: world.isles ? { name: world.isles.name, x: world.isles.x / s, y: world.isles.y / s, r: world.isles.r / s } : null,
    outer: { name: world.outer.name, x: world.outer.x / s, y: world.outer.y / s, r: world.outer.r / s },
  };
}

export function decodeRings(world: PreviewWorld): Ring[] {
  return world.coasts.map((coast) => {
    const points = new Float64Array(coast.points.length);
    let x = 0;
    let y = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < coast.points.length; p += 2) {
      x += coast.points[p]!;
      y += coast.points[p + 1]!;
      const wx = x / world.coordScale;
      const wy = y / world.coordScale;
      points[p] = wx;
      points[p + 1] = wy;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
    return { region: coast.region, points, minX, minY, maxX, maxY };
  });
}

export function decodeDecor(world: PreviewWorld): DecorMark[] {
  const marks: DecorMark[] = [];
  for (let i = 0; i < world.decor.length; i += 3) {
    const code = world.decor[i]!;
    const kind = DECOR_KINDS[code >> 12];
    if (!kind) continue;
    marks.push({ kind, bands: (code >> 7) & 31, variant: code & 127, x: world.decor[i + 1]! / world.coordScale, y: world.decor[i + 2]! / world.coordScale });
  }
  return marks;
}

/**
 * All holdings loaded so far, with a uniform grid for viewport queries. Capitals and cities arrive with the world;
 * towns and villages arrive per region as the camera comes close enough to draw them.
 */
export class SettlerStore {
  readonly all: Settler[] = [];
  readonly byId = new Map<string, Settler>();
  readonly byLogin = new Map<string, Settler>();
  private readonly grid = new Map<number, Settler[]>();
  private readonly loadedRegions = new Set<number>();
  private readonly cols: number;
  private names = new Map<string, { login: string; name: string; freshUntil: number }>();
  private withheld = new Set<string>();
  /** Whether a names projection has ever been applied. */
  named = false;
  version = 0;

  constructor(private readonly world: PreviewWorld, private readonly now: () => number = Date.now, private readonly cell = 24) {
    this.cols = Math.ceil((world.bounds.maxX - world.bounds.minX) / world.coordScale / cell) + 1;
    this.add(world.head);
  }

  /** Take a new names projection: it replaces the previous one entirely (a name it omits is no longer shown). */
  applyNames(served: ServedNames): void {
    if (served.preview !== this.world.id) return;
    this.names = new Map(served.ids.map((id, i) => [id, { login: served.logins[i]!, name: served.names[i]!, freshUntil: served.freshUntil[i]! }]));
    this.withheld = new Set(served.withheld);
    this.named = true;
    this.byLogin.clear();
    for (const settler of this.all) this.label(settler);
    this.version++;
  }

  /**
   * Drop names that have gone stale since they arrived. Returns the next moment another name goes stale (or
   * Infinity), so the caller can come back then.
   */
  expireNames(): number {
    const at = this.now();
    let next = Number.POSITIVE_INFINITY;
    let changed = false;
    for (const settler of this.all) {
      if (settler.name === null) continue;
      if (settler.freshUntil <= at) {
        if (settler.login) this.byLogin.delete(settler.login);
        settler.login = null;
        settler.name = null;
        changed = true;
      } else if (settler.freshUntil < next) {
        next = settler.freshUntil;
      }
    }
    if (changed) this.version++;
    return next;
  }

  private label(settler: Settler): void {
    const entry = this.names.get(settler.id);
    const fresh = entry && entry.freshUntil > this.now() ? entry : null;
    settler.withheld = this.withheld.has(settler.id);
    settler.login = settler.withheld ? null : fresh?.login ?? null;
    settler.name = settler.withheld ? null : fresh?.name ?? null;
    settler.freshUntil = fresh?.freshUntil ?? 0;
    if (settler.login) this.byLogin.set(settler.login, settler);
  }

  hasRegion(region: number): boolean {
    return this.loadedRegions.has(region);
  }

  addChunk(chunk: PreviewChunk): void {
    if (this.loadedRegions.has(chunk.region)) return;
    this.loadedRegions.add(chunk.region);
    this.add(chunk.settlers);
  }

  private key(x: number, y: number): number {
    const gx = Math.floor((x - this.world.bounds.minX / this.world.coordScale) / this.cell);
    const gy = Math.floor((y - this.world.bounds.minY / this.world.coordScale) / this.cell);
    return gy * this.cols + gx;
  }

  private add(columns: SettlerColumns): void {
    const scale = this.world.coordScale;
    for (let i = 0; i < columns.ids.length; i++) {
      const id = columns.ids[i]!;
      if (this.byId.has(id)) continue;
      const tierRank = columns.tier[i]!;
      const gameIndex = columns.game[i]!;
      const realm = columns.realm[i]!;
      const settler: Settler = {
        index: this.all.length,
        id,
        login: null,
        name: null,
        freshUntil: 0,
        withheld: false,
        tier: TIER_CODES[tierRank]!,
        tierRank,
        x: columns.x[i]! / scale,
        y: columns.y[i]! / scale,
        average: columns.average[i]!,
        game: gameIndex >= 0 ? this.world.games[gameIndex]?.name ?? null : null,
        region: columns.region[i]!,
        realm,
        realmName: this.world.realms[realm]?.name ?? '',
      };
      this.label(settler);
      this.all.push(settler);
      this.byId.set(id, settler);
      const key = this.key(settler.x, settler.y);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(settler);
      else this.grid.set(key, [settler]);
    }
    this.version++;
  }

  /** Holdings inside a world rectangle, at or above a tier (0 = capitals only … 3 = everything). */
  query(minX: number, minY: number, maxX: number, maxY: number, maxTier: number, out: Settler[] = []): Settler[] {
    out.length = 0;
    const ox = this.world.bounds.minX / this.world.coordScale;
    const oy = this.world.bounds.minY / this.world.coordScale;
    const gx0 = Math.max(0, Math.floor((minX - ox) / this.cell));
    const gx1 = Math.min(this.cols - 1, Math.floor((maxX - ox) / this.cell));
    const gy0 = Math.max(0, Math.floor((minY - oy) / this.cell));
    const gy1 = Math.floor((maxY - oy) / this.cell);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const bucket = this.grid.get(gy * this.cols + gx);
        if (!bucket) continue;
        for (const settler of bucket) {
          if (!settler.withheld && settler.tierRank <= maxTier && settler.x >= minX && settler.x <= maxX && settler.y >= minY && settler.y <= maxY) out.push(settler);
        }
      }
    }
    return out;
  }
}

export function tierOf(rank: number): Tier {
  return TIER_CODES[rank]!;
}
