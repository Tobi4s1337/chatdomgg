import { StateView, type Ref } from '@colyseus/schema';

/**
 * Districts bound what every socket receives (spec 34 R10). The kingdom floor is a grid of square districts; a
 * walker sees its own district and the ring around it, so a 300-person kingdom never fans every step out to every
 * socket. Every client standing in the same district shares one `StateView` object, which is what lets Colyseus
 * encode that district's patch body once (its serializer caches bodies by view identity, not by equal contents).
 */
export interface DistrictGrid {
  /** Edge of one square district in world metres. */
  readonly cellMetres: number;
  /** A walker keeps its district until it is this far past the edge, so pacing a boundary does not churn views. */
  readonly hysteresisMetres: number;
  /** Rings of neighbouring districts in each view: 1 is the district plus its eight neighbours. */
  readonly ring: number;
}

/**
 * 48 m districts with one neighbour ring: everyone within at least 48 m (up to 96 m) is visible. That is farther
 * than a walker can read a name tag and close enough that a crowded street still shares a handful of bodies.
 */
export const REALM_DISTRICT_GRID: DistrictGrid = { cellMetres: 48, hysteresisMetres: 4, ring: 1 };

export interface DistrictCell { readonly cx: number; readonly cz: number }

/** Public district label (`<cx>:<cz>`); the walker schema's `district` field carries it. */
export function districtName(cell: DistrictCell): string { return `${cell.cx}:${cell.cz}`; }

/** The district under (x, z); with `current`, the walker stays there until it is `hysteresisMetres` past the edge. */
export function districtAt(x: number, z: number, grid: DistrictGrid, current?: DistrictCell): DistrictCell {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return current ?? { cx: 0, cz: 0 };
  const size = grid.cellMetres, margin = grid.hysteresisMetres;
  if (current) {
    const inside = (n: number, c: number) => n >= c * size - margin && n < (c + 1) * size + margin;
    if (inside(x, current.cx) && inside(z, current.cz)) return current;
  }
  return { cx: Math.floor(x / size), cz: Math.floor(z / size) };
}

/** Whether a view centred on `centre` includes entities standing in `cell`. */
export function covers(centre: DistrictCell, cell: DistrictCell, grid: DistrictGrid): boolean {
  return Math.abs(centre.cx - cell.cx) <= grid.ring && Math.abs(centre.cz - cell.cz) <= grid.ring;
}

/** A filtered entity already attached to room state, with the public district label the server keeps current. */
export type DistrictEntity = Ref & { x: number; z: number; district: string };

/** One walker whose district changed: its client must take `view` and be rebaselined (see `RealmDistricts.sweep`). */
export interface DistrictCrossing { readonly id: string; readonly from: string; readonly to: string; readonly view: StateView }

export interface DistrictStats {
  /** Shared views alive now: one per occupied district, never one per walker. */
  readonly views: number;
  readonly walkers: number;
  /** Entity memberships across all views; with one ring this is at most nine per walker. */
  readonly memberships: number;
  /** Largest number of clients sharing one view object. */
  readonly widestView: number;
}

interface DistrictView { readonly cell: DistrictCell; readonly view: StateView; readonly holders: Set<string> }
interface Placed<E> { readonly entity: E; cell: DistrictCell }

/**
 * The room's shared district views. Invariant after every call: the view centred on district C holds exactly the
 * walkers whose indexed district C covers, and exists exactly while at least one walker (connected or holding a
 * reconnect seat) stands in C. Views are never allocated per walker and never carry anything per person.
 *
 * Membership only moves through `enter`, `sweep` and `leave`. The room runs `sweep` right before each patch, so
 * every queued view change is encoded in the same patch that caused it.
 */
export class RealmDistricts<E extends DistrictEntity> {
  private readonly views = new Map<string, DistrictView>();
  private readonly walkers = new Map<string, Placed<E>>();
  /** District name → walker ids standing there, so a new view is populated from its ring alone. */
  private readonly standing = new Map<string, Set<string>>();

  constructor(readonly grid: DistrictGrid = REALM_DISTRICT_GRID) {
    if (!(grid.cellMetres > 0) || !(grid.hysteresisMetres >= 0) || grid.hysteresisMetres * 2 >= grid.cellMetres || !Number.isInteger(grid.ring) || grid.ring < 0) {
      throw new Error('District grid needs a positive cell, hysteresis under half a cell and a whole ring');
    }
  }

  /**
   * A new walker, already set in room state. It joins every live view that covers its district and receives the
   * shared view of its own district (created if nobody stands there yet). The joining socket is sent its full state
   * by Colyseus after the join, so a freshly made view does not queue a second copy of the same entities.
   */
  enter(id: string, entity: E): StateView {
    if (this.walkers.has(id)) throw new Error('This walker already stands in a district');
    const cell = districtAt(entity.x, entity.z, this.grid);
    entity.district = districtName(cell);
    this.walkers.set(id, { entity, cell });
    this.stand(id, cell);
    for (const shared of this.around(cell)) if (covers(shared.cell, cell, this.grid)) shared.view.add(entity);
    return this.hold(id, cell);
  }

