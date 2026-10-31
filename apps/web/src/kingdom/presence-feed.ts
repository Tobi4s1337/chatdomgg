import {
  KingdomIdSchema, KingdomPresenceFrameSchema, PersonIdSchema, PRESENCE_LEASE_MS, PRESENCE_MINUTE_MS,
  type KingdomId, type KingdomPresenceFrame, type PresenceFeed, type PresenceInput, type PresencePerson,
} from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_TIME } from '@chatdom/shared/world-fixtures';
import {
  advancePresence, applyPresence, createPresenceState, presenceTick, projectPresence, seedHash,
  type KingdomLayout, type SettlementPlan, type PresenceBinding,
} from '@chatdom/world';

const NAMES = [
  'Juniper', 'Moss', 'Rue', 'Sable', 'Rowan', 'Wren', 'Hazel', 'Bramble',
  'Pip', 'Clover', 'Fern', 'Robin', 'Ash', 'Briar', 'Finch', 'Willow',
  'Nettle', 'Sorrel', 'Thistle', 'Alder', 'Yarrow', 'Linden', 'Laurel', 'Ivy',
] as const;

interface Arrival {
  readonly at: number;
  readonly person: PresencePerson;
}

export interface SimulatedPresence {
  readonly feed: PresenceFeed;
  readonly firstSlot: number;
  readonly epochMs: number;
  /** Seconds from the fixed simulation epoch, suitable for a camera/capture cue. */
  readonly completeAt: number;
  /** Absolute elapsed seconds; seeking backwards reproduces the same presence. */
  advance(seconds: number, sampleFrame?: boolean): void;
  reset(): void;
}

