import { dabHashOf, type ChannelFace, type PencilPosition } from '../data/directory';
import { kingdomOf, type FoundedKingdoms } from '../data/kingdoms';

/**
 * Channels a visitor found that the drawn world does not hold: a search result, a card or a road's end outside the
 * survey. The Atlas draws each one where it has always belonged, at its deterministic pencil place in its language
 * and game realm, with the same ink, lettering and collision rules as a surveyed mark, so the flight lands on it and
 * the card anchors to it. A found channel is drawn for this visitor only, for the session; it is never written to the
 * survey and is never granted land. Nothing here is Pixi: the overlay draws what `foundMarks` returns.
 */

/** At most this many found channels are drawn at once; the oldest gives way to a newer find. */
export const FOUND_LIMIT = 24;
/** A saved view or the session brings back at most this many, each read again from the register first. */
export const FOUND_RESTORE_LIMIT = 12;

/** What the register said of a found channel: its face and its pencil place. */
export interface FoundEntry { readonly face: ChannelFace; readonly position: PencilPosition }

/** How a found channel is drawn: a pencil flag (waiting for land), or a founded kingdom's arms on a hamlet. */
export type FoundKind = 'waiting' | 'kingdom';

/** One found channel as the map draws it. */
export interface FoundMark {
  readonly id: string;
  readonly kind: FoundKind;
  /** Its lettering: the channel's own name for a pencil flag, the kingdom's name for a founded kingdom. */
  readonly label: string | null;
  readonly x: number;
  readonly y: number;
  /** The channel's live pencil-flag hash, so a found channel on air is drawn once, as itself. */
  readonly hash: string;
}

/** What may veto a found channel at draw time: the drawn holdings and the names projection's withheld set. */
export interface FoundGate {
  byId: { has(id: string): boolean };
  isWithheld(id: string): boolean;
}

/**
 * The channels found this session, newest last. Adding one again moves it to the end; past the limit the oldest is
 * dropped. `version` changes with every change, so the page knows when to draw again or save.
 */
export class FoundRegistry {
  private readonly entries = new Map<string, FoundEntry>();
  version = 0;

  constructor(private readonly limit = FOUND_LIMIT) {}

  /** Keep a found channel. Only a named waiting channel with a finite pencil place is ever kept. */
  add(face: ChannelFace, position: PencilPosition | null | undefined): boolean {
    if (!foundable(face, position)) return false;
    const before = this.entries.get(face.id);
    if (before && before.position.x === position!.x && before.position.y === position!.y && sameFace(before.face, face)) {
      // Already the newest: nothing moves.
      if ([...this.entries.keys()].at(-1) === face.id) return false;
    }
    this.entries.delete(face.id);
    this.entries.set(face.id, { face, position: { x: position!.x, y: position!.y } });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    this.version++;
    return true;
  }

  remove(id: string): boolean {
    if (!this.entries.delete(id)) return false;
    this.version++;
    return true;
  }

  /** Drop every found channel the predicate refuses (withheld since, or now drawn as a holding). */
  keep(predicate: (entry: FoundEntry) => boolean): boolean {
    let changed = false;
    for (const [id, entry] of this.entries) if (!predicate(entry)) { this.entries.delete(id); changed = true; }
    if (changed) this.version++;
    return changed;
  }

  clear(): void {
    if (!this.entries.size) return;
    this.entries.clear();
    this.version++;
  }

  get(id: string): FoundEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Channel IDs, oldest first: what a saved view and the session carry. */
  ids(): string[] {
    return [...this.entries.keys()];
  }

  list(): FoundEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}

function sameFace(a: ChannelFace, b: ChannelFace): boolean {
  return a.id === b.id && a.login === b.login && a.name === b.name && a.place === b.place && a.region === b.region && a.realm === b.realm;
}

/** A found channel can be drawn only as what it is: observed or looked up, without a holding, at a real place. */
export function foundable(face: ChannelFace, position: PencilPosition | null | undefined): position is PencilPosition {
  return face.place === 'waiting' && !!position && Number.isFinite(position.x) && Number.isFinite(position.y) && /^[0-9]{1,20}$/.test(face.id);
}

/**
 * The marks to draw now. A withheld channel (the operator's list or its own hide) is never drawn, and a channel the
 * world now holds is drawn as its holding instead. A founded kingdom is drawn as one only when the door names it
 * under the same login the register gave.
 */
export function foundMarks(entries: readonly FoundEntry[], gate: FoundGate, kingdoms: FoundedKingdoms): FoundMark[] {
  const out: FoundMark[] = [];
  for (const { face, position } of entries) {
    if (gate.isWithheld(face.id) || gate.byId.has(face.id)) continue;
    const kingdom = kingdomOf(kingdoms, face);
    out.push({
      id: face.id,
      kind: kingdom ? 'kingdom' : 'waiting',
      label: kingdom ? kingdom.name : face.name ?? face.login,
      x: position.x,
      y: position.y,
      hash: dabHashOf(face.id),
    });
  }
  return out;
}

/** Saved IDs as a view or the session carries them: digits only, unique, at most `limit`, newest kept. */
export function foundIds(value: unknown, limit = FOUND_RESTORE_LIMIT): string[] {
  if (!Array.isArray(value)) return [];
  const ids = [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[0-9]{1,20}$/.test(id)))];
  return ids.slice(Math.max(0, ids.length - limit));
}

/** The session's found channels for one map, kept in session storage so a reload in the same tab draws them again. */
export const FOUND_SESSION_KEY = 'chatdom:atlas:found:v1';

export function readFoundSession(storage: Pick<Storage, 'getItem'> | null, mapId: string): string[] {
  try {
    const raw = storage?.getItem(FOUND_SESSION_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as { mapId?: unknown; ids?: unknown };
    return value.mapId === mapId ? foundIds(value.ids) : [];
  } catch {
    return [];
  }
}

export function writeFoundSession(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, mapId: string, ids: readonly string[]): void {
  try {
    if (!ids.length) storage?.removeItem(FOUND_SESSION_KEY);
    else storage?.setItem(FOUND_SESSION_KEY, JSON.stringify({ mapId, ids: ids.slice(-FOUND_LIMIT) }));
  } catch {
    // Storage may be full or switched off; the marks stay drawn for this page all the same.
  }
}
