import {
  PersonIdSchema, PRESENCE_LEASE_MS, PRESENCE_MINUTE_MS,
  type KingdomPresenceFrame, type PresenceFeed, type PresenceInput, type PresencePerson,
} from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '@chatdom/shared/world-fixtures';
import {
  advancePresence, applyPresence, createPresenceState, presenceTick, projectPresence, randomUnit, seedHash,
  type PresenceBinding, type SettlementPlan,
} from '@chatdom/world';
import type { SimulatedPresence } from '../presence-feed';

/** Fixture names for the labelled simulation only. One citizen in three discloses one; the first is always named. */
const FIXTURE_NAMES = [
  'Juniper', 'Moss', 'Rue', 'Sable', 'Rowan', 'Wren', 'Hazel', 'Bramble', 'Pip', 'Clover',
  'Fern', 'Robin', 'Ash', 'Briar', 'Finch', 'Willow', 'Nettle', 'Sorrel', 'Thistle', 'Alder',
  'Yarrow', 'Linden', 'Laurel', 'Ivy', 'Tansy', 'Bryony', 'Heath', 'Marigold', 'Basil', 'Lark',
  'Quill', 'Saffron', 'Teasel', 'Oriel', 'Bracken', 'Poppy', 'Sage', 'Ember', 'Holly', 'Cress',
  'Dove', 'Flint', 'Garnet', 'Hollis', 'Indigo', 'Jasper', 'Kestrel', 'Lupin', 'Maple', 'Nell',
  'Otto', 'Pebble', 'Quince', 'Reed', 'Skye', 'Tamsin', 'Umber', 'Vetch', 'Wynn', 'Yew',
  'Zinnia', 'Acorn', 'Birch', 'Cedar', 'Dahlia', 'Elm', 'Gorse', 'Heron', 'Iris', 'Juno',
  'Kale', 'Lumen', 'Mallow', 'Nutmeg', 'Olive', 'Perrin', 'Rook', 'Sorcha', 'Tilly', 'Wisp',
] as const;

/** The stream went live this long before the visitor opens the town. */
const HISTORY_MS = 48 * PRESENCE_MINUTE_MS;
const STAY_MIN_MS = 3 * PRESENCE_MINUTE_MS;
const STAY_MAX_MS = 45 * PRESENCE_MINUTE_MS;
const OCCUPANCY_LOW = .8;
const OCCUPANCY_HIGH = .9;
/** A citizen still walking away is not yet free to come back in. */
const REJOIN_AFTER_MS = 2 * PRESENCE_MINUTE_MS;
const MAX_EPOCH_MS = 8_640_000_000_000_000;

interface Citizen {
  readonly slot: number;
  readonly person: PresencePerson;
  readonly roster: PresencePerson;
}
interface Arrival { readonly at: number; readonly citizen: Citizen }
type Mode = 'evening' | 'arrival';

export interface SimulatedEveningOptions {
  /** The named first citizen; present on open and the first window of a replayed arrival. */
  firstSlot: number;
  /** Spread of the replayed dark → one window → town wave. */
  waveSeconds?: number;
}

/**
 * SIMULATED only: an evening already under way. Every stay goes through the
 * world presence reducer as fixture chat and roster observations inside one
 * simulated stream; motion then walks each citizen home from its own `since`.
 * Nothing here sets `homeLit`, touches a Herald frame or borrows a live name.
 *
 * Integration: select it only for `source === 'simulated'`, in place of
 * `createSimulatedPresence(layout, { firstSlot, waveSeconds: 6 })`. Read
 * `epochMs` every frame (a replay moves it), sample motion at
 * `epochMs + time * 1000`, and bind "Let them in" to `replayArrival()` after
 * clearing windows and crowd. A replay's new epoch clears motion by itself.
 */
