import { AVATAR_PALETTE } from '@chatdom/content/materials';
import { decodeCampfirePublicView, type CampfireCue, type CampfireIntentEnvelope, type CampfirePublicSeat, type CampfirePublicView, type CampfireReceipt, type CampfireSeatLook, type CampfireSessionPort } from './ports';

/*
 * A deterministic SIMULATED campfire for presentation work. It proves the place and its states, not
 * authenticated play: nobody here is a real person, it holds no private state, and every intent is
 * refused as unavailable. Each emitted view goes through the same strict decoder as a live one.
 */

export const SIMULATED_SCENARIOS = ['waiting', 'playing', 'text-only', 'closed'] as const;
export type SimulatedScenario = (typeof SIMULATED_SCENARIOS)[number];

export interface SimulatedCampfireOptions {
  readonly scenario: SimulatedScenario;
  /** Seats around the fire including the Magistrate: 6–12. */
  readonly seats: number;
  readonly seed: string;
  /** Server time of the first view, epoch milliseconds. */
  readonly startMs: number;
}

/** Plainly invented handles for the development cast. */
const CAST = ['Mossbell', 'quill_and_ember', 'Tamsin_Reed', 'Brannoc', 'fernhollow', 'Ottilie', 'pipwick', 'Juniper_Vale', 'RowanAshby', 'larkspur88', 'HeddaWick'] as const;
const MAGISTRATE = 'Magistrate Hollis';
const KINGDOM = { id: '900000000017', name: 'Hearthmoor' } as const;
const HOST_EPOCH = 'sim-epoch-1';
const RULES = 'dusk-court.1';

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Small, well-mixed PRNG (mulberry32) for authored fixture variety only. */
export function fixtureRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

function castLook(random: () => number, index: number): CampfireSeatLook {
  // Walk the skin ramp so the circle never repeats a neighbour's tone; fey swatches appear rarely.
  const skins = AVATAR_PALETTE.skin;
  const skin = skins[(index * 3 + Math.floor(random() * 2)) % 8]!;
  const hair = random() < .1 ? null : { form: 'sidePart' as const, swatch: pick(random, AVATAR_PALETTE.hair) };
  const wear = random() < .62 ? [{ id: 'shortCloak' as const, style: random() < .55 ? 'hearth' as const : 'tide' as const }] : [];
  return { body: 'balanced', skin: index === 7 ? skins[8]! : skin, hair, wear };
}

const PHASE_SECONDS = { discussion: 90, night: 35 } as const;

