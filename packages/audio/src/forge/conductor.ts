import type { ForgePhase, ForgeRitualFrame } from '../../../shared/src/forge';

/**
 * What the Forge's sound should be doing for one observed frame. Pure and clock-agnostic: the graph passes its own
 * audio time, so a frozen, repeated or jumping observation is judged on the same facts as the picture.
 */

/** The authored local schedule (spec 17, R2). Only used to estimate how late a crossed attack is. */
export const FORGE_SPANS: Readonly<Record<ForgePhase, readonly [number, number]>> = {
  words: [0, 3], blueprint: [3, 5], pour: [5, 11], seal: [11, 12.2],
  strike: [12.2, 12.7], cool: [12.7, 15.5], flight: [15.5, 19], landed: [19, 21],
};
export const FORGE_PHASES = Object.keys(FORGE_SPANS) as ForgePhase[];

/** The moments the presentation adapter shows, so ears and eyes agree (apps/web/src/forge/presentation/stage.ts). */
export const STRIKE_IMPACT = .34;
export const FLIGHT_CONTACT = .9;

export type ForgeCue =
  | 'glint' | 'gather' | 'lock' | 'clank' | 'bubble' | 'drip' | 'stamp' | 'ribbon' | 'lift'
  | 'swing' | 'strike' | 'quench' | 'tick' | 'launch' | 'land' | 'creak';

/** Higher survives: the strike and the arrival are never lost to a tick or a bubble. */
export const CUE_PRIORITY: Readonly<Record<ForgeCue | 'refusal' | 'bed', number>> = {
  strike: 10, land: 10, stamp: 8, refusal: 8, lock: 7, gather: 6, quench: 6, swing: 6, launch: 5,
  clank: 4, ribbon: 4, lift: 4, creak: 4, bed: 4, drip: 3, glint: 3, tick: 2, bubble: 1,
};

export interface ForgeAttack {
  /** Stable within a ritual: one attack is heard at most once. */
  id: string;
  cue: ForgeCue;
  phase: ForgePhase;
  at: number; // phaseProgress at which it sounds
  variation: number; // deterministic per attack, for take and pan
  /** The most it may start after its moment and still read as the same event (seconds). */
  tolerance: number;
}

const hash = (i: number, salt: number) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };

function attacks(): ForgeAttack[] {
  const list: ForgeAttack[] = [];
  const add = (phase: ForgePhase, cue: ForgeCue, at: number, variation: number, tolerance = .18, id = `${phase}:${cue}`) =>
    list.push({ id, cue, phase, at, variation, tolerance });
  // Runes surface one by one (the picture staggers them over the first third), then gather onto the drawing.
  [.07, .16, .25, .33].forEach((at, i) => add('words', 'glint', at, i, .14, `words:glint:${i}`));
  add('words', 'gather', .74, 0, .25);
  add('blueprint', 'lock', .84, 0, .16);
  // The crucible arrives, tips and pours; molten bubbles break as the layers rise.
  add('pour', 'clank', .05, 0, .2);
  for (let i = 0; i < 14; i++) add('pour', 'bubble', .17 + i * .052 + (hash(i, 4) - .5) * .03, i, .08, `pour:bubble:${i}`);
  add('pour', 'clank', .95, 1, .2, 'pour:clank:set');
  // Wax bead, the press (its contact as the emboss appears), the ribbon, and the hammer rising into its wind-up.
  add('seal', 'drip', .1, 0, .15);
  add('seal', 'stamp', .35, 0, .12);
  add('seal', 'ribbon', .44, 0, .2);
  add('seal', 'lift', .58, 0, .2);
  add('strike', 'swing', .04, 0, .06);
  add('strike', 'strike', STRIKE_IMPACT, 0, .12);
  add('cool', 'quench', .01, 0, .15);
  // The same ten contraction points the picture glints at.
  for (let i = 0; i < 10; i++) add('cool', 'tick', .12 + .7 * hash(i, 21), i, .08, `cool:tick:${i}`);
  add('flight', 'launch', .05, 0, .15);
  add('flight', 'land', FLIGHT_CONTACT, 0, .12);
  add('landed', 'creak', .2, 0, .2);
  return list.sort((a, b) => position(a.phase, a.at) - position(b.phase, b.at));
}

