import { CitizenChatCueSchema, KingdomIdSchema, type CitizenChatCue, type KingdomPresenceFrame } from '@chatdom/shared';
import type { CitizenMotionSample } from '../citizens/types';
import { generateSettlementPlan } from '../settlement/generator';
import { BEHAVIOUR_TUNING } from './tuning';
import type { SettlementPlan } from '../settlement/types';

/**
 * The SIMULATED nine-neighbour street shared by the scenario test and the bench. It is a
 * labelled input fixture, not a producer: no Twitch data, attendance or history is implied.
 * Nine neighbours on one street of a real generated hamlet arrive over 43 s, the way a
 * public presence projection would admit them; three have public names, six stay anonymous.
 */
export const NEIGHBOUR_FIXTURE = {
  seed: 'hearthwick',
  kingdomId: KingdomIdSchema.parse('1'),
  epoch: 'simulated:citizen-behaviour',
  origin: 'simulated' as const,
  startMs: 1_900_000_000_000,
  arrivals: [
    { slot: 2, atMs: 0, publicName: 'SIMULATED Juniper' },
    { slot: 1, atMs: 4_000, publicName: null },
    { slot: 0, atMs: 9_000, publicName: null },
    { slot: 3, atMs: 15_000, publicName: 'SIMULATED Moss' },
    { slot: 5, atMs: 21_000, publicName: null },
    { slot: 7, atMs: 26_000, publicName: null },
    { slot: 6, atMs: 32_000, publicName: 'SIMULATED Rue' },
    { slot: 4, atMs: 37_000, publicName: null },
    { slot: 8, atMs: 43_000, publicName: null },
  ],
} as const;

export interface NeighbourStreet {
  readonly plan: SettlementPlan;
  readonly slots: readonly number[];
  /**
   * The cumulative public frame at a kingdom time, with optional departures (slot → kingdom ms).
   * Its sequence counts the arrivals and departures already observed, so replaying earlier
   * times reproduces exactly the frames a live caller would have applied.
   */
  frameAt(atMs: number, departures?: ReadonlyMap<number, number>): KingdomPresenceFrame | null;
}

/**
 * The SIMULATED 240-slot town for the street composition: a real five-quarter generated town whose
 * every home is occupied, arriving over two minutes. It sits inside main's existing representation
 * budget for this town (one body per home); it makes no claim about rendering a larger audience.
 */
export const TOWN_FIXTURE = {
  seed: 'hearthwick',
  kingdomId: KingdomIdSchema.parse('1'),
  epoch: 'simulated:citizen-behaviour:town',
  origin: 'simulated' as const,
  startMs: 1_900_000_000_000,
  arrivalSpanMs: 120_000,
} as const;

export function createTownStreets(): NeighbourStreet {
  const fixture = TOWN_FIXTURE;
  const plan = generateSettlementPlan({ seed: fixture.seed, tier: 'town', firstYear: 2022, year: 2026 });
  const slots = plan.homes.map(home => home.slot).sort((a, b) => a - b);
  const names = ['Juniper', 'Moss', 'Rue', 'Sable', 'Rowan', 'Wren', 'Hazel', 'Bramble', 'Pip', 'Clover', 'Fern', 'Robin'];
  // A stable, interleaved arrival order: the town fills from everywhere at once, not quarter by quarter.
  const arrivals = slots.map((slot, index) => ({ slot, atMs: Math.round((((index * 97) % slots.length) / slots.length) * fixture.arrivalSpanMs),
    publicName: index % 20 === 0 ? `SIMULATED ${names[(index / 20) % names.length]}` : null })).sort((a, b) => a.atMs - b.atMs || a.slot - b.slot);
  return { plan, slots, frameAt: framesFor({ ...fixture, arrivals }) };
}