  /**
   * Re-reads every walker's position. A walker that moved past its district edge (plus hysteresis) leaves the views
   * that no longer cover it, joins the ones that now do, and moves its own client to the shared view of its new
   * district. The caller must rebaseline each crossing client's decoder with the full state of that view: views are
   * shared, so the old view cannot be emptied for one person, and swapping `client.view` alone neither removes old
   * entities from that decoder nor sends the new district's existing ones.
   */
  sweep(): DistrictCrossing[] {
    const crossings: DistrictCrossing[] = [];
    for (const [id, placed] of this.walkers) {
      const from = placed.cell, to = districtAt(placed.entity.x, placed.entity.z, this.grid, from);
      if (to === from) continue;
      this.unstand(id, from);
      placed.cell = to;
      this.stand(id, to);
      // Views around both districts: leave those that stop covering, join those that start. Others are untouched.
      const touched = new Set([...this.around(from), ...this.around(to)]);
      for (const shared of touched) {
        const before = covers(shared.cell, from, this.grid), after = covers(shared.cell, to, this.grid);
        if (before && !after) shared.view.remove(placed.entity);
        else if (!before && after) shared.view.add(placed.entity);
      }
      placed.entity.district = districtName(to);
      this.release(id, from);
      crossings.push({ id, from: districtName(from), to: districtName(to), view: this.hold(id, to) });
    }
    return crossings;
  }

  /** The walker leaves the room: out of every view while it is still attached to state, and its view released. */
  leave(id: string): void {
    const placed = this.walkers.get(id);
    if (!placed) return;
    for (const shared of this.around(placed.cell)) if (covers(shared.cell, placed.cell, this.grid)) shared.view.remove(placed.entity);
    this.walkers.delete(id);
    this.unstand(id, placed.cell);
    this.release(id, placed.cell);
  }

  /** The shared view this walker's client should hold. */
  viewOf(id: string): StateView | undefined {
    const placed = this.walkers.get(id);
    return placed ? this.views.get(districtName(placed.cell))?.view : undefined;
  }

  districtOf(id: string): string | undefined {
    const placed = this.walkers.get(id);
    return placed ? districtName(placed.cell) : undefined;
  }

  /** Walker ids the view of `id` holds right now (its own district plus the ring). */
  visibleTo(id: string): string[] {
    const placed = this.walkers.get(id);
    if (!placed) return [];
    return [...this.walkers].filter(([, other]) => covers(placed.cell, other.cell, this.grid)).map(([other]) => other);
  }

  stats(): DistrictStats {
    let memberships = 0, widestView = 0;
    for (const shared of this.views.values()) {
      widestView = Math.max(widestView, shared.holders.size);
      for (const placed of this.walkers.values()) if (covers(shared.cell, placed.cell, this.grid)) memberships++;
    }
    return { views: this.views.size, walkers: this.walkers.size, memberships, widestView };
  }

  dispose(): void {
    for (const shared of this.views.values()) shared.view.dispose();
    this.views.clear(); this.walkers.clear(); this.standing.clear();
  }

  private hold(id: string, cell: DistrictCell): StateView {
    const name = districtName(cell);
    let shared = this.views.get(name);
    if (!shared) {
      shared = { cell, view: new StateView(), holders: new Set() };
      for (const neighbour of this.ringOf(cell)) for (const other of this.standing.get(districtName(neighbour)) ?? []) shared.view.add(this.walkers.get(other)!.entity);
      // Its first holder is a joining socket (full state follows the join) or a crossing one (rebaselined by the
      // room), so the queued snapshot would only repeat what that decoder already receives.
      shared.view.changes.clear();
      this.views.set(name, shared);
    }
    shared.holders.add(id);
    return shared.view;
  }

  private release(id: string, cell: DistrictCell): void {
    const name = districtName(cell), shared = this.views.get(name);
    if (!shared) return;
    shared.holders.delete(id);
    // An empty district's view is disposed so its per-tree visibility bits cannot leak to the next view id.
    if (shared.holders.size === 0) { shared.view.dispose(); this.views.delete(name); }
  }

  private stand(id: string, cell: DistrictCell) {
    const name = districtName(cell);
    let ids = this.standing.get(name);
    if (!ids) this.standing.set(name, ids = new Set());
    ids.add(id);
  }

  private unstand(id: string, cell: DistrictCell) {
    const name = districtName(cell), ids = this.standing.get(name);
    ids?.delete(id);
    if (ids?.size === 0) this.standing.delete(name);
  }

  private *ringOf(cell: DistrictCell): Generator<DistrictCell> {
    for (let dx = -this.grid.ring; dx <= this.grid.ring; dx++) for (let dz = -this.grid.ring; dz <= this.grid.ring; dz++) yield { cx: cell.cx + dx, cz: cell.cz + dz };
  }

  /** Live views whose centre lies in the ring around `cell`; only these can cover it. */
  private around(cell: DistrictCell): DistrictView[] {
    const found: DistrictView[] = [];
    for (const neighbour of this.ringOf(cell)) { const shared = this.views.get(districtName(neighbour)); if (shared) found.push(shared); }
    return found;
  }
}
