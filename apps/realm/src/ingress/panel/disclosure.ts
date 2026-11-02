import { REALM_CASTLE_SLOT, RealmObservedWalkerSchema, type RealmPublicMessage, type RealmWalkerFrame } from '@chatdom/shared/realm';
import type { DurableKingdom, DurableKingdomHold, DurableRealmServices, RealmDatabase } from '../../persistence';

/** How often an open watch rereads who asked to keep their name off the stream. One query per kingdom, not per viewer. */
export const QUIET_REFRESH_MS = 1_000;

export interface WatchDisclosureView {
  /** Resolves once the first quiet set is known; nothing is sent before it. */
  readonly ready: Promise<void>;
  /** Removes quiet people's names from one public message. It never adds a name, a light or a credit. */
  redact(message: RealmPublicMessage): RealmPublicMessage;
  /** Quiet walkers keep walking in the kingdom; their name never reaches the stream (see `redactWalkers`). */
  redactWalkers(frame: RealmWalkerFrame): RealmWalkerFrame;
  close(): void;
}
export interface WatchDisclosure { open(kingdom: DurableKingdom): WatchDisclosureView }

type Database = Pick<RealmDatabase, 'query'>;
interface Shared { users: number; slots: ReadonlySet<number> | 'all'; timer: ReturnType<typeof setInterval> | null; first: Promise<void> }

/**
 * The stream's side of "Keep my name off the stream". The preference lives in one row per person
 * (`setPersonQuiet`); the stream sees it as windows and credits without a name. Lights, homes, cards and stored facts
 * stay exactly as they are. If the preference cannot be read, every name is withheld until it can.
 */
export function createQuietDisclosure(options: { readonly db: Database; readonly origin: 'live' | 'simulated'; readonly refreshMs?: number }): WatchDisclosure {
  const shared = new Map<DurableKingdom, Shared>();
  const refresh = async (kingdom: DurableKingdom, entry: Shared) => {
    try { entry.slots = await quietSlots(options.db, options.origin, kingdom); }
    catch { entry.slots = 'all'; }
  };
  return {
    open(kingdom) {
      let entry = shared.get(kingdom);
      if (!entry) {
        const created: Shared = { users: 0, slots: 'all', timer: null, first: Promise.resolve() };
        created.first = refresh(kingdom, created);
        created.timer = setInterval(() => void refresh(kingdom, created), options.refreshMs ?? QUIET_REFRESH_MS);
        created.timer.unref?.();
        shared.set(kingdom, created);
        entry = created;
      }
      const own = entry;
      own.users++;
      let closed = false;
      return {
        ready: own.first,
        redact: message => redactMessage(message, own.slots),
        redactWalkers: frame => redactWalkers(frame, own.slots),
        close() {
          if (closed) return;
          closed = true;
          if (--own.users > 0) return;
          if (own.timer) clearInterval(own.timer);
          if (shared.get(kingdom) === own) shared.delete(kingdom);
        },
      };
    },
  };
}

/**
 * The stream's watch route, seen through quiet. The realm's public watch (`bootstrap/watch.ts`) reads each kingdom
 * through `services.retain`; composed in `main.ts`, this hands it a kingdom whose public deliveries and checkpoint carry
 * no quiet person's name, and walker frames that carry none either. Everything else is the kingdom itself. The hold resolves only once the quiet set is known,
 * so not one frame leaves before it. The committed facts, the walker room and every other reader are untouched.
 */
export function disclosedServices(services: Pick<DurableRealmServices, 'retain'>, disclosure: WatchDisclosure): Pick<DurableRealmServices, 'retain'> {
  return {
    async retain(kingdomId) {
      const hold = await services.retain(kingdomId);
      const view = disclosure.open(hold.kingdom);
      await view.ready;
      let released = false;
      const disclosed: DurableKingdomHold = {
        kingdom: disclosedKingdom(hold.kingdom, view),
        async release() { if (!released) { released = true; view.close(); } await hold.release(); },
      };
      return disclosed;
    },
  };
}