/** A point on the authored schedule, in nominal seconds. Orders phases and measures lateness. */
export function position(phase: ForgePhase, progress: number): number {
  const [from, to] = FORGE_SPANS[phase];
  return from + (to - from) * progress;
}

export const FORGE_ATTACKS: readonly ForgeAttack[] = attacks();

/** Continuous layers: a low band-passed body and a high texture, both from the same noise. Levels are linear gains. */
export interface BedTarget {
  low: { frequency: number; q: number; level: number };
  high: { frequency: number; q: number; level: number };
}

export interface ConductorStep {
  /** Attacks that should sound now, with how late they already are (seconds, ≥ 0). */
  play: { attack: ForgeAttack; late: number }[];
  /** Attacks consumed silently: expired, crossed by a seek, or crossed while the graph could not sound. */
  skipped: { attack: ForgeAttack; reason: 'expired' | 'seek' }[];
  bed: BedTarget | null;
  held: boolean;
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const SILENT_BED: BedTarget = { low: { frequency: 300, q: .7, level: 0 }, high: { frequency: 3000, q: 1, level: 0 } };

/**
 * The beds for one observed moment. `breath` is a slow, bounded motion the graph passes in (from elapsed time) so a
 * held phase can breathe without escalating; `held` softens every layer to a quiet texture.
 */
export function bedFor(phase: ForgePhase, p: number, elapsed: number, held: boolean): BedTarget {
  const breath = .5 + .5 * Math.sin(elapsed * Math.PI * 2 / 6.5);
  const wobble = .5 + .3 * Math.sin(elapsed * 7.3) + .2 * Math.sin(elapsed * 12.9 + 1.7);
  const hold = (level: number, factor: number) => held ? level * factor : level;
  switch (phase) {
    case 'words': {
      // A slow breath of the bellows; a little air rises with the runes and swells as they gather.
      const level = .035 * smooth(0, .35, p) + .03 * smooth(.66, .95, p) * (1 - smooth(.97, 1, p) * .4);
      return { low: { frequency: 560 + 260 * smooth(.6, 1, p), q: .8, level: hold(level, .45) },
        high: { frequency: 3400 + 1400 * smooth(.6, 1, p), q: 1.6, level: hold(.006 + .008 * smooth(.66, .95, p), .4) } };
    }
    case 'blueprint': {
      const drawing = smooth(0, .12, p) * (1 - smooth(.6, .82, p));
      const rest = .012 + .006 * breath;
      return { low: { frequency: 420, q: .7, level: held ? rest : .018 * (1 - smooth(.85, 1, p)) + rest * smooth(.85, 1, p) },
        high: { frequency: 6400, q: 2.2, level: held ? .002 + .002 * breath : .009 * drawing + .002 * smooth(.85, 1, p) } };
    }
    case 'pour': {
      // Molten rumble and fine sizzle while the stream runs; a low fire before and after.
      const stream = smooth(.1, .16, p) * (1 - smooth(.88, .94, p));
      const fire = .014 + .006 * breath;
      const low = fire + .085 * stream * (.75 + .25 * wobble);
      const high = .004 + .022 * stream * (.6 + .4 * wobble);
      return { low: { frequency: 170 + 130 * stream, q: 1.1, level: hold(low, .4) },
        high: { frequency: 4600, q: .9, level: hold(high, .3) } };
    }
    case 'seal': {
      // Embers tick over; before the strike the room holds its breath.
      const still = 1 - .75 * smooth(.78, .96, p);
      return { low: { frequency: 260, q: .9, level: hold((.016 + .004 * breath) * still, .8) },
        high: { frequency: 2200, q: 1.2, level: hold(.003 * still, .6) } };
    }
    case 'strike':
      return { low: { frequency: 240, q: .8, level: .004 }, high: { frequency: 2400, q: 1, level: 0 } };
    case 'cool': {
      // The quench hiss falls away as the skin darkens; a heat rumble underneath goes with it.
      const steam = .03 * Math.exp(-p * 2.6) + .004;
      return { low: { frequency: 380, q: .8, level: hold(.018 * (1 - p) + .004, .5) },
        high: { frequency: 6800 - 2200 * p, q: .8, level: hold(steam, .35) } };
    }
    case 'flight': {
      // Air past the part follows its speed along the arc, and stops dead on contact.
      const u = Math.min(1, Math.max(0, (p - .06) / (FLIGHT_CONTACT - .06)));
      const speed = p >= FLIGHT_CONTACT ? 0 : smooth(.03, .12, p) * (.15 + .85 * (6 * u - 3 * u * u) / 3);
      return { low: { frequency: 260 + 700 * speed, q: 1.3, level: hold(.05 * speed, .3) },
        high: { frequency: 2200 + 2600 * speed, q: 1.8, level: hold(.012 * speed, .3) } };
    }
    case 'landed':
      return SILENT_BED;
  }
}

/**
 * Tracks one ritual's observation over audio time. Every attack is crossed once; an attack crossed late, by a seek
 * or while the graph is silent is consumed without sound, so no backlog ever plays.
 */
export class ForgeConductor {
  private ritual: string | null = null;
  private last: { at: number; elapsed: number; progress: number; phase: ForgePhase; clock: number } | null = null;
  private fired = new Set<string>();
  private stillSince = 0;