/** Cumulative frames for a fixture; an unchanged frame is the same object, so callers can skip re-applying it. */
function framesFor(fixture: { readonly kingdomId: KingdomPresenceFrame['kingdomId']; readonly epoch: string; readonly origin: 'simulated'; readonly startMs: number;
  readonly arrivals: readonly { readonly slot: number; readonly atMs: number; readonly publicName: string | null }[] }): NeighbourStreet['frameAt'] {
  let cached: { key: string; frame: KingdomPresenceFrame } | null = null;
  return (atMs, departures = new Map()) => {
    const arrived = fixture.arrivals.filter(arrival => fixture.startMs + arrival.atMs <= atMs);
    if (!arrived.length) return null;
    let sequence = 0, asOf: number = fixture.startMs;
    const left = new Set<number>();
    for (const arrival of arrived) {
      const since = fixture.startMs + arrival.atMs, leftAt = departures.get(arrival.slot);
      sequence++; asOf = Math.max(asOf, since);
      if (leftAt !== undefined && leftAt <= atMs && leftAt >= since) { sequence++; asOf = Math.max(asOf, leftAt); left.add(arrival.slot); }
    }
    const key = `${sequence}:${asOf}:${[...left].join(',')}`;
    if (cached?.key === key) return cached.frame;
    const windows = arrived.map(arrival => left.has(arrival.slot)
      ? { slot: arrival.slot, present: false, publicName: null, since: fixture.startMs + arrival.atMs }
      : { slot: arrival.slot, present: true, publicName: arrival.publicName, since: fixture.startMs + arrival.atMs });
    const frame: KingdomPresenceFrame = { version: 1, kingdomId: fixture.kingdomId, epoch: fixture.epoch, sequence, asOf, origin: fixture.origin,
      streamLive: true, connection: 'fresh', windows };
    cached = { key, frame }; return frame;
  };
}

