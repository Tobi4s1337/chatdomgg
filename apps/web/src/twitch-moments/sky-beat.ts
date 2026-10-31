import type { AudioCueFrame, CaptionFrame, MomentCue, MomentSubject } from './controller';
import {
  POWER_UP_BEAT, RUNG_RANK, SKY_BEAT, SKY_LIMITS, type ApprovedEffect, type SkyBeatFrame, type SkyOrigin, type SkyRung,
} from './spectacle';

/**
 * One sky beat: a cheer (possibly a merged volley of several), or a Power-up. The whole town is its subject. A
 * merged beat keeps every contributing fact key, so a replayed or reordered key can never play twice.
 */
export interface SkyBeat {
  readonly kind: 'sky';
  readonly id: string;
  readonly sky: SkyBeatFrame['kind'];
  readonly rung: SkyRung | null;
  readonly origin: SkyOrigin;
  readonly seed: number;
  readonly name: string;
  readonly ribbon: readonly string[];
  readonly others: number;
  readonly effect: ApprovedEffect | null;
  readonly bubbleSlot: number | null;
  readonly keys: readonly string[];
  readonly startAt: number;
  readonly endAt: number;
}

export function skyLength(sky: SkyBeatFrame['kind'], rung: SkyRung | null): number {
  if (sky === 'cheer' || sky === 'festival') return SKY_BEAT[rung ?? 'spark'].end;
  return POWER_UP_BEAT[sky].end;
}

/** How long a beat holds the stage before the next subject may begin: the climax and a breath, not its quiet tail. */
export function skyHold(sky: SkyBeatFrame['kind'], rung: SkyRung | null): number {
  if (sky === 'bubble') return 0;
  if (sky === 'balloon') return 6000;
  if (sky === 'confetti') return 4200;
  return { spark: 3200, 'street-fireworks': 5200, 'castle-volley': 7400, hearthbeast: 9200, skyfire: 15_500, kites: 13_000 }[rung ?? 'spark'];
}

/** A merged volley plays its highest contributing rung; names join a bounded ribbon, the rest are counted. */
export function mergeSky(beat: SkyBeat, rung: SkyRung, name: string, key: string): SkyBeat {
  const top = RUNG_RANK[rung] > RUNG_RANK[beat.rung ?? 'spark'] ? rung : beat.rung ?? rung;
  const known = beat.name === name || beat.ribbon.includes(name);
  const room = !known && beat.ribbon.length < SKY_LIMITS.ribbonNames;
  return { ...beat, rung: top, ribbon: room ? [...beat.ribbon, name] : beat.ribbon, others: beat.others + (known || room ? 0 : 1), keys: [...beat.keys, key],
    endAt: beat.startAt + skyLength('cheer', top) };
}

const LINES: Record<SkyRung, string> = {
  spark: 'sends a spark up from home', 'street-fireworks': 'lights up the street', 'castle-volley': 'fires a volley over the castle',
  hearthbeast: 'calls the Hearthbeast over the town', skyfire: 'sets the sky alight', kites: 'raises a sky of kites',
};

/** The beat's caption: the credited name, what the sky does, and for a volley the others who joined it. Never an amount. */
export function skyCaption(beat: SkyBeat, atMs: number): CaptionFrame | null {
  if (beat.sky === 'bubble' || beat.sky === 'festival') return null;
  const t = atMs - beat.startAt, length = beat.endAt - beat.startAt;
  const [inAt, outAt] = beat.sky === 'cheer' ? captionWindow(beat.rung!) : beat.sky === 'balloon' ? [900, 9000] : [600, 5600];
  const opacity = smoothIn(inAt, inAt + 700, t) * (1 - smoothIn(Math.min(outAt, length - 400), Math.min(outAt, length - 400) + 900, t));
  const line = beat.sky === 'cheer' ? LINES[beat.rung!] : beat.sky === 'balloon' ? 'floats a giant emote over the plaza' : 'throws a celebration over the castle';
  const joined = [...beat.ribbon];
  const detail = joined.length === 0 ? null
    : `with ${joined.length === 1 && beat.others === 0 ? joined[0] : `${joined.join(', ')}${beat.others ? ` and ${beat.others} ${beat.others === 1 ? 'other' : 'others'}` : ''}`}`;
  const at: MomentSubject = beat.sky === 'cheer' && (beat.rung === 'spark' || beat.rung === 'street-fireworks') && beat.origin.kind === 'home'
    ? { kind: 'home', slot: beat.origin.slot } : { kind: 'place', place: beat.sky === 'balloon' ? 'plaza' : 'sky' };
  return { id: beat.id, at, title: beat.name, line, detail, opacity };
}