  /** `clock` is the audio context's time in seconds. Returns null for frames that cannot be observed. */
  step(frame: ForgeRitualFrame | null, clock: number): ConductorStep | null {
    if (frame === null) { this.reset(); return { play: [], skipped: [], bed: null, held: false }; }
    if (!valid(frame) || !Number.isFinite(clock)) return null;
    if (frame.ritualId !== this.ritual) { this.reset(); this.ritual = frame.ritualId; }
    const at = position(frame.phase, frame.phaseProgress);
    const last = this.last;
    let seek = false;
    if (last) {
      const observed = frame.elapsed - last.elapsed, real = clock - last.clock;
      // The picture jumped (scrub, replay, a stalled tab coming back) rather than moving on with the clock.
      seek = Math.abs(observed - real) > .3 && Math.abs(at - last.at) > .3;
      if (at < last.at - .25) for (const id of [...this.fired]) {
        const attack = FORGE_ATTACKS.find(a => a.id === id);
        if (attack && position(attack.phase, attack.at) > at) this.fired.delete(id);
      }
    }
    const from = last ? last.at : -Infinity;
    const play: ConductorStep['play'] = [], skipped: ConductorStep['skipped'] = [];
    if (!last || at > last.at) {
      for (const attack of FORGE_ATTACKS) {
        const p = position(attack.phase, attack.at);
        if (p <= from || p > at || this.fired.has(attack.id)) continue;
        this.fired.add(attack.id);
        const late = at - p;
        if (seek && late > .05) skipped.push({ attack, reason: 'seek' });
        else if (late > attack.tolerance) skipped.push({ attack, reason: 'expired' });
        else play.push({ attack, late });
      }
    }
    // Held: the reported progress stays put while the observation's own clock moves on (a pending gate).
    const moved = !last || at !== last.at || frame.phase !== last.phase;
    if (moved) this.stillSince = clock;
    const still = clock - this.stillSince;
    const advancing = !last || frame.elapsed > last.elapsed + 1e-6 || moved;
    const held = !moved && still > .35 && advancing;
    const paused = !moved && still > .35 && !advancing;
    const ended = frame.phase === 'landed' && frame.phaseProgress >= 1;
    this.last = { at, elapsed: frame.elapsed, progress: frame.phaseProgress, phase: frame.phase, clock };
    const bed = paused || ended ? null : bedFor(frame.phase, frame.phaseProgress, frame.elapsed, held);
    return { play, skipped, bed, held };
  }

  reset() { this.ritual = null; this.last = null; this.fired.clear(); this.stillSince = 0; }
}

function valid(frame: ForgeRitualFrame): boolean {
  return typeof frame === 'object' && typeof frame.ritualId === 'string' && frame.phase in FORGE_SPANS
    && Number.isFinite(frame.phaseProgress) && frame.phaseProgress >= 0 && frame.phaseProgress <= 1 && Number.isFinite(frame.elapsed);
}
