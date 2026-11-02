import { ATLAS_SPECTACLE } from '@chatdom/shared';
import type { Settler, SettlerStore } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import type { LiveFrame } from './feed';
import { PencilPlaces, pencilTarget, type PencilRegionPlaces } from '../../../../surveyor/src/cartography/pencil-place';
import type { RealmCircle } from '../../../../surveyor/src/cartography/slots';

/**
 * What the live layer paints, derived from the last coherent frame (Spec 01 R8, Atlas.md §5.1). Pure state with an
 * injected clock: the wash blooms in from each stream's real `started_at` (never from the moment the frame arrived),
 * and a holding that went offline dries away. Small live channels without land are dabs at their pencil places.
 */

/** A wash reaches full pigment this long after its stream began; a start the source did not know is shown full. */
export const BLOOM_MS = 15 * 60_000;
/** A wash dries away over this long once a frame shows its stream ended (the end itself fell inside one sweep). */
export const DRY_MS = 40_000;

export interface Dab {
  hash: string;
  realm: number;
  region: number;
  startedAt: number;
  /** The pencil place once its region has been placed; until then the hash's own point in its realm. */
  x: number;
  y: number;
  placed: boolean;
}

interface Drying { liveClass: number; from: number; x: number; y: number }

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** One spectacle at a time (R14): crowning, then the dragon, the Hype Train (fireworks first), a festival, a raid party. */
export const SPECTACLE_PRIORITY: readonly number[] = [
  ATLAS_SPECTACLE.crowning, ATLAS_SPECTACLE.dragon, ATLAS_SPECTACLE.hypeTrainFireworks, ATLAS_SPECTACLE.hypeTrain,
  ATLAS_SPECTACLE.festival, ATLAS_SPECTACLE.raidParty,
];

/**
 * The single spectacle to draw among the holdings in view, or null. Only founded kingdoms carry spectacle; a code on
 * any other holding is ignored, so a stray byte can never make a mapped channel look special. Ties go to the lower
 * ordinal. A spectacle never changes placement, tier, label priority or a pennant.
 */
export function chooseSpectacle(candidates: readonly { ordinal: number; founded: boolean; spectacle: number }[]): { ordinal: number; spectacle: number } | null {
  let best: { ordinal: number; spectacle: number; rank: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate.founded || candidate.spectacle === ATLAS_SPECTACLE.none) continue;
    const rank = SPECTACLE_PRIORITY.indexOf(candidate.spectacle);
    if (rank < 0) continue;
    if (!best || rank < best.rank || (rank === best.rank && candidate.ordinal < best.ordinal)) best = { ordinal: candidate.ordinal, spectacle: candidate.spectacle, rank };
  }
  return best && { ordinal: best.ordinal, spectacle: best.spectacle };
}

/** Where an interrupted region placement resumes: the dab index and, mid-search, that dab's stepwise search. */
interface PencilCursor { region: number; next: number; steps: Generator<void, { x: number; y: number } | null, void> | null }

export class LivePaint {
  private classes: Uint8Array;
  private starts = new Map<number, number | null>();
  private readonly drying = new Map<number, Drying>();
  private readonly dryingDabs = new Map<string, Dab & { from: number }>();
  private readonly realmCircles: RealmCircle[];
  private pencil: PencilPlaces | null = null;
  private readonly pencilRegions = new Map<number, PencilRegionPlaces>();
  private queue: number[] = [];
  /** The region being placed, the next dab to look at and the unfinished search of the current one. */
  private cursor: PencilCursor | null = null;
  dabs: Dab[] = [];
  frame: LiveFrame | null = null;
  /** Bumped when anything drawn changes; the view redraws on it. */
  version = 0;
  liveCount = 0;

  constructor(
    private readonly world: PreviewWorld,
    private readonly store: SettlerStore,
    private readonly rings: readonly { region: number; points: Float64Array }[],
    private readonly now: () => number = Date.now,
    private readonly reduceMotion: () => boolean = () => false,
    /** When the live view is held (stale or skewed), the observation time it is held at: nothing new blooms past it. */
    private readonly heldAt: () => number | null = () => null,
  ) {
    this.classes = new Uint8Array(store.total);
    const s = world.coordScale;
    this.realmCircles = world.realms.map((realm) => ({ index: realm.index, region: realm.region, x: realm.x / s, y: realm.y / s, r: realm.r / s }));
  }