function captionWindow(rung: SkyRung): [number, number] {
  switch (rung) {
    case 'spark': return [1500, 3900];
    case 'street-fireworks': return [1600, 6600];
    case 'castle-volley': return [1900, 9000];
    case 'hearthbeast': return [2600, 9400];
    // Skyfire writes the name in the sky itself; the caption reads it once the letters have formed.
    case 'skyfire': return [5000, 13_000];
    case 'kites': return [3000, 13_600];
  }
}

const cue = (beat: SkyBeat, name: string, kind: MomentCue, at: number, gain: number): AudioCueFrame => ({ id: `${beat.id}:${name}`, cue: kind, atMs: beat.startAt + at, gain });

/** Every cue on the beat's own clock: each shell is heard where it launches and where it blooms. */
export function skyCues(beat: SkyBeat): AudioCueFrame[] {
  const out: AudioCueFrame[] = [];
  if (beat.sky === 'balloon') return [cue(beat, 'rise', 'balloon-rise', 200, 0.8)];
  if (beat.sky === 'confetti') return POWER_UP_BEAT.confetti.burst.map((at, i) => cue(beat, `pop${i}`, 'confetti-pop', at, i === 0 ? 0.9 : 0.6));
  if (beat.sky === 'bubble') return [];
  const shells = (launches: readonly number[], fuse: number, heard: readonly number[], gain: number) => {
    launches.forEach((at, i) => {
      if (heard.includes(i)) out.push(cue(beat, `launch${i}`, 'firework-launch', at, gain * 0.7));
      out.push(cue(beat, `bloom${i}`, 'firework-bloom', at + fuse, gain * (i === launches.length - 1 ? 1 : 0.75)));
    });
    out.push(cue(beat, 'crackle', 'firework-crackle', launches.at(-1)! + fuse + 260, gain * 0.7));
  };
  switch (beat.rung ?? 'spark') {
    case 'spark': out.push(cue(beat, 'rise', 'spark-rise', SKY_BEAT.spark.launch, 0.7)); break;
    case 'street-fireworks': shells(SKY_BEAT['street-fireworks'].launches, SKY_BEAT['street-fireworks'].fuse, [0, 1, 2], 0.85); break;
    case 'castle-volley': shells(SKY_BEAT['castle-volley'].launches, SKY_BEAT['castle-volley'].fuse, [0, 3, 6], 1); break;
    case 'hearthbeast': {
      const b = SKY_BEAT.hearthbeast;
      out.push(cue(beat, 'call', 'beast-call', b.call, 1));
      b.wings.forEach((at, i) => out.push(cue(beat, `wing${i}`, 'beast-wings', at, i === 2 ? 1 : 0.7)));
      break;
    }
    case 'skyfire': {
      const b = SKY_BEAT.skyfire;
      out.push(cue(beat, 'aurora', 'aurora-swell', b.aurora[0], 0.9), cue(beat, 'name', 'spark-rise', b.name[0], 0.6));
      // The procession's shells, evenly along the wall walk; every other one is heard so it never becomes a drum roll.
      const launches = skyfireLaunches().filter((_, i) => i % 2 === 0);
      shells(launches, b.fuse, launches.map((_, i) => i).filter(i => i % 2 === 0), 0.8);
      break;
    }
    case 'kites': out.push(cue(beat, 'wind', 'kite-wind', SKY_BEAT.kites.rise[0], 0.8), cue(beat, 'away', 'kite-wind', SKY_BEAT.kites.drift[0], 0.6)); break;
  }
  return out;
}

/** Launch times of Skyfire's procession, evenly along its window (the light layer walks the same schedule). */
export function skyfireLaunches(): number[] {
  const { procession: [a, b], shells } = SKY_BEAT.skyfire;
  return Array.from({ length: shells }, (_, i) => Math.round(a + (b - a) * i / (shells - 1)));
}

export function skyFrame(beat: SkyBeat, atMs: number): SkyBeatFrame {
  return { id: beat.id, kind: beat.sky, rung: beat.rung, t: atMs - beat.startAt, origin: beat.origin, seed: beat.seed, name: beat.name,
    ribbon: beat.ribbon, others: beat.others, effect: beat.effect, bubbleSlot: beat.bubbleSlot };
}

function smoothIn(a: number, b: number, v: number): number { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }

/** A stable small integer from a key, for deterministic variation. */
export function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
