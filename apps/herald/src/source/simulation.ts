import { STREAM_LEASE_MS, KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { toPresenceInput, type Observation } from './observations';
import type { PresenceSource } from './source';

/**
 * SIMULATED presence for development and screenshots. Every person here is synthetic, every frame carries
 * `origin: simulated`, and every observation crosses the same mapping, reducer, binding and projection path
 * as real Twitch input. Nothing here can open a Twitch connection or stand in for a failed real source.
 */

/** The world fixtures' simulated kingdom, so main's SIMULATED scene and this replay agree by default. */
export const SIMULATED_KINGDOM: KingdomId = KingdomIdSchema.parse('900000000000000001');

/** Synthetic people. IDs sit in a 16-digit range no Twitch account uses today; names are invented. */
const TALKERS = [
  { id: '9000000000000101', displayName: 'Juniper' },
  { id: '9000000000000102', displayName: 'MossLantern' },
  { id: '9000000000000103', displayName: 'quietbaker' },
  { id: '9000000000000104', displayName: 'Wrenfield' },
  { id: '9000000000000105', displayName: 'tallowmoth' },
] as const;
/** Few enough, with the talkers, to fit a first-year hamlet's twelve homes. */
const LURKERS = Array.from({ length: 6 }, (_, index) => `90000000000002${String(index + 1).padStart(2, '0')}`);

export const SCENARIOS = ['evening', 'quiet', 'offline', 'stale', 'unavailable'] as const;
export type ScenarioName = typeof SCENARIOS[number];

export const SCENARIO_NOTES: Readonly<Record<ScenarioName, string>> = {
  evening: 'live stream; named talkers and unnamed connected people come and go; one user clear puts a window out',
  quiet: 'live stream; only unnamed connected people, nobody chatting',
  offline: 'the kingdom gathers, then the broadcast is observed offline and the beacon rests',
  stale: 'stream evidence stops arriving and ages out: the kingdom stops claiming anyone is here',
  unavailable: 'chat delivery is lost: the stream closes and new subscribers are refused',
};

export interface ScenarioStep {
  readonly observations: readonly Observation[];
  /** Set when the scenario changes whether the source can stand behind its frames. */
  readonly available?: boolean;
}

export interface ScenarioOptions {
  /**
   * The order connected people are listed in a sweep. Reversing it after a restart shows that slots come
   * from the durable binding table, not from who happened to be listed first.
   */
  readonly arrival?: 'forward' | 'reverse';
}

/**
 * One second of a scenario. `t` counts whole seconds since the scenario started at `startAt`; the result is
 * a pure function of its arguments, so a replay is reproducible.
 */
export function scenarioStep(name: ScenarioName, t: number, startAt: number, options: ScenarioOptions = {}): ScenarioStep {
  const at = startAt + t * 1_000;
  const session = `simulated-${startAt.toString(36)}`;
  const observations: Observation[] = [];
  const minute = Math.floor(t / 60);
  const onMinute = t % 60 === 0;
  const live = (): Observation => ({ kind: 'stream', at, live: true, streamId: session });
  const order = (ids: readonly string[]) => options.arrival === 'reverse' ? [...ids].reverse() : [...ids];
  const sweep = (ids: readonly string[]): Observation => ({ kind: 'chatters', sweepId: `${session}.${t}`, at, complete: true, ids: order(ids) });
  const chat = (talker: typeof TALKERS[number]): Observation => ({ kind: 'chat', messageId: `${session}.${talker.id}.${t}`, at, author: talker });
  const everyone = [...TALKERS.map(talker => talker.id), ...LURKERS];

  switch (name) {
    case 'evening': {
      if (onMinute) {
        observations.push(live());
        // Connected people drift: one quiet person leaves after two minutes, another arrives at three.
        const present = everyone.filter(id => !(minute >= 2 && id === LURKERS[3]) && !(minute < 3 && id === LURKERS[5]));
        observations.push(sweep(present));
      }
      TALKERS.forEach((talker, index) => {
        // Staggered first words, then each talker speaks again inside the presence lease.
        const first = 2 + index * 3;
        if (t >= first && (t - first) % (55 + index * 4) === 0) observations.push(chat(talker));
      });
      // The reducer holds this talker's window dark for the protective hold, even though they keep talking.
      if (t === 150) observations.push({ kind: 'user_clear', eventId: `${session}.clear.${t}`, at, userId: TALKERS[4].id });
      return { observations };
    }
    case 'quiet':
      if (onMinute) observations.push(live(), sweep(LURKERS));
      return { observations };
    case 'offline':
      if (t === 0) observations.push(live(), sweep(everyone), ...TALKERS.map(chat));
      // Offline is evidence too; it is re-observed each minute so it never ages into "unknown".
      if (t >= 3 && (t - 3) % 60 === 0) observations.push({ kind: 'stream', at, live: false });
      return { observations };
    case 'stale':
      // The last stream observation is already near the end of its lease; nothing renews it.
      if (t === 0) observations.push({ ...live(), at: at - STREAM_LEASE_MS + 8_000 }, sweep(everyone), ...TALKERS.map(chat));
      return { observations };
    case 'unavailable':
      if (t === 0) observations.push(live(), sweep(everyone), ...TALKERS.map(chat));
      if (t === 4) return { observations, available: false };
      return { observations };
  }
}

export interface ReplayHandle {
  stop(): void;
}

/**
 * Plays a scenario in real time against a source: one step per second, inputs submitted in order.
 * The source is made available at the start; an `unavailable` step takes it down for good.
 */
export function playScenario(source: PresenceSource, name: ScenarioName, options: ScenarioOptions & { readonly now?: () => number } = {}): ReplayHandle {
  const now = options.now ?? Date.now;
  const startAt = Math.floor(now() / 1_000) * 1_000;
  let t = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  source.setAvailable(true);

  const run = () => {
    if (stopped) return;
    const step = scenarioStep(name, t, startAt, options);
    for (const observation of step.observations) {
      const input = toPresenceInput(observation, source.kingdomId, 'simulated');
      if (input) void source.submit(input);
    }
    if (step.available === false) source.setAvailable(false, 'simulated_outage');
    t++;
    timer = setTimeout(run, Math.max(0, startAt + t * 1_000 - now()));
  };
  run();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