  /** A withheld holding is bare land: the names projection withholds it before the next frame can. */
  liveClass(settler: Settler): number {
    if (settler.withheld) return 0;
    return this.classes[settler.ordinal] ?? 0;
  }

  /** The clock the wash is painted with. */
  time(): number {
    return this.now();
  }

  classAt(ordinal: number): number {
    return this.classes[ordinal] ?? 0;
  }

  startedAt(settler: Settler): number | null {
    return this.starts.get(settler.ordinal) ?? null;
  }

  /** Take a new coherent frame. Holdings that left the air dry away from now; new streams bloom from their start. */
  apply(frame: LiveFrame): void {
    const at = this.now();
    const next = new Uint8Array(this.classes.length);
    let live = 0;
    for (let ordinal = 0; ordinal < next.length; ordinal++) {
      const liveClass = frame.slots[ordinal * 2] ?? 0;
      next[ordinal] = liveClass;
      if (liveClass) live++;
      const before = this.classes[ordinal]!;
      if (this.frame && before && !liveClass && !this.reduceMotion()) {
        const settler = this.store.byOrdinal(ordinal);
        // A withheld holding lost its wash when it was withheld; the producer's re-gated frame must not paint it
        // back for a drying fade.
        if (settler && !settler.withheld) this.drying.set(ordinal, { liveClass: before, from: at, x: settler.x, y: settler.y });
      } else if (liveClass) {
        this.drying.delete(ordinal);
      }
    }
    const previous = new Map(this.dabs.map((dab) => [dab.hash, dab]));
    const dabs: Dab[] = frame.dabs.filter((input) => input.realmIndex < this.realmCircles.length).map((input) => {
      const realm = this.realmCircles[input.realmIndex]!;
      const old = previous.get(input.channelHash);
      previous.delete(input.channelHash);
      // Back on air while its last flag was still drying: one dab, not a live one over a fading one.
      this.dryingDabs.delete(input.channelHash);
      // Live membership never changes a provisional point on the same immutable region.
      if (old && old.realm === input.realmIndex) return { ...old, startedAt: input.startedAt };
      const target = pencilTarget(input.channelHash, realm);
      return { hash: input.channelHash, realm: input.realmIndex, region: realm.region, startedAt: input.startedAt, x: target.x, y: target.y, placed: false };
    });
    if (this.frame && !this.reduceMotion()) for (const gone of previous.values()) this.dryingDabs.set(gone.hash, { ...gone, from: at });
    this.classes = next;
    this.starts = frame.starts;
    this.dabs = dabs;
    this.frame = frame;
    this.liveCount = live;
    this.queue = [...new Set(dabs.filter(dab => !dab.placed).map(dab => dab.region))];
    this.cursor = null;
    this.version++;
  }

  /** 0…1: how far a wash has bloomed. A start the source did not know is shown full, never invented. */
  bloom(startedAt: number | null, at = this.now()): number {
    if (startedAt === null || this.reduceMotion()) return 1;
    const held = this.heldAt();
    if (held !== null) at = Math.min(at, held);
    return easeOut(Math.min(1, Math.max(0, (at - startedAt) / BLOOM_MS)));
  }

  /** Holdings drying after their stream ended, with how much pigment is left. */
  *dryingWashes(at = this.now()): Generator<{ ordinal: number; liveClass: number; x: number; y: number; left: number }> {
    for (const [ordinal, dry] of this.drying) {
      const left = 1 - (at - dry.from) / DRY_MS;
      // Withheld while it dried: it goes at once, like every other mark of a withheld holding.
      if (left <= 0 || this.store.byOrdinal(ordinal)?.withheld) {
        this.drying.delete(ordinal);
        continue;
      }
      yield { ordinal, liveClass: dry.liveClass, x: dry.x, y: dry.y, left };
    }
  }