export function createNeighbourStreet(): NeighbourStreet {
  const fixture = NEIGHBOUR_FIXTURE;
  const plan = generateSettlementPlan({ seed: fixture.seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const slots = fixture.arrivals.map(arrival => arrival.slot);
  for (const slot of slots) if (!plan.homes.some(home => home.slot === slot)) throw new Error(`Fixture slot ${slot} has no home`);
  return { plan, slots, frameAt: framesFor(fixture) };
}

/** The SIMULATED lines of the chat script. Only main's bubble shows words; the policy never receives them as anything it reads. */
export const SIMULATED_LINES = [
  'Evening, all.', 'The lanterns are lovely tonight.', 'Who left bread on the sill?', 'Long day. Good to be home.',
  'Look at that sky.', 'Anyone at the market?', 'Hello, street!', 'Ha, same.', 'Mine too.', 'Quiet tonight.',
] as const;

export type SimulatedChatMoment = 'line' | 'burst' | 'walker' | 'reconnect' | 'departure';
export interface SimulatedChat {
  /**
   * The cues main's chat adapter holds at a policy step: every issued, unexpired cue, supplied again on
   * every step exactly like main's `speech` map. Call once per fixed step, in order; moments are chosen
   * from the actual motion samples, so the same story always produces the same lines.
   */
  cuesAt(stepMs: number, samples: readonly CitizenMotionSample[]): readonly CitizenChatCue[];
  /** Cues whose bubble main would show at a render time: said, unexpired, speaker present. */
  heldAt(atMs: number, samples: readonly CitizenMotionSample[]): readonly CitizenChatCue[];
  /** Slots under SIMULATED walker control at a step. */
  controlledAt(stepMs: number): ReadonlySet<number>;
  /** True on the step at which the caller resets its policy, as main's consumer does when its source reconnects. */
  resetsAt(stepMs: number): boolean;
  /** SIMULATED departures chosen by the script (slot → kingdom ms), for the street's frames. */
  readonly departures: ReadonlyMap<number, number>;
  /** Where each moment landed: the step it began and the people it chose (speakers first). */
  readonly moments: ReadonlyMap<SimulatedChatMoment, { readonly atMs: number; readonly slots: readonly number[] }>;
}

/**
 * A SIMULATED chat script for the nine-neighbour street: an ordinary line at a doorstep, a burst of
 * lines with a repeat, an expired, a foreign and an absent cue, a line from someone who then comes under
 * walker control, a line cut by a reconnect, and a line whose speaker then leaves. Cues are built through
 * the actual `CitizenChatCueSchema`. No Twitch data, attendance or history is implied.
 */
export function createSimulatedChat(street: NeighbourStreet, fixture: { readonly kingdomId: string; readonly epoch: string; readonly origin: 'simulated'; readonly startMs: number } = NEIGHBOUR_FIXTURE,
  options: { readonly firstAtMs?: number; readonly gapMs?: number; readonly only?: readonly SimulatedChatMoment[] } = {}): SimulatedChat {
  const first = options.firstAtMs ?? 70_000, gap = options.gapMs ?? 25_000;
  const order: SimulatedChatMoment[] = (['line', 'burst', 'walker', 'reconnect', 'departure'] as const).filter(kind => !options.only || options.only.includes(kind));
  const issued: CitizenChatCue[] = [], moments = new Map<SimulatedChatMoment, { atMs: number; slots: number[] }>(), departures = new Map<number, number>();
  let control: { slot: number; fromMs: number; untilMs: number } | null = null, resetMs: number | null = null, next = 0, line = 0, dueMs = fixture.startMs + first;
  const say = (slot: number, asOf: number, id: string, kingdomId = fixture.kingdomId, epoch = fixture.epoch): void => {
    issued.push(CitizenChatCueSchema.parse({ version: 1, id, kingdomId, epoch, origin: fixture.origin, slot, asOf, expiresAt: asOf + 7_000,
      parts: [{ kind: 'text', text: SIMULATED_LINES[line++ % SIMULATED_LINES.length]! }] }));
  };
  const standing = (sample: CitizenMotionSample): boolean => sample.goalReached && sample.speed === 0 && sample.opacity === 1 && (sample.state === 'home' || sample.state === 'idle');
  /** A neighbour within earshot who could turn their head toward `speaker` (the policy still decides). */
  const canHear = (other: CitizenMotionSample, speaker: CitizenMotionSample): boolean => {
    const dx = speaker.position[0] - other.position[0], dz = speaker.position[2] - other.position[2], turn = Math.atan2(dx, dz) - other.heading;
    const neck = other.speed > .05 ? BEHAVIOUR_TUNING.look.walkingLimit : BEHAVIOUR_TUNING.look.standingLimit;
    return other !== speaker && other.state !== 'leaving' && other.opacity === 1 && Math.hypot(dx, dz) <= BEHAVIOUR_TUNING.chat.listenMetres - .4
      && Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= neck + BEHAVIOUR_TUNING.chat.beyondNeck - .1;
  };
  /** A person settled at their door with at least `count` neighbours within earshot. */
  const speakerWith = (samples: readonly CitizenMotionSample[], count: number): CitizenMotionSample | undefined =>
    samples.find(sample => sample.state === 'home' && standing(sample) && samples.filter(other => canHear(other, sample)).length >= count);
  return {
    cuesAt(stepMs, samples) {
      const kind = order[next];
      if (kind && stepMs >= dueMs) {
        const tag = `simulated-${kind}`;
        if (kind === 'burst') {
          // Six neighbours speak inside a second, the first of them three times; with three cues that must be discarded.
          const speakers = samples.filter(sample => sample.state !== 'leaving' && sample.opacity === 1).slice(0, 6);
          speakers.forEach((sample, i) => say(sample.slot, stepMs + i * 160, `${tag}-${i}`));
          if (speakers[0]) { say(speakers[0].slot, stepMs + 320, `${tag}-again-1`); say(speakers[0].slot, stepMs + 640, `${tag}-again-2`); }
          say(speakers[1]?.slot ?? 0, stepMs - 9_000, `${tag}-expired`);
          say(speakers[2]?.slot ?? 0, stepMs, `${tag}-foreign`, fixture.kingdomId, `${fixture.epoch}:elsewhere`);
          say(60_000, stepMs, `${tag}-absent`);
          moments.set(kind, { atMs: stepMs, slots: speakers.map(sample => sample.slot) });
        } else {
          const speaker = speakerWith(samples, kind === 'line' || kind === 'reconnect' ? 2 : 1);
          if (speaker) {
            say(speaker.slot, stepMs, tag);
            if (kind === 'walker') control = { slot: speaker.slot, fromMs: stepMs + 700, untilMs: stepMs + 6_700 };
            if (kind === 'reconnect') resetMs = stepMs + 1_200;
            if (kind === 'departure') departures.set(speaker.slot, stepMs + 1_500);
            moments.set(kind, { atMs: stepMs, slots: [speaker.slot] });
          }
        }
        if (moments.has(kind)) { next++; dueMs = stepMs + gap; }
      }
      return issued.filter(cue => cue.asOf <= stepMs + 1_000 && cue.expiresAt > stepMs - 10_000);
    },
    heldAt: (atMs, samples) => issued.filter(cue => cue.asOf <= atMs && cue.expiresAt > atMs && cue.epoch === fixture.epoch
      && samples.some(sample => sample.slot === cue.slot && sample.state !== 'leaving')),
    controlledAt: stepMs => control && stepMs >= control.fromMs && stepMs < control.untilMs ? new Set([control.slot]) : new Set(),
    resetsAt: stepMs => resetMs !== null && stepMs === Math.ceil(resetMs / BEHAVIOUR_TUNING.stepMs) * BEHAVIOUR_TUNING.stepMs,
    departures, moments,
  };
}
