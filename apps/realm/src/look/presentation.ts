import type { KingdomId, PersonId } from '@chatdom/shared';
import type { RealmWalkerPresentation } from '@chatdom/shared/realm';
import type { RealmLifecycleListener } from '../persistence/kingdom';
import type { RealmRoomEffects } from '../ports';
import type { LookSaved } from './ports';

/** The part of `DurableKingdom` this hook composes with. */
export interface LookPresentationHost {
  readonly kingdomId: KingdomId;
  bindRoom(effects: RealmRoomEffects): () => void;
  onLifecycle(listener: RealmLifecycleListener): () => void;
}

/** The part of `LookStore` this hook reads. */
export interface LookPresentationSource {
  onSaved(listener: LookSaved): () => void;
  current(personId: PersonId): Promise<{ readonly token: string; readonly savedAt: number } | null>;
}

interface Saved { readonly token: string; readonly savedAt: number }

/**
 * Makes a kingdom's walkers wear their person's current saved look, live.
 *
 * Why it wraps: `DurableKingdom` presents a walker with `principal.look`, which the authenticator fixed at entry. It
 * does so on join and reconnect and again whenever homes change (`refreshPresentations`), so after a save it would
 * put the old look back. The kingdom and the room are not this module's to change, so this wraps the kingdom's
 * `bindRoom`: the room's `presentWalker` effect then always receives the person's newest saved token, keeping the
 * kingdom's own home slot. On a save, the person's walkers here are re-presented with their last home slot. The
 * cleaner hook the room owner could add instead is in README.md.
 *
 * Attach before the room binds (main's `attach` runs when the kingdom opens, before any room). Returns the detach.
 */
export function attachLookPresentation(kingdom: LookPresentationHost, looks: LookPresentationSource, log: (line: string) => void = () => {}): () => void {
  const persons = new Map<string, PersonId>(), slots = new Map<string, number>();
  /** Only people walking here, and only once they saved after entering (or the store says so). */
  const saved = new Map<PersonId, Saved>();
  const rooms = new Set<RealmRoomEffects>();

  const lookOf = (walkerId: string, entered: string) => { const person = persons.get(walkerId); return (person && saved.get(person)?.token) ?? entered; };
  const present = (walkerId: string) => {
    const person = persons.get(walkerId), slot = slots.get(walkerId), look = person && saved.get(person)?.token;
    if (slot === undefined || !look) return;
    for (const room of rooms) room.presentWalker?.(walkerId, { homeSlot: slot, look });
  };
  const walkersOf = (personId: PersonId) => [...persons].filter(([, person]) => person === personId).map(([walkerId]) => walkerId);
  const learn = (personId: PersonId, value: Saved) => {
    const known = saved.get(personId);
    if (known && known.savedAt > value.savedAt) return false;
    saved.set(personId, value);
    return true;
  };

  const bindRoom = kingdom.bindRoom, own = Object.prototype.hasOwnProperty.call(kingdom, 'bindRoom');
  kingdom.bindRoom = (effects: RealmRoomEffects) => {
    const target = effects.presentWalker?.bind(effects);
    const wrapped: RealmRoomEffects = {
      close: reason => effects.close(reason),
      readWalker: walkerId => effects.readWalker(walkerId),
      placeWalker: (walkerId, position, revision) => effects.placeWalker(walkerId, position, revision),
      allowWalking: (walkerId, allowed) => effects.allowWalking(walkerId, allowed),
      adoptWorld: (world, layoutRevision, positions) => effects.adoptWorld(world, layoutRevision, positions),
      ...(target ? { presentWalker: (walkerId: string, presentation: RealmWalkerPresentation) => {
        slots.set(walkerId, presentation.homeSlot);
        target(walkerId, { homeSlot: presentation.homeSlot, look: lookOf(walkerId, presentation.look) });
      } } : {}),
    };
    rooms.add(effects);
    const detach = bindRoom.call(kingdom, wrapped);
    return () => { rooms.delete(effects); detach(); };
  };

  const offLifecycle = kingdom.onLifecycle((event, principal, walkerId) => {
    const personId = principal.personId;
    if (event === 'leave') {
      persons.delete(walkerId); slots.delete(walkerId);
      if (!walkersOf(personId).length) saved.delete(personId);
      return;
    }
    persons.set(walkerId, personId);
    if (event === 'drop') return;
    // The kingdom has just presented this walker with the look fixed at entry; correct it at once if a newer save
    // is known here, then ask the store, which also covers a save made between sign-in and this join.
    present(walkerId);
    void looks.current(personId).then(current => {
      if (!current || persons.get(walkerId) !== personId) return;
      if (learn(personId, current)) present(walkerId);
    }, error => log(`look presentation read failed: ${(error as Error).name}`));
  });

  const offSaved = looks.onSaved(({ personId, token, savedAt }) => {
    const walkers = walkersOf(personId);
    if (!walkers.length || !learn(personId, { token, savedAt })) return;
    for (const walkerId of walkers) present(walkerId);
  });

  return () => {
    offSaved(); offLifecycle();
    if (own) kingdom.bindRoom = bindRoom; else Reflect.deleteProperty(kingdom, 'bindRoom');
    persons.clear(); slots.clear(); saved.clear(); rooms.clear();
  };
}