  *dryingDabWashes(at = this.now()): Generator<{ dab: Dab; left: number }> {
    for (const [hash, dab] of this.dryingDabs) {
      const left = 1 - (at - dab.from) / DRY_MS;
      if (left <= 0) {
        this.dryingDabs.delete(hash);
        continue;
      }
      yield { dab, left };
    }
  }

  /**
   * How soon the wash must be repainted for bloom and drying to read as motion, or Infinity when it is still. Drying
   * is a short fade; blooming is slow, so a few repaints a minute keep it honest without a running loop.
   */
  nextChange(at = this.now()): number {
    if (this.drying.size || this.dryingDabs.size) return 120;
    if (this.reduceMotion() || !this.frame || this.heldAt() !== null) return Infinity;
    for (const started of this.starts.values()) if (started !== null && at - started < BLOOM_MS) return 4_000;
    for (const dab of this.dabs) if (at - dab.startedAt < BLOOM_MS) return 4_000;
    return Infinity;
  }

  /** One coast index per world and one occupancy index per complete immutable region. */
  private placesFor(region: number): PencilRegionPlaces | null {
    const cached = this.pencilRegions.get(region);
    if (cached) return cached;
    // Waiting for the chunk avoids both a moving dab and disagreement with server-side search placement.
    if (!this.store.hasRegion(region) && this.world.regions[region]?.chunk.records !== 0) return null;
    this.pencil ??= new PencilPlaces(this.world, this.rings);
    const radii = this.world.tiers.holdingRadius;
    const r = [radii.capital, radii.city, radii.town, radii.village];
    const holdings = this.store.all.filter(settler => settler.region === region)
      .map(settler => ({ x: settler.x, y: settler.y, r: r[settler.tierRank]! }));
    const places = this.pencil.forRegion(region, holdings);
    this.pencilRegions.set(region, places);
    return places;
  }

  /** A complete region can now be placed once, including its towns, villages and withheld holdings. */
  regionLoaded(region: number): void {
    if (this.pencilRegions.has(region) || !this.dabs.some(dab => dab.region === region)) return;
    if (!this.queue.includes(region)) this.queue.unshift(region);
  }

  /**
   * Places dabs region by region within a time budget, regions in `first` (those in view) before the rest. Returns
   * true while work remains. Each dab depends only on its hash, realm and complete permanent holdings. The budget is
   * kept inside a region too: a crowded region is finished over several calls in the same dab order, so one call
   * never holds the main thread much past its budget.
   */
  work(budgetMs: number, first: ReadonlySet<number> = new Set()): boolean {
    if (!this.queue.length && !this.cursor) return false;
    const deadline = performance.now() + budgetMs;
    this.queue.sort((a, b) => Number(first.has(b)) - Number(first.has(a)));
    let changed = false;
    while (performance.now() < deadline) {
      if (!this.cursor) {
        const region = this.queue.shift();
        if (region === undefined) break;
        this.cursor = { region, next: 0, steps: null };
      }
      changed = true;
      if (this.placeRegion(this.cursor, deadline)) this.cursor = null;
    }
    if (changed) this.version++;
    return this.queue.length > 0 || this.cursor !== null;
  }

  /** Places the cursor's region from its next dab on; true once the region is done. */
  private placeRegion(cursor: PencilCursor, deadline: number): boolean {
    const places = this.placesFor(cursor.region);
    if (!places) return true;
    const dabs = this.dabs;
    for (; cursor.next < dabs.length; cursor.next++) {
      const dab = dabs[cursor.next]!;
      if (dab.region !== cursor.region || dab.placed) continue;
      // One dab's search can cross a whole crowded region, so it too is taken a bounded step at a time.
      const steps = cursor.steps ??= places.placeSteps(dab.hash, dab.realm);
      let step = steps.next();
      while (!step.done) {
        if (performance.now() >= deadline) return false;
        step = steps.next();
      }
      cursor.steps = null;
      const slot = step.value;
      if (slot) {
        dab.x = slot.x;
        dab.y = slot.y;
        dab.placed = true;
      } else dab.placed = false;
      if (performance.now() >= deadline) {
        cursor.next++;
        return cursor.next >= dabs.length;
      }
    }
    return true;
  }
}
