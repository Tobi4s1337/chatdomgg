import type { GrowthHomeStage, GrowthSceneFrame, HomeTier } from '@chatdom/shared';
import type { GrowthCeremony } from './ledger';

/**
 * The director's score: one continuous dusk sequence, composed from ceremonies the ledger has accepted. Every act is
 * a fixed-length piece of time; sampling the score at any second is pure, so a capture can seek to any frame.
 */
export type Shot =
  | { readonly kind: 'lot'; readonly side: -1 | 1; readonly stage: GrowthHomeStage; readonly drift: number }
  | { readonly kind: 'wide'; readonly drift: number }
  | { readonly kind: 'quarter'; readonly drift: number };

export interface Caption { readonly kicker: string; readonly line: string; readonly note: string | null }
interface ActBase { readonly start: number; readonly end: number; readonly caption: Caption; readonly shot: Shot }
export type Act =
  | ActBase & { readonly kind: 'open'; readonly stage: GrowthHomeStage }
  | ActBase & { readonly kind: 'grow'; readonly from: GrowthHomeStage; readonly to: HomeTier; readonly key: string }
  | ActBase & { readonly kind: 'rise' }
  | ActBase & { readonly kind: 'quarter' }
  | ActBase & { readonly kind: 'close' };

/** A neighbour's growth, shown as a quick settle while the camera rises over the street. */
export interface NeighbourGrowth { readonly plotId: string; readonly from: GrowthHomeStage; readonly to: HomeTier; readonly start: number; readonly end: number }

export interface GrowthScore {
  readonly acts: readonly Act[];
  readonly neighbours: readonly NeighbourGrowth[];
  readonly duration: number;
  readonly heroPlotId: string;
  readonly quarter: { readonly start: number; readonly end: number } | null;
}

export interface ScoreInput {
  readonly heroPlotId: string;
  readonly street: string;
  readonly bootstrap: GrowthSceneFrame;
  readonly ceremonies: readonly GrowthCeremony[];
  /** The next quarter opens when the kingdom's year turns past the town's plan; null keeps the town as it is. */
  readonly quarter: { readonly name: string; readonly year: number; readonly openedAt: number } | null;
}

/** Phase windows of a growth act, in seconds from its start. Longer for the bigger homes. */
export function growPhases(to: HomeTier) {
  const build = ({ hut: 3.4, cottage: 3.6, house: 4, manor: 4.4, hall: 4.8 } as const)[to];
  const scaffold = [1.1, 2.7] as const, fence = [1.9, 3.4] as const;
  const buildAt = [2.7, 2.7 + build] as const;
  const settle = [buildAt[1], buildAt[1] + .75] as const;
  const strike = [settle[1] + .1, settle[1] + 1.2] as const;
  const hearth = [settle[1] + .4, settle[1] + 2.2] as const;
  const cheer = [hearth[0] + 1, hearth[0] + 3.4] as const;
  return { scaffold, fence, build: buildAt, settle, strike, hearth, cheer, length: cheer[1] + 1.6 };
}

export const QUARTER_PHASES = { streets: [.8, 7.5], green: [2.5, 5.5], homes: [3.6, 12.5], rise: 2.4, lights: 1.1, length: 21 } as const;
const OPEN = 6.5, RISE = 8.5, CLOSE = 8, BLEND = 2.4;