export function simulatedPublicView(options: SimulatedCampfireOptions, nowMs: number): CampfirePublicView {
  const { scenario, startMs } = options;
  if (!Number.isSafeInteger(options.seats) || options.seats < 6 || options.seats > 12) throw new Error('A simulated fire seats 6–12 people.');
  const random = fixtureRandom(`${options.seed}:${options.seats}`);
  const players = options.seats - 1;
  const order: string[] = [...CAST];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  order.length = players;
  const elapsed = Math.max(0, nowMs - startMs);
  const textOnly = scenario === 'text-only';
  const seats: CampfirePublicSeat[] = scenario === 'closed' ? [] : [
    { seat: 0, kind: 'magistrate', label: MAGISTRATE, look: { body: 'balanced', skin: AVATAR_PALETTE.skin[4], hair: { form: 'sidePart', swatch: AVATAR_PALETTE.hair[5] }, wear: [{ id: 'shortCloak', style: 'hearth' }] }, presence: 'seated', medium: textOnly ? 'text' : 'voice', lantern: 'none', revealed: null },
    ...order.map((label, i): CampfirePublicSeat => ({
      seat: i + 1, kind: 'player', label, look: castLook(random, i), presence: 'seated',
      medium: textOnly || i % 4 === 2 ? 'text' : 'voice', lantern: scenario === 'waiting' ? 'none' : 'lit', revealed: null,
    })),
  ];
  // While seats are offered, the fire holds whoever has accepted so far: no empty-chair spectacle.
  const waitingSeated = Math.max(3, players - 2);
  const visible = scenario === 'waiting' ? seats.slice(0, waitingSeated + 1) : seats;
  const playing = scenario === 'playing' || scenario === 'text-only';
  const cues: CampfireCue[] = [];
  let phase: CampfirePublicView['phase'] = null;
  let gallery: CampfirePublicView['gallery'] = null;
  if (scenario === 'playing') {
    // Day two's discussion: one lantern went out at dawn and its role was read aloud then.
    const out = visible[3]!;
    visible[3] = { ...out, lantern: 'out', revealed: 'townsfolk' };
    const started = startMs - 24_000;
    phase = { id: 'discussion', day: 2, startedAtMs: started, deadlineMs: started + PHASE_SECONDS.discussion * 1000, pausedRemainingMs: null };
    gallery = { open: true, deadlineMs: started + PHASE_SECONDS.discussion * 1000 + 8_000, delay: { ms: 8_000, estimated: true }, embers: [{ seat: 2, glow: 3 }, { seat: 5, glow: 1 }] };
    cues.push({ id: 'sim-cue-dawn-2', fact: 'sim-fact-dawn-2', atMs: started - 6_000, text: `Dawn. One lantern did not survive the night. ${out.label} was townsfolk.` });
  } else if (scenario === 'text-only') {
    const started = startMs - 9_000;
    phase = { id: 'night', day: 1, startedAtMs: started, deadlineMs: started + PHASE_SECONDS.night * 1000, pausedRemainingMs: null };
    cues.push({ id: 'sim-cue-night-1', fact: 'sim-fact-night-1', atMs: started, text: 'Night falls on the first day. Every card is sealed until dawn.' });
  }
  const view: CampfirePublicView = {
    version: 1, kingdom: KINGDOM, matchId: playing ? 'sim-match-1' : null, hostEpoch: HOST_EPOCH,
    revision: 1 + Math.floor(elapsed / 1000), serverTimeMs: nowMs, origin: 'SIMULATED',
    lifecycle: scenario === 'closed' ? 'closed' : scenario === 'waiting' ? 'seating' : 'playing',
    phase,
    settings: playing ? { family: 'dusk-court', rulesVersion: RULES, timing: 'hearth', players } : null,
    seating: scenario === 'waiting' ? { open: true, seats: players, accepted: waitingSeated, deadlineMs: startMs + 41_000 } : null,
    seats: visible, gallery,
    voice: { mode: textOnly ? 'text' : 'push-to-talk', quiet: false },
    cues, result: null,
  };
  // Round-trip through the wire decoder so the fixture can never carry what a live view could not.
  return decodeCampfirePublicView(JSON.parse(JSON.stringify(view)));
}

/**
 * A session port over the fixture. Time comes from the caller's clock so captures can hold an
 * exact instant; the view ticks once a second like a host would.
 */
export function createSimulatedCampfireSession(options: SimulatedCampfireOptions, clock: { now(): number; every(ms: number, tick: () => void): () => void }): CampfireSessionPort {
  const listeners = new Set<(view: CampfirePublicView) => void>();
  let stop: (() => void) | undefined;
  let disposed = false;
  const emit = (): void => { const view = simulatedPublicView(options, clock.now()); for (const l of listeners) l(view); };
  return {
    origin: 'SIMULATED',
    subscribePublic(listener) {
      if (disposed) throw new Error('This simulated campfire has been disposed.');
      listeners.add(listener);
      listener(simulatedPublicView(options, clock.now()));
      stop ??= clock.every(1000, emit);
      return () => { listeners.delete(listener); if (!listeners.size) { stop?.(); stop = undefined; } };
    },
    subscribeSelf(_listener, unavailable) {
      // A simulated cast has no owner: private hands need the real host and a signed-in person.
      unavailable('not-bound');
      return () => {};
    },
    send(envelope: CampfireIntentEnvelope): Promise<CampfireReceipt> {
      return Promise.resolve({ id: envelope.id, status: 'rejected', reason: 'unavailable' });
    },
    dispose() { disposed = true; listeners.clear(); stop?.(); stop = undefined; },
  };
}