function disclosedKingdom(kingdom: DurableKingdom, view: WatchDisclosureView): DurableKingdom {
  const subscribe: DurableKingdom['subscribe'] = deliver => kingdom.subscribe(delivery => deliver({ ...delivery, message: view.redact(delivery.message) }));
  const checkpoint = <T extends { readonly current: readonly RealmPublicMessage[] }>(value: T): T => ({ ...value, current: value.current.map(message => view.redact(message)) });
  const publicCheckpoint: DurableKingdom['publicCheckpoint'] = () => checkpoint(kingdom.publicCheckpoint());
  const preparePublicCheckpoint: DurableKingdom['preparePublicCheckpoint'] = async () => checkpoint(await kingdom.preparePublicCheckpoint());
  const subscribeWalkers: DurableKingdom['subscribeWalkers'] = receive => kingdom.subscribeWalkers(frame => receive(view.redactWalkers(frame)));
  const currentWalkers: DurableKingdom['currentWalkers'] = () => view.redactWalkers(kingdom.currentWalkers());
  const own: Record<PropertyKey, unknown> = { subscribe, publicCheckpoint, preparePublicCheckpoint, subscribeWalkers, currentWalkers };
  return new Proxy(kingdom, {
    get(target, key) {
      if (Object.hasOwn(own, key)) return own[key];
      // The kingdom's own getters and methods run against the kingdom itself, never the view.
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** The visual slots of people who asked to stay off the stream: their own home or, for the monarch, the castle. */
export async function quietSlots(db: Database, origin: 'live' | 'simulated', kingdom: DurableKingdom): Promise<ReadonlySet<number>> {
  const state = kingdom.privateState, bySlot = new Map<string, number[]>();
  const bind = (personId: string, slot: number) => { const slots = bySlot.get(personId) ?? []; slots.push(slot); bySlot.set(personId, slots); };
  for (const home of Object.values(state.homes)) if (home.ownerId !== state.castle?.ownerId) bind(home.ownerId, home.slot);
  if (state.castle) bind(state.castle.ownerId, REALM_CASTLE_SLOT);
  if (!bySlot.size) return new Set();
  const rows = (await db.query<{ person_id: string }>('SELECT person_id FROM realm_panel_privacy WHERE origin = $1 AND quiet = true AND person_id = ANY($2::text[])',
    [origin, [...bySlot.keys()]])).rows;
  return new Set(rows.flatMap(row => bySlot.get(row.person_id) ?? []));
}

/** Pure: windows keep their light; credits tied to a quiet slot become the anonymous credit. */
export function redactMessage(message: RealmPublicMessage, quiet: ReadonlySet<number> | 'all'): RealmPublicMessage {
  if (quiet !== 'all' && quiet.size === 0) return message;
  const hidden = (slot: unknown) => quiet === 'all' || (typeof slot === 'number' && quiet.has(slot));
  if (message.type === 'presence') {
    return { ...message, frame: { ...message.frame, windows: message.frame.windows.map(window => window.publicName !== null && hidden(window.slot) ? { ...window, publicName: null } : window) } };
  }
  if (message.type === 'moment' || message.type === 'moments.current') return withoutCredits(message, hidden);
  return message;
}

/**
 * Whether the shared walker frame can carry a walker without a name. Main owns that schema and grand-world the label
 * that reads it (`work/lanes/panel-window/PW11-WALKER-NEEDS.patch`). A real parse of the shared schema, so it switches
 * on by itself.
 */
export const WALKER_NAMELESS: boolean = RealmObservedWalkerSchema.shape.name.safeParse(null).success;

/**
 * Pure: a walker whose home is a quiet slot never reaches the stream with their name. Where the walker frame can carry
 * a nameless walker, they walk on unlabelled. Until then a name is required, so the stream's frame leaves them out,
 * with their seat: they still walk in the kingdom itself, the walker room is untouched, and the stream simply does not
 * show them. Either way, nothing is added.
 */
export function redactWalkers(frame: RealmWalkerFrame, quiet: ReadonlySet<number> | 'all', nameless = WALKER_NAMELESS): RealmWalkerFrame {
  if (quiet !== 'all' && quiet.size === 0) return frame;
  const hidden = (walker: RealmWalkerFrame['walkers'][number]) => walker.name !== null && (quiet === 'all' || quiet.has(walker.homeSlot));
  if (!frame.walkers.some(hidden)) return frame;
  if (nameless) {
    const unnamed = null as unknown as RealmWalkerFrame['walkers'][number]['name'];
    return { ...frame, walkers: frame.walkers.map(walker => hidden(walker) ? { ...walker, name: unnamed } : walker) };
  }
  const left = new Set(frame.walkers.filter(hidden).map(walker => walker.id));
  return { ...frame, walkers: frame.walkers.filter(walker => !left.has(walker.id)),
    ...(frame.seats ? { seats: frame.seats.filter(seat => !left.has(seat.walkerId)) } : {}) };
}

/** A credit is `{ displayName, slot }`, nullable everywhere it appears in a moment fact. */
function withoutCredits<T>(value: T, hidden: (slot: unknown) => boolean): T {
  if (Array.isArray(value)) return value.map(item => withoutCredits(item, hidden)) as T;
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>, keys = Object.keys(record);
  if (keys.length === 2 && 'displayName' in record && 'slot' in record) return (hidden(record.slot) ? null : value) as T;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const key of keys) { next[key] = withoutCredits(record[key], hidden); if (next[key] !== record[key]) changed = true; }
  return (changed ? next : value) as T;
}