/** A labelled scenario producer. Every light and name passes through the world reducer. */
export function createSimulatedPresence(layout: Pick<KingdomLayout, 'homes' | 'config'> | Pick<SettlementPlan, 'homes' | 'config'>, arrival?: { firstSlot: number; waveSeconds: number }): SimulatedPresence {
  if (!layout.homes.length) throw new TypeError('Presence scenario needs at least one home');
  const newestYear = Math.max(...layout.homes.map(home => home.quarterYear));
  const first = layout.homes.find(home => home.slot === arrival?.firstSlot) ?? layout.homes.find(home => home.quarterYear === newestYear && home.position[0] > 0)
    ?? layout.homes.find(home => home.quarterYear === newestYear)!;
  const ordered = [first, ...layout.homes.filter(home => home !== first).sort((a, b) => a.slot - b.slot)];
  // Stage a small late procession through the neighbourhood after the main wave.
  // Their street walks remain visible while the labelled rehearsal is warm.
  // This stages only the SIMULATED feed; live observations keep their own times.
  const lateNeighbours = new Map<number, number>();
  if (arrival && ordered.length > 8) {
    const x = Math.min(...ordered.map(home => home.position[0])) * .3;
    const z = Math.max(...ordered.map(home => home.position[2])) * .3;
    const distance = (home: typeof first) => Math.hypot(home.position[0] - x, home.position[2] - z);
    const neighbours = ordered.filter(home => home !== first).sort((a, b) => distance(a) - distance(b) || a.slot - b.slot)
      .slice(0, Math.min(32, Math.max(2, Math.round(ordered.length * .15))));
    neighbours.forEach((home, index) => lateNeighbours.set(home.slot, 16_000 + index * 250));
  }
  const bindings: PresenceBinding[] = [];
  const furthest = Math.max(1, ...ordered.map(home => Math.hypot(home.position[0] - first.position[0], home.position[2] - first.position[2])));
  const arrivals: Arrival[] = ordered.map((home, index) => {
    const personId = PersonIdSchema.parse((900_000_000_000_001_000n + BigInt(home.slot)).toString());
    bindings.push({ personId, slot: home.slot });
    const distance = Math.hypot(home.position[0] - first.position[0], home.position[1] - first.position[1], home.position[2] - first.position[2]);
    const at = index === 0 ? 1000 : lateNeighbours.get(home.slot) ?? Math.round((arrival ? 2 + Math.min(1, distance / furthest) * arrival.waveSeconds : Math.min(20, 4 + distance / 18)) * 1000);
    const name = index % 3 === 0 ? NAMES[index / 3] : undefined;
    const person: PresencePerson = name ? { personId, disclosure: 'named', displayName: name } : { personId, disclosure: 'anonymous' };
    return { at, person };
  }).sort((a, b) => a.at - b.at || a.person.personId.localeCompare(b.person.personId));
  const epoch = `simulation:${seedHash(layout.config.seed)}`;
  const sessionId = `${epoch}:night`;
  const listeners = new Set<(frame: KingdomPresenceFrame) => void>();
  let state = createPresenceState(WORLD_FIXTURE_KINGDOM, 'simulated');
  let elapsed = 0;
  let cursor = 0;
  let heartbeatAt = PRESENCE_MINUTE_MS;
  let sequence = 0;
  let eventSequence = 0;
  let frame: KingdomPresenceFrame;

  function common(at: number) {
    return {
      version: 1 as const, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated' as const,
      observedAt: WORLD_FIXTURE_TIME + at, id: `simulation:${++eventSequence}`,
    };
  }

  function apply(input: PresenceInput, at: number): void {
    state = applyPresence(state, input, WORLD_FIXTURE_TIME + at);
  }

  function start(): void {
    state = createPresenceState(WORLD_FIXTURE_KINGDOM, 'simulated');
    elapsed = 0;
    cursor = 0;
    heartbeatAt = PRESENCE_MINUTE_MS;
    eventSequence = 0;
    apply({ ...common(0), kind: 'stream', live: true, sessionId }, 0);
  }

  function publish(at: number): void {
    frame = projectPresence(state, bindings, WORLD_FIXTURE_TIME + at, sequence++, epoch);
    for (const receive of listeners) receive(frame);
  }

  start();
  publish(0);
  const feed: PresenceFeed = {
    label: 'SIMULATED',
    subscribe(receive) {
      listeners.add(receive);
      receive(frame);
      return () => { listeners.delete(receive); };
    },
  };
  return {
    feed, firstSlot: first.slot, epochMs: WORLD_FIXTURE_TIME, completeAt: arrivals.at(-1)!.at / 1000,
    advance(seconds, sampleFrame = false) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds * 1000 + WORLD_FIXTURE_TIME > 8_640_000_000_000_000) {
        throw new RangeError('Simulation time must be a nonnegative supported timestamp');
      }
      const target = Math.round(seconds * 1000);
      let changed = target < elapsed;
      // Bound a single interactive seek; normal long-running playback is uncapped.
      if ((changed ? target : target - elapsed) / PRESENCE_MINUTE_MS > 10_000) throw new RangeError('Simulation seek exceeds the event-work budget');
      if (changed) start();
      while (Math.min(arrivals[cursor]?.at ?? Infinity, heartbeatAt) <= target) {
        const at = Math.min(arrivals[cursor]?.at ?? Infinity, heartbeatAt);
        const people: PresencePerson[] = [];
        while (arrivals[cursor]?.at === at) people.push(arrivals[cursor++]!.person);
        for (const disclosure of ['named', 'anonymous'] as const) {
          const batch = people.filter(person => person.disclosure === disclosure);
          if (batch.length) apply({ ...common(at), kind: 'observe', source: disclosure === 'named' ? 'chat' : 'chatters', coverage: disclosure === 'named' ? 'activity' : 'partial', people: batch }, at);
        }
        if (at === heartbeatAt) {
          apply({ ...common(at), kind: 'stream', live: true, sessionId }, at);
          apply({
            ...common(at), kind: 'observe', source: 'chatters', coverage: 'complete',
            people: arrivals.slice(0, cursor).map(({ person }) => ({ personId: person.personId, disclosure: 'anonymous' })),
          }, at);
          // Eligibility is exercised and discarded. No simulated ledger exists.
          state = presenceTick(state, WORLD_FIXTURE_TIME + at).state;
          heartbeatAt += PRESENCE_MINUTE_MS;
        }
        changed = true;
      }
      elapsed = target;
      if (changed || sampleFrame) {
        state = advancePresence(state, WORLD_FIXTURE_TIME + target);
        publish(target);
      }
    },
    reset() {
      start();
      publish(0);
    },
  };
}

