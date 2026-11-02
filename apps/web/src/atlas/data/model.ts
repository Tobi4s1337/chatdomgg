import { languageName, languageMapLabel, type LanguageNameTable, LANGUAGE_NAMES } from '../../../../surveyor/src/cartography/language-labels';
import { familyLabel, landLabel, realmDisplayName, REALM_NAMES, type RealmNameTable } from '../../../../surveyor/src/cartography/realm-labels';
import { DECOR_KINDS, TIER_CODES, type DecorKind, type PreviewChunk, type PreviewWorld, type RealmKind, type RegionKind, type ServedNames, type SettlerColumns, type Tier } from './preview';

/**
 * One drawn holding, in world units. Its login and name come from the names projection and are held only while
 * fresh: a name the source has not confirmed for a day, or one never received, is null and the holding keeps only
 * its shield. A withheld holding is bare land: no mark, shield, name or card.
 */
export interface Settler {
  index: number;
  /** Global settler ordinal (Spec 01 R11): `world.head` order, then each region's chunk in region order. Live bytes are indexed by it. */
  ordinal: number;
  id: string;
  login: string | null;
  name: string | null;
  freshUntil: number;
  withheld: boolean;
  tier: Tier;
  tierRank: number;
  /**
   * One of the edition's founding holdings: pencil places are computed against these alone, so a small channel's
   * place holds for the whole edition. Every holding of a survey preview counts as founding.
   */
  foundingHolding: boolean;
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

export function geographyOf(world: PreviewWorld, table: LanguageNameTable = LANGUAGE_NAMES, realms: RealmNameTable = REALM_NAMES): Geography {
  const s = world.coordScale;
  return {
    bounds: { minX: world.bounds.minX / s, minY: world.bounds.minY / s, maxX: world.bounds.maxX / s, maxY: world.bounds.maxY / s },
    regions: world.regions.map((region) => ({
      index: region.index, name: region.language ? languageMapLabel(region.language, table) : landLabel('outer', realms), englishName: region.language ? languageMapLabel(region.language, table) : landLabel('outer', realms), kind: region.kind,
      x: region.x / s, y: region.y / s, r: region.r / s, members: region.members,
    })),
    realms: world.realms.map((realm) => ({
      index: realm.index, region: realm.region, kind: realm.kind, family: realm.family, name: realmWord(world, realm.index, table, realms),
      x: realm.x / s, y: realm.y / s, r: realm.r / s, members: realm.members,
    })),
    clusters: world.clusters.map((cluster) => ({
      region: cluster.region, realm: cluster.realm, name: cluster.game >= 0 ? world.games[cluster.game]?.name ?? null : null,
      x: cluster.x / s, y: cluster.y / s, r: cluster.r / s, members: cluster.members,
    })),
    isles: world.isles ? { name: landLabel('isles', realms), x: world.isles.x / s, y: world.isles.y / s, r: world.isles.r / s } : null,
    outer: { name: landLabel('outer', realms), x: world.outer.x / s, y: world.outer.y / s, r: world.outer.r / s },
  };
}

/**
 * Project old and current immutable artifacts alike, ignoring their historical display strings: languages by code,
 * family realms by family id (in the taxonomies the realm table names) and the fixed lands by kind. Geometry, chunks
 * and the head are shared, never copied or changed.
 */
export function labelWorld(world: PreviewWorld, table: LanguageNameTable = LANGUAGE_NAMES, realms: RealmNameTable = REALM_NAMES): PreviewWorld {
  return {
    ...world,
    regions: world.regions.map(region => region.language
      ? { ...region, name: languageName(region.language, table).label, englishName: languageName(region.language, table).label }
      : { ...region, name: landLabel('outer', realms), englishName: landLabel('outer', realms) }),
    isles: world.isles ? { ...world.isles, name: landLabel('isles', realms) } : null,
    outer: { ...world.outer, name: landLabel('outer', realms) },
    families: world.families.map(family => ({ ...family, name: (world.taxonomy && familyLabel(world.taxonomy.id, family.id, realms)) ?? family.name })),
    realms: world.realms.map(realm => ({ ...realm, name: realmWord(world, realm.index, table, realms) })),
  };
}

/** One realm's words: an isle by its language, every other realm by the realm table, else what the world recorded. */
export function realmWord(world: PreviewWorld, index: number, table: LanguageNameTable = LANGUAGE_NAMES, realms: RealmNameTable = REALM_NAMES): string {
  const realm = world.realms[index];
  if (!realm) return '';
  const code = world.regions[realm.region]?.language;
  return realm.kind === 'isle' && code ? languageName(code, table).label : realmDisplayName(realm, world, realms);
}

function realmLabel(world: PreviewWorld, index: number): string {
  return realmWord(world, index);
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
 * towns, villages and an edition's hamlets arrive per region as the camera comes close enough to draw them.
 */
export class SettlerStore {
  readonly all: Settler[] = [];
  readonly byId = new Map<string, Settler>();
  readonly byLogin = new Map<string, Settler>();
  private readonly grid = new Map<number, Settler[]>();
  private readonly loadedRegions = new Set<number>();
  private readonly ordinals = new Map<number, Settler>();
  private readonly offsets: number[];
  /** Every holding of the preview, loaded or not: the length of a live frame. */
  readonly total: number;
  private readonly cols: number;
  private names = new Map<string, { login: string; name: string; freshUntil: number }>();
  private withheld = new Set<string>();
  /** Whether a names projection has ever been applied. */
  named = false;
  /** True once the whole names projection (not only its head) has been taken. */
  namedWhole = false;
  version = 0;
  /** Names/visibility changed on existing holdings. Background chunk arrivals do not re-letter the fixed still. */
  labelsVersion = 0;

  constructor(private readonly world: PreviewWorld, private readonly now: () => number = Date.now, private readonly cell = 24) {
    this.cols = Math.ceil((world.bounds.maxX - world.bounds.minX) / world.coordScale / cell) + 1;
    this.offsets = [];
    let next = world.head.ids.length;
    for (const region of world.regions) {
      this.offsets.push(next);
      next += region.chunk.records;
    }
    this.total = next;
    this.add(world.head, 0);
  }

  /** How many holdings the world's head carries (a names head never names more). */
  get headSize(): number {
    return this.world.head.ids.length;
  }

  /**
   * Take a names projection: it replaces the previous one entirely (a name it omits is no longer shown). `whole` is false for the head part (the head's names and every withheld id), which a
   * first frame waits for; the whole projection follows and replaces it. A head never replaces a whole.
   */
  applyNames(served: ServedNames, whole = true): void {
    if (served.preview !== this.world.id) return;
    if (!whole && this.namedWhole) return;
    if (whole) this.namedWhole = true;
    this.names = new Map(served.ids.map((id, i) => [id, { login: served.logins[i]!, name: served.names[i]!, freshUntil: served.freshUntil[i]! }]));
    this.withheld = new Set(served.withheld);
    this.named = true;
    this.byLogin.clear();
    for (const settler of this.all) this.label(settler);
    this.version++;
    this.labelsVersion++;
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
    if (changed) { this.version++; this.labelsVersion++; }
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

  /** Whether the names projection withholds this channel (the operator's list or its own hide), drawn or not. */
  isWithheld(id: string): boolean {
    return this.withheld.has(id);
  }

  hasRegion(region: number): boolean {
    return this.loadedRegions.has(region);
  }

  addChunk(chunk: PreviewChunk): void {
    if (this.loadedRegions.has(chunk.region)) return;
    this.loadedRegions.add(chunk.region);
    this.add(chunk.settlers, this.offsets[chunk.region]!);
  }

  private key(x: number, y: number): number {
    const gx = Math.floor((x - this.world.bounds.minX / this.world.coordScale) / this.cell);
    const gy = Math.floor((y - this.world.bounds.minY / this.world.coordScale) / this.cell);
    return gy * this.cols + gx;
  }

  /** The holding at a settler ordinal, if its region has been loaded. */
  byOrdinal(ordinal: number): Settler | undefined {
    return this.ordinals.get(ordinal);
  }

  private add(columns: SettlerColumns, firstOrdinal: number): void {
    const scale = this.world.coordScale;
    const founded = columns.founded ?? columns.ids.length;
    for (let i = 0; i < columns.ids.length; i++) {
      const id = columns.ids[i]!;
      if (this.byId.has(id)) continue;
      const tierRank = columns.tier[i]!;
      const gameIndex = columns.game[i]!;
      const realm = columns.realm[i]!;
      const settler: Settler = {
        index: this.all.length,
        ordinal: firstOrdinal + i,
        id,
        login: null,
        name: null,
        freshUntil: 0,
        withheld: false,
        tier: TIER_CODES[tierRank]!,
        tierRank,
        foundingHolding: i < founded,
        x: columns.x[i]! / scale,
        y: columns.y[i]! / scale,
        average: columns.average[i]!,
        game: gameIndex >= 0 ? this.world.games[gameIndex]?.name ?? null : null,
        region: columns.region[i]!,
        realm,
        realmName: realmLabel(this.world, realm),
      };
      this.label(settler);
      this.all.push(settler);
      this.byId.set(id, settler);
      this.ordinals.set(settler.ordinal, settler);
      const key = this.key(settler.x, settler.y);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(settler);
      else this.grid.set(key, [settler]);
    }
    this.version++;
  }

  /** Holdings inside a world rectangle, at or above a tier (0 = capitals only … 3 = through villages, 4 = everything). */
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