export function createSimulatedEvening(
  layout: Pick<SettlementPlan, 'homes' | 'config'>, options: SimulatedEveningOptions,
): SimulatedPresence & { replayArrival(): void } {
  const homes = layout.homes;
  if (!homes.length) throw new TypeError('The simulated evening needs at least one home');
  const found = homes.find(home => home.slot === options.firstSlot);
  if (!found) throw new TypeError('The simulated evening needs its first slot to be a home');
  const first = found;
  const waveSeconds = options.waveSeconds ?? 6;
  if (!Number.isFinite(waveSeconds) || waveSeconds < 0) throw new RangeError('Arrival wave seconds must be finite and nonnegative');

  const seed = layout.config.seed;
  const unit = (key: string): number => randomUnit(seedHash(`${seed}:evening:${key}`));
  const ordered = [first, ...homes.filter(home => home !== first).sort((a, b) => a.slot - b.slot)];
  const citizens = new Map<number, Citizen>();
  const bindings: PresenceBinding[] = ordered.map((home, index) => {
    const personId = PersonIdSchema.parse((900_000_000_000_100_000n + BigInt(home.slot)).toString());
    const name = index % 3 === 0 ? FIXTURE_NAMES[index / 3] : undefined;
    const roster: PresencePerson = { personId, disclosure: 'anonymous' };
    citizens.set(home.slot, { slot: home.slot, person: name ? { personId, disclosure: 'named', displayName: name } : roster, roster });
    return { personId, slot: home.slot };
  });

  // Who is already home when the town opens, and since when. firstSlot is always among them.
  const target = OCCUPANCY_LOW + (OCCUPANCY_HIGH - OCCUPANCY_LOW) * unit('occupancy');
  const settledCount = Math.max(1, Math.min(Math.floor(homes.length * OCCUPANCY_HIGH),
    Math.max(Math.ceil(homes.length * OCCUPANCY_LOW), Math.round(homes.length * target))));
  const settled = [first, ...homes.filter(home => home !== first)
    .map(home => ({ home, order: unit(`settled:${home.slot}`) }))
    .sort((a, b) => a.order - b.order || a.home.slot - b.home.slot)
    .map(({ home }) => home)].slice(0, settledCount);
  const evening: Arrival[] = settled.map(home => ({
    at: HISTORY_MS - Math.round((STAY_MIN_MS + (STAY_MAX_MS - STAY_MIN_MS) * unit(`stay:${home.slot}`)) / 100) * 100,
    citizen: citizens.get(home.slot)!,
  })).sort((a, b) => a.at - b.at || a.citizen.slot - b.citizen.slot);

  // Today's explicit "Let them in" wave: dark, one named window at one second, then the town by distance.
  const furthest = Math.max(1, ...ordered.map(home => Math.hypot(home.position[0] - first.position[0], home.position[2] - first.position[2])));
  const wave: Arrival[] = ordered.map((home, index) => {
    const distance = Math.hypot(home.position[0] - first.position[0], home.position[1] - first.position[1], home.position[2] - first.position[2]);
    return { at: index === 0 ? 1000 : Math.round((2 + Math.min(1, distance / furthest) * waveSeconds) * 1000), citizen: citizens.get(home.slot)! };
  }).sort((a, b) => a.at - b.at || a.citizen.slot - b.citizen.slot);

  const baseEpoch = `simulation:${seedHash(seed)}`;
  const listeners = new Set<(frame: KingdomPresenceFrame) => void>();
  let mode: Mode = 'evening';
  let replays = 0;
  let epoch = `${baseEpoch}:evening`;
  let sequence = 0;
  let frame: KingdomPresenceFrame;

  // Per-run state, rebuilt by start() so any seek replays the same recorded inputs.
  let state = createPresenceState(WORLD_FIXTURE_KINGDOM, 'simulated');
  let elapsed = 0;
  let scheduled: readonly Arrival[] = evening;
  let cursor = 0;
  let heartbeatAt = PRESENCE_MINUTE_MS;
  let inputSequence = 0;
  let arrivalTick = 0;
  let arrivalAt = Infinity;
  let departureTick = 0;
  let departureAt = Infinity;
  const present = new Map<number, number>();
  const departed = new Map<number, number>();

  const open = (): number => mode === 'evening' ? HISTORY_MS : 0;
  const sessionId = (): string => `${epoch}:stream`;

  function common(at: number) {
    return { version: 1 as const, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated' as const, observedAt: WORLD_FIXTURE_TIME + at, id: `${epoch}:${++inputSequence}` };
  }

  function apply(input: PresenceInput, at: number): void {
    state = applyPresence(state, input, WORLD_FIXTURE_TIME + at);
  }

  function pick<T>(items: readonly T[], key: string): T | undefined {
    return items.length ? items[Math.min(items.length - 1, Math.floor(unit(key) * items.length))] : undefined;
  }

  function start(): void {
    state = createPresenceState(WORLD_FIXTURE_KINGDOM, 'simulated');
    scheduled = mode === 'evening' ? evening : wave;
    cursor = 0;
    heartbeatAt = PRESENCE_MINUTE_MS;
    inputSequence = 0;
    present.clear();
    departed.clear();
    arrivalTick = 0;
    departureTick = 0;
    // The first visible arrival and departure come early so an opened town is already moving.
    arrivalAt = mode === 'evening' ? HISTORY_MS + Math.round((6 + 6 * unit('arrive:gap:0')) * 1000) : Infinity;
    departureAt = mode === 'evening' ? HISTORY_MS + Math.round((15 + 10 * unit('leave:gap:0')) * 1000) : Infinity;
    apply({ ...common(0), kind: 'stream', live: true, sessionId: sessionId() }, 0);
    elapsed = 0;
    pump(open());
  }

  /** Feed every scheduled input up to `until` into the reducer. Returns whether anything was observed. */
  function pump(until: number): boolean {
    let changed = false;
    for (;;) {
      const at = Math.min(scheduled[cursor]?.at ?? Infinity, heartbeatAt, arrivalAt, departureAt);
      if (at > until) break;
      const arriving: Citizen[] = [];
      while (scheduled[cursor]?.at === at) arriving.push(scheduled[cursor++]!.citizen);
      if (at === arrivalAt) {
        // Someone comes in while the town has room; a full evening simply lets the moment pass.
        if (present.size + arriving.length < Math.floor(homes.length * OCCUPANCY_HIGH)) {
          const away = ordered.filter(home => !present.has(home.slot) && !arriving.some(citizen => citizen.slot === home.slot)
            && at - (departed.get(home.slot) ?? -Infinity) >= REJOIN_AFTER_MS);
          const home = pick(away, `arrive:${arrivalTick}`);
          if (home) arriving.push(citizens.get(home.slot)!);
        }
        arrivalTick++;
        arrivalAt = at + Math.round((20 + 20 * unit(`arrive:gap:${arrivalTick}`)) * 1000);
      }
      for (const disclosure of ['named', 'anonymous'] as const) {
        const people = arriving.filter(citizen => citizen.person.disclosure === disclosure).map(citizen => citizen.person);
        if (people.length) {
          apply({ ...common(at), kind: 'observe', source: disclosure === 'named' ? 'chat' : 'chatters',
            coverage: disclosure === 'named' ? 'activity' : 'partial', people }, at);
        }
      }
      for (const citizen of arriving) present.set(citizen.slot, at);
      let roster = at === heartbeatAt;
      if (at === departureAt) {
        // A complete roster without them is the leave. Their arrival chat lease has lapsed by then.
        const leaving = pick([...present].filter(([slot, since]) => slot !== first.slot && at - since >= PRESENCE_LEASE_MS)
          .map(([slot]) => slot).sort((a, b) => a - b), `leave:${departureTick}`);
        if (leaving !== undefined) {
          present.delete(leaving);
          departed.set(leaving, at);
          roster = true;
        }
        departureTick++;
        departureAt = at + Math.round((45 + 45 * unit(`leave:gap:${departureTick}`)) * 1000);
      }
      if (at === heartbeatAt) apply({ ...common(at), kind: 'stream', live: true, sessionId: sessionId() }, at);
      if (roster) {
        apply({ ...common(at), kind: 'observe', source: 'chatters', coverage: 'complete',
          people: [...present.keys()].sort((a, b) => a - b).map(slot => citizens.get(slot)!.roster) }, at);
      }
      if (at === heartbeatAt) {
        // Eligibility is exercised and discarded. No simulated ledger exists.
        state = presenceTick(state, WORLD_FIXTURE_TIME + at).state;
        heartbeatAt += PRESENCE_MINUTE_MS;
      }
      changed = true;
    }
    elapsed = until;
    return changed;
  }

  function publish(): void {
    state = advancePresence(state, WORLD_FIXTURE_TIME + elapsed);
    frame = projectPresence(state, bindings, WORLD_FIXTURE_TIME + elapsed, sequence++, epoch);
    for (const receive of listeners) receive(frame);
  }

  start();
  publish();
  const feed: PresenceFeed = {
    label: 'SIMULATED',
    subscribe(receive) {
      listeners.add(receive);
      receive(frame);
      return () => { listeners.delete(receive); };
    },
  };
  return {
    feed,
    firstSlot: first.slot,
    /** The kingdom clock at `advance(0)`: the evening opens 48 minutes into its stream; a replay opens at its own start. */
    get epochMs() { return WORLD_FIXTURE_TIME + open(); },
    /** The evening is settled on open; a replayed wave completes with its furthest window. */
    get completeAt() { return mode === 'evening' ? 0 : wave.at(-1)!.at / 1000; },
    advance(seconds, sampleFrame = false) {
      if (!Number.isFinite(seconds) || seconds < 0 || WORLD_FIXTURE_TIME + open() + seconds * 1000 > MAX_EPOCH_MS) {
        throw new RangeError('Simulation time must be a nonnegative supported timestamp');
      }
      const until = open() + Math.round(seconds * 1000);
      const backwards = until < elapsed;
      // Bound a single interactive seek; normal long-running playback is uncapped.
      if ((backwards ? until : until - elapsed) / PRESENCE_MINUTE_MS > 10_000) throw new RangeError('Simulation seek exceeds the event-work budget');
      if (backwards) start();
      const observed = pump(until);
      if (backwards || observed || sampleFrame) publish();
    },
    reset() {
      mode = 'evening';
      epoch = `${baseEpoch}:evening`;
      start();
      publish();
    },
    replayArrival() {
      mode = 'arrival';
      epoch = `${baseEpoch}:arrival.${++replays}`;
      start();
      publish();
    },
  };
}