/**
 * Public-only SSE transport. A connection supplies full frames, never private
 * observations. Epoch changes are accepted only after a new connection opens;
 * reopening the same epoch retains its sequence watermark.
 */
export function createHeraldPresence(url = '/presence-data/stream', kingdomId?: KingdomId, expectedOrigin: KingdomPresenceFrame['origin'] = 'live'): PresenceFeed {
  if (kingdomId !== undefined) KingdomIdSchema.parse(kingdomId);
  if (expectedOrigin !== 'live' && expectedOrigin !== 'simulated') throw new TypeError('Unknown presence origin');
  return {
    label: expectedOrigin === 'simulated' ? 'SIMULATED' : 'LIVE',
    subscribe(receive, unavailable) {
      let expectedKingdom = kingdomId;
      let disposed = false;
      let unavailableSignalled = false;
      let current: EventSource | null = null;
      let generation = 0;
      let staleTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
      let retryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
      let acceptedEpoch: string | null = null;
      let epochBudgetExhausted = false;
      const seenEpochs = new Map<string, { sequence: number; asOf: number }>();

      function clearStale(): void {
        if (staleTimer !== undefined) globalThis.clearTimeout(staleTimer);
        staleTimer = undefined;
      }

      function fail(): void {
        clearStale();
        if (!disposed && !unavailableSignalled) {
          unavailableSignalled = true;
          unavailable();
        }
      }

      function connect(): void {
        if (disposed || epochBudgetExhausted) return;
        let source: EventSource;
        try { source = new globalThis.EventSource(url); }
        catch { fail(); return; }
        current = source;
        const ownGeneration = ++generation;
        let connectionEpoch: string | null = null;
        const active = () => !disposed && current === source && generation === ownGeneration;
        staleTimer = globalThis.setTimeout(() => { if (active()) fail(); }, PRESENCE_LEASE_MS);
        source.onopen = () => {
          if (active()) connectionEpoch = null;
        };
        source.onmessage = event => {
          if (!active()) return;
          let parsed: ReturnType<typeof KingdomPresenceFrameSchema.safeParse>;
          try { parsed = KingdomPresenceFrameSchema.safeParse(JSON.parse(event.data)); }
          catch { fail(); return; }
          if (!parsed.success || parsed.data.origin !== expectedOrigin) { fail(); return; }
          const frame = parsed.data;
          if ((expectedKingdom !== undefined && frame.kingdomId !== expectedKingdom)
            || (connectionEpoch !== null && frame.epoch !== connectionEpoch)) { fail(); return; }
          const previous = seenEpochs.get(frame.epoch);
          // A retired producer cannot restore a name removed by its successor.
          if (previous && acceptedEpoch !== frame.epoch) { fail(); return; }
          if (!previous && seenEpochs.size >= 64) {
            epochBudgetExhausted = true; fail(); source.close(); current = null; return;
          }
          expectedKingdom ??= frame.kingdomId;
          connectionEpoch ??= frame.epoch;
          if (previous && (frame.sequence <= previous.sequence || frame.asOf < previous.asOf)) return;
          acceptedEpoch = frame.epoch;
          seenEpochs.set(frame.epoch, { sequence: frame.sequence, asOf: frame.asOf });
          clearStale();
          // Both receipt silence and old frame timestamps expire. A future server
          // timestamp never grants more than one lease from local receipt time.
          const remaining = Math.min(PRESENCE_LEASE_MS, frame.asOf + PRESENCE_LEASE_MS - Date.now());
          if (remaining <= 0) { fail(); return; }
          unavailableSignalled = false;
          receive(frame);
          if (active()) staleTimer = globalThis.setTimeout(fail, remaining);
        };
        source.onerror = () => {
          if (!active()) return;
          fail();
          source.close();
          current = null;
          // Own retries so queued callbacks from a replaced source cannot relight
          // anything. An EventSource constructor alone never signals LIVE.
          if (!disposed) retryTimer = globalThis.setTimeout(connect, 1000);
        };
      }

      connect();
      return () => {
        disposed = true;
        generation++;
        clearStale();
        if (retryTimer !== undefined) globalThis.clearTimeout(retryTimer);
        current?.close();
        current = null;
      };
    },
  };
}