const ORDINAL = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** Numbers as a chronicler says them: “a hundred and eighty”, “thirty-one”. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) return String(n);
  const hundreds = Math.floor(n / 100), rest = n % 100;
  const small = rest < 20 ? ORDINAL[rest]! : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ORDINAL[rest % 10]}` : ''}`;
  if (!hundreds) return small;
  const head = hundreds === 1 ? 'a hundred' : `${ORDINAL[hundreds]} hundred`;
  return rest ? `${head} and ${small}` : head;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthOf = (at: number) => { const d = new Date(at); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const BECOMES: Record<HomeTier, string> = {
  hut: 'The first walls go up on the plot.', cottage: 'The hut becomes a cottage.', house: 'The cottage becomes a house.',
  manor: 'The house becomes a manor.', hall: 'The manor becomes a hall.',
};

export function composeScore(input: ScoreInput): GrowthScore {
  const acts: Act[] = [];
  let t = OPEN, side: -1 | 1 = 1;
  const heroBoot = input.bootstrap.homes.find(home => home.plotId === input.heroPlotId);
  let heroStage: GrowthHomeStage = heroBoot?.stage ?? 'tent';
  acts.push({ kind: 'open', start: 0, end: OPEN, stage: heroStage, shot: { kind: 'lot', side, stage: heroStage, drift: 0 },
    caption: { kicker: monthOf(input.bootstrap.asOf), line: heroStage === 'tent'
      ? `A plot on ${input.street} is kept for a new citizen.` : `A home on ${input.street}.`, note: null } });
  const neighbourFrom = new Map<string, GrowthHomeStage>(), neighbourTo = new Map<string, HomeTier>();
  for (const home of input.bootstrap.homes) if (home.plotId !== input.heroPlotId) neighbourFrom.set(home.plotId, home.stage);
  for (const { beat, frame, key } of input.ceremonies) {
    if (beat.kind !== 'home-grown') continue;
    if (beat.plotId !== input.heroPlotId) {
      neighbourTo.set(beat.plotId, beat.to);
      if (!neighbourFrom.has(beat.plotId)) neighbourFrom.set(beat.plotId, beat.from);
      continue;
    }
    const phases = growPhases(beat.to);
    side = side === 1 ? -1 : 1;
    const view = frame.homes.find(home => home.plotId === beat.plotId);
    const streak = view && view.bestStreak >= 5 ? `Longest run so far: ${numberWords(view.bestStreak)} nights in a row` : null;
    acts.push({ kind: 'grow', key, from: heroStage, to: beat.to, start: t, end: t + phases.length,
      shot: { kind: 'lot', side, stage: beat.to, drift: 1 },
      caption: { kicker: monthOf(beat.at), line: `${capital(numberWords(beat.qualifiedDays))} nights in the kingdom. ${BECOMES[beat.to]}`, note: streak } });
    heroStage = beat.to; t += phases.length;
  }
  const neighbours: NeighbourGrowth[] = [];
  const hasRise = neighbourTo.size > 0 || input.quarter !== null;
  if (hasRise) {
    acts.push({ kind: 'rise', start: t, end: t + RISE, shot: { kind: 'wide', drift: 0 },
      caption: { kicker: 'All the while', line: 'Around it, the street kept growing too.', note: null } });
    let i = 0;
    for (const [plotId, to] of neighbourTo) {
      const start = t + 2.6 + i++ * 1.1;
      neighbours.push({ plotId, from: neighbourFrom.get(plotId) ?? 'tent', to, start, end: start + 2.4 });
    }
    t += RISE;
  }
  let quarter: GrowthScore['quarter'] = null;
  if (input.quarter) {
    acts.push({ kind: 'quarter', start: t, end: t + QUARTER_PHASES.length, shot: { kind: 'quarter', drift: 1 },
      caption: { kicker: monthOf(input.quarter.openedAt), line: `A new year, and ${input.quarter.name} opens at the edge of town.`, note: 'New streets, a green, and homes for the people still arriving' } });
    quarter = { start: t, end: t + QUARTER_PHASES.length };
    t += QUARTER_PHASES.length;
  }
  acts.push({ kind: 'close', start: t, end: t + CLOSE, shot: { kind: 'wide', drift: 1 },
    caption: { kicker: 'Chatdom', line: 'It grows because people keep showing up.', note: null } });
  t += CLOSE;
  return { acts, neighbours, duration: t, heroPlotId: input.heroPlotId, quarter };
}

export const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
export const span = (t: number, [a, b]: readonly [number, number]) => clamp01((t - a) / (b - a));
export const smooth = (v: number) => { const u = clamp01(v); return u * u * u * (u * (u * 6 - 15) + 10); };

/** What the stage shows for the growing home at one instant. */
export interface HomeMoment {
  readonly shown: GrowthHomeStage;
  /** Present while a stage change is under way. */
  readonly growth: null | {
    readonly from: GrowthHomeStage; readonly to: HomeTier;
    readonly scaffold: number; readonly fence: number; readonly build: number; readonly settle: number;
    readonly strike: number; readonly hearth: number; readonly cheer: number;
  };
  /** The garland of the most recent housewarming: strung, then lit, then gently fading over the next act. */
  readonly garland: number;
  readonly garlandLit: number;
}

export interface ScoreSample {
  readonly t: number;
  readonly act: Act;
  readonly actIndex: number;
  readonly local: number;
  readonly hero: HomeMoment;
  readonly neighbours: readonly { readonly plotId: string; readonly from: GrowthHomeStage; readonly to: HomeTier; readonly build: number }[];
  /** 0 before the quarter act; then each part of the opening, all reaching 1 by its end. */
  readonly quarter: { readonly streets: number; readonly green: number; readonly local: number; readonly open: boolean };
  readonly camera: { readonly from: Shot; readonly to: Shot; readonly blend: number; readonly local: number; readonly fromLocal: number };
  readonly caption: Caption;
  /** 0..1 caption opacity: in after the cut settles, out before the next act. */
  readonly captionAlpha: number;
}

export function sampleScore(score: GrowthScore, input: number): ScoreSample {
  const t = Math.max(0, Math.min(score.duration, input));
  let actIndex = score.acts.findIndex(act => t < act.end);
  if (actIndex < 0) actIndex = score.acts.length - 1;
  const act = score.acts[actIndex]!, local = t - act.start;
  const previous = score.acts[actIndex - 1];
  let shown: GrowthHomeStage = score.acts[0]!.kind === 'open' ? (score.acts[0] as Extract<Act, { kind: 'open' }>).stage : 'tent';
  let growth: HomeMoment['growth'] = null, garland = 0, garlandLit = 0;
  for (const item of score.acts) {
    if (item.kind !== 'grow') continue;
    if (t >= item.end) {
      shown = item.to;
      garland = 1; garlandLit = 1;
      continue;
    }
    if (t < item.start) break;
    const p = growPhases(item.to), at = t - item.start;
    growth = { from: item.from, to: item.to, scaffold: span(at, p.scaffold), fence: span(at, p.fence), build: span(at, p.build),
      settle: span(at, p.settle), strike: span(at, p.strike), hearth: span(at, p.hearth), cheer: span(at, p.cheer) };
    // The previous garland comes down as the scaffold goes up; the new one is strung during the cheer.
    garland = growth.cheer > 0 ? smooth(growth.cheer * 2.2) : Math.max(0, garland * (1 - smooth(growth.scaffold * 1.4)));
    garlandLit = growth.cheer > 0 ? smooth((growth.cheer - .35) * 2.4) : garland;
    shown = growth.build >= 1 ? item.to : item.from;
    break;
  }
  const neighbours = score.neighbours.filter(n => t >= n.start).map(n => ({ plotId: n.plotId, from: n.from, to: n.to, build: span(t, [n.start, n.end]) }));
  const q = score.quarter, ql = q ? t - q.start : -1;
  const quarter = { streets: q && ql > 0 ? smooth(span(ql, QUARTER_PHASES.streets)) : 0, green: q && ql > 0 ? smooth(span(ql, QUARTER_PHASES.green)) : 0,
    local: Math.max(0, ql), open: !!q && ql >= 0 };
  const from = previous?.shot ?? act.shot;
  const blend = previous ? smooth(local / BLEND) : 1;
  const fadeIn = clamp01((local - (previous ? 1.2 : .4)) / .8), fadeOut = clamp01((act.end - t - .2) / .7);
  const last = actIndex === score.acts.length - 1;
  return { t, act, actIndex, local, hero: { shown, growth, garland, garlandLit }, neighbours, quarter,
    camera: { from, to: act.shot, blend, local, fromLocal: previous ? previous.end - previous.start + local : local }, caption: act.caption, captionAlpha: Math.min(fadeIn, last ? 1 : fadeOut) };
}
