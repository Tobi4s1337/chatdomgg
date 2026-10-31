import type { MomentBodyOf } from './contracts';
import type { AudioCueFrame, CaptionFrame } from './controller';
import { DRAGON_FALL_IMPACT_MS } from './sound';
import { DRAGON_BEAT, TRAIN_BEAT, WYRM_BELL, type BattleStatus, type DragonForm, type DragonFrame, type DragonPhase, type TrainFrame } from './spectacle';

/**
 * The Hype Train and the earned dragon on the kingdom clock. Train state comes only from validated `hype` facts and
 * battle state only from the authority's `battle` facts: nothing here decides a level, a strike, a victory or a form.
 * Times are kingdom milliseconds; every frame is a pure function of the stored anchors and `atMs`.
 */
export interface TrainState {
  readonly trainKey: string;
  /** Kingdom time the train appeared. A restored train has been running a while already: it never arrives on screen. */
  readonly appearedAt: number;
  readonly arrives: boolean;
  readonly phase: MomentBodyOf<'hype'>['phase'];
  readonly level: number;
  readonly progress: number;
  readonly goal: number;
  readonly endsAt: number;
  readonly names: readonly string[];
  readonly hiddenNames: boolean;
  readonly otherContributors: number | null;
  readonly golden: boolean;
  readonly treasure: boolean;
  readonly record: boolean;
  readonly shared: boolean;
  /** Kingdom time the newest carriage coupled on, live only. */
  readonly coupledAt: number | null;
  /** Kingdom time the end arrived, live only; restored ends have already happened. */
  readonly endedAt: number | null;
  /** Kingdom time the train first reached level 3 live, for its one caption. */
  readonly earnedAt: number | null;
}

export interface BattleState {
  readonly battleKey: string;
  readonly source: 'hype' | 'wyrm-bell';
  readonly phase: Exclude<DragonPhase, 'stir'>;
  readonly form: DragonForm;
  /** Kingdom time this phase was first seen; -Infinity for a restored state whose phase began before this session. */
  readonly phaseAt: number;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly health: number;
  readonly fighters: number;
  readonly strikes: number;
  readonly flinchAt: number | null;
  readonly sharedSessionKey: string | null;
}

/** An authoritative battle stays on screen at most this long past its stated end if the authority falls silent. */
const BATTLE_GRACE_MS = 30_000;
/** A running train past its expiry with no end fact steams quietly on for this long, then is no longer claimed. */
const TRAIN_GRACE_MS = 60_000;
/** The dragon in the hills stirs a moment after a below-level-3 train closes. */
const STIR_DELAY_MS = 2600;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function nextTrain(previous: TrainState | undefined, body: MomentBodyOf<'hype'>, now: number, live: boolean): TrainState {
  const same = previous?.trainKey === body.trainKey ? previous : undefined;
  const names = body.contributors.flatMap(c => (c ? [c.displayName] : []));
  const levelled = live && same !== undefined && body.level > same.level;
  // A train first seen at its end, or restored, has been running a while: it is on its track already.
  const arriving = live && body.phase !== 'end';
  return {
    trainKey: body.trainKey,
    appearedAt: same?.appearedAt ?? (arriving ? now : now - TRAIN_BEAT.arrive - 1),
    arrives: same?.arrives ?? arriving,
    phase: body.phase, level: body.level, progress: body.progress, goal: body.goal, endsAt: body.endsAt,
    names, hiddenNames: body.contributors.some(c => c === null), otherContributors: body.otherContributors,
    golden: body.golden, treasure: body.treasure, record: body.record, shared: body.sharedSessionKey !== null,
    coupledAt: levelled ? now : same?.coupledAt ?? null,
    endedAt: body.phase === 'end' ? (same?.endedAt ?? (live ? now : -Infinity)) : null,
    earnedAt: same?.earnedAt ?? (live && body.level >= 3 && (same?.level ?? 0) < 3 ? now : null),
  };
}

export function trainFrame(train: TrainState, atMs: number): TrainFrame | null {
  if (atMs < train.appearedAt) return null;
  const t = atMs - train.appearedAt, c = TRAIN_BEAT.closing;
  const closingT = train.endedAt === null ? null : atMs - train.endedAt;
  if (closingT !== null && closingT > c.end) return null;
  if (closingT === null && atMs > train.endsAt + TRAIN_GRACE_MS) return null;
  const rise = train.arrives ? smooth(TRAIN_BEAT.bunting[0], TRAIN_BEAT.bunting[1], t) : 1;
  const bunting = rise * (closingT === null ? 1 : 1 - smooth(c.bunting[0], c.bunting[1], closingT));
  const coupling = train.coupledAt !== null && atMs >= train.coupledAt && atMs - train.coupledAt < TRAIN_BEAT.couple ? atMs - train.coupledAt : null;
  const names = train.names.slice(0, TRAIN_BEAT.names);
  return {
    key: train.trainKey, t, state: closingT !== null ? 'closing' : train.arrives && t < TRAIN_BEAT.arrive ? 'arriving' : 'running', closingT,
    level: train.level, progress: clamp01(train.progress / train.goal), carriages: Math.min(TRAIN_BEAT.carriages, Math.max(1, train.level)), coupling,
    golden: train.golden, treasure: train.treasure, treasureOpen: train.treasure && train.level >= 2, names,
    others: train.otherContributors, bunting, closingFireworks: closingT !== null && train.level < 3, endsAt: train.endsAt,
  };
}

/** True while names exist beyond those riding: "and others", never an invented count. */
export const omittedNames = (train: TrainState) => train.hiddenNames || train.names.length > TRAIN_BEAT.names;

export function trainCues(train: TrainState): AudioCueFrame[] {
  const id = `train.${train.trainKey}`, out: AudioCueFrame[] = [];
  if (train.arrives) {
    out.push({ id: `${id}:steam`, cue: 'train-steam', atMs: train.appearedAt, gain: 0.8 }, { id: `${id}:whistle`, cue: 'train-whistle', atMs: train.appearedAt + 300, gain: 1 },
      { id: `${id}:drum`, cue: 'festival-drum', atMs: train.appearedAt + 1500, gain: 0.8 });
  }
  if (train.coupledAt !== null) {
    out.push({ id: `${id}:couple:${train.level}`, cue: 'carriage-couple', atMs: train.coupledAt + TRAIN_BEAT.couple * 0.5, gain: 0.9 },
      { id: `${id}:drum:${train.level}`, cue: 'festival-drum', atMs: train.coupledAt + 200, gain: 0.6 });
  }
  if (train.endedAt !== null && Number.isFinite(train.endedAt)) {
    const c = TRAIN_BEAT.closing;
    out.push({ id: `${id}:farewell`, cue: 'train-whistle', atMs: train.endedAt + c.away[0], gain: 0.8 }, { id: `${id}:away`, cue: 'train-steam', atMs: train.endedAt + c.away[0] + 200, gain: 0.6 });
  }
  return out;
}

export function trainCaption(train: TrainState, atMs: number, battle: BattleStatus): CaptionFrame | null {
  // Spoken at the train's arrival, at each new level and once at its end; otherwise its carriages carry the names.
  const anchors: { at: number; line: string }[] = [];
  const level = `Level ${train.level}`;
  if (train.arrives) anchors.push({ at: train.appearedAt + 1800, line: train.golden ? 'A golden train sets out' : 'The festival train sets out' });
  if (train.coupledAt !== null) anchors.push({ at: train.coupledAt + 600, line: train.earnedAt !== null && train.coupledAt === train.earnedAt
    ? battle === 'unavailable' ? 'The dragon stirs, but no battle can be fought here' : 'The dragon wakes in the hills'
    : train.record && train.level >= 3 ? 'A train the kingdom has never seen' : `${level}: another carriage joins` });
  if (train.endedAt !== null && Number.isFinite(train.endedAt)) anchors.push({ at: train.endedAt + 500, line: train.level < 3 ? 'The festival closes with fireworks' : 'The festival train comes home' });
  const latest = anchors.filter(a => atMs >= a.at - 200).at(-1);
  if (!latest) return null;
  const t = atMs - latest.at, opacity = smooth(-200, 500, t) * (1 - smooth(4600, 5600, t));
  if (opacity <= 0.01) return null;
  const names = train.names.slice(0, 3);
  const detail = names.length ? `${names.join(', ')}${omittedNames(train) || train.names.length > 3 ? ' and others' : ''}` : null;
  return { id: `train.${train.trainKey}:${latest.at}`, at: { kind: 'place', place: 'train' }, title: train.golden ? 'The golden train' : 'The Hype Train', line: latest.line,
    detail: train.level >= 3 && battle === 'unavailable' ? `${level} · battle unavailable` : detail, opacity };
}

// ---------------------------------------------------------------- the dragon

export function nextBattle(previous: BattleState | undefined, body: MomentBodyOf<'battle'>, now: number, live: boolean): BattleState {
  const same = previous?.battleKey === body.battleKey ? previous : undefined;
  const moved = !same || same.phase !== body.phase;
  return {
    battleKey: body.battleKey, source: body.source, phase: body.phase, form: body.form,
    phaseAt: moved ? (live ? now : -Infinity) : same.phaseAt,
    startsAt: body.startsAt, endsAt: body.endsAt, health: body.healthPermille / 1000, fighters: body.fighters, strikes: body.acceptedStrikes,
    // Only an authoritative rise in accepted strikes makes the dragon flinch.
    flinchAt: live && same && body.acceptedStrikes > same.strikes ? now : same?.flinchAt ?? null, sharedSessionKey: body.sharedSessionKey,
  };
}

const PHASE_END: Readonly<Record<'victory' | 'retreat', number>> = { victory: DRAGON_BEAT.victory.end, retreat: DRAGON_BEAT.retreat.end };
/** The Wyrm Bell rings first; the free dragon then wakes on the same summoning clock. */
const bellLead = (battle: BattleState) => (battle.source === 'wyrm-bell' ? WYRM_BELL.end : 0);

export function dragonFrame(battle: BattleState, atMs: number): DragonFrame | null {
  const t = atMs - battle.phaseAt;
  if (battle.phase === 'victory' || battle.phase === 'retreat') { if (!(t >= 0 && t <= PHASE_END[battle.phase])) return null; }
  else if (atMs > battle.endsAt + BATTLE_GRACE_MS) return null;
  const elapsed = Math.max(0, atMs - battle.startsAt);
  const a = DRAGON_BEAT.active;
  let telegraph: DragonFrame['telegraph'] = null;
  if (battle.phase === 'active') {
    const c = elapsed % a.cycle;
    for (const kind of ['swoop', 'breath'] as const) {
      const at = a[kind].at - a[kind].windup;
      if (c >= at && c < a[kind].at + a[kind].strike) telegraph = { kind, t: c - at };
    }
  }
  const flinch = battle.flinchAt !== null && atMs >= battle.flinchAt && atMs - battle.flinchAt < a.flinch * 2 ? atMs - battle.flinchAt : null;
  // A restored summoning or active battle is simply in the sky already; it never replays its waking.
  const poseT = battle.phase === 'summoning' ? (Number.isFinite(t) ? Math.max(0, t - bellLead(battle)) : DRAGON_BEAT.summoning.end) : Number.isFinite(t) ? t : 1e9;
  return { key: battle.battleKey, source: battle.source, phase: battle.phase, form: battle.form, t: poseT, elapsed, health: battle.health,
    fighters: battle.fighters, strikes: battle.strikes, flinch, telegraph, endsAt: battle.endsAt };
}

/** Below level 3, the dragon in the hills lifts its head and sleeps again. Presentation only: no battle exists. */
/** When a short train's sleeping dragon stirs, as [start, end] kingdom ms; null while the train runs or once it earned a battle. */
export function stirWindow(train: TrainState): readonly [number, number] | null {
  if (train.endedAt === null || !Number.isFinite(train.endedAt) || train.level >= 3) return null;
  const from = train.endedAt + STIR_DELAY_MS;
  return [from, from + DRAGON_BEAT.stir.end];
}

export function stirFrame(train: TrainState, atMs: number): DragonFrame | null {
  if (train.endedAt === null || !Number.isFinite(train.endedAt) || train.level >= 3) return null;
  const t = atMs - train.endedAt - STIR_DELAY_MS;
  if (t < 0 || t > DRAGON_BEAT.stir.end) return null;
  return { key: `stir.${train.trainKey}`, source: 'hype', phase: 'stir', form: 'young', t, elapsed: 0, health: 1, fighters: 0, strikes: 0, flinch: null, telegraph: null,
    endsAt: train.endedAt + STIR_DELAY_MS + DRAGON_BEAT.stir.end };
}

export function stirCues(train: TrainState): AudioCueFrame[] {
  if (train.endedAt === null || !Number.isFinite(train.endedAt) || train.level >= 3) return [];
  const at = train.endedAt + STIR_DELAY_MS;
  return [{ id: `stir.${train.trainKey}:snore`, cue: 'dragon-snore', atMs: at + DRAGON_BEAT.stir.lift[0], gain: 0.8 },
    { id: `stir.${train.trainKey}:smoke`, cue: 'dragon-breath', atMs: at + DRAGON_BEAT.stir.breath, gain: 0.25 }];
}

/**
 * The dragon's cues. Waking and its ending are finite lists; the fight's wingbeats and telegraphs repeat, so only the
 * ones near `atMs` are listed, each with a stable ID so it plays exactly once whatever the frame interval.
 */
export function dragonCues(battle: BattleState, atMs: number): AudioCueFrame[] {
  const id = `battle.${battle.battleKey}`, out: AudioCueFrame[] = [];
  if (!Number.isFinite(battle.phaseAt)) return out;
  const p = battle.phaseAt, lead = bellLead(battle);
  const near = (at: number) => at >= atMs - 600 && at <= atMs + 1600;
  switch (battle.phase) {
    case 'summoning': {
      const s = DRAGON_BEAT.summoning;
      if (battle.source === 'wyrm-bell') WYRM_BELL.strokes.forEach((at, i) => out.push({ id: `${id}:bell${i}`, cue: 'wyrm-bell', atMs: p + at, gain: i === 0 ? 1 : 0.8 }));
      out.push({ id: `${id}:roar`, cue: 'dragon-roar', atMs: p + lead + s.roar, gain: 1 });
      for (let k = 0; k < 5; k++) out.push({ id: `${id}:lift${k}`, cue: 'dragon-wings', atMs: p + lead + s.takeoff + k * 950, gain: k === 0 ? 1 : 0.75 });
      break;
    }
    case 'active': {
      const a = DRAGON_BEAT.active, from = Math.max(battle.startsAt, p);
      const cycle = Math.floor((atMs - battle.startsAt) / a.cycle);
      for (const n of [cycle - 1, cycle, cycle + 1]) {
        if (n < 0) continue;
        const base = battle.startsAt + n * a.cycle;
        const series: [string, AudioCueFrame['cue'], number, number][] = [
          ['swoop', 'dragon-roar', base + a.swoop.at - a.swoop.windup, 0.55], ['dive', 'dragon-wings', base + a.swoop.at, 1],
          ['breath', 'dragon-breath', base + a.breath.at, 0.9], ['beat', 'dragon-wings', base + 4600, 0.55], ['beat2', 'dragon-wings', base + 9600, 0.55],
        ];
        for (const [name, cue, at, gain] of series) if (at >= from && near(at)) out.push({ id: `${id}:${n}:${name}`, cue, atMs: at, gain });
      }
      if (battle.flinchAt !== null && near(battle.flinchAt)) out.push({ id: `${id}:hit:${battle.strikes}`, cue: 'dragon-hit', atMs: battle.flinchAt, gain: 0.8 });
      break;
    }
    case 'victory': {
      const v = DRAGON_BEAT.victory;
      out.push({ id: `${id}:reel`, cue: 'dragon-roar', atMs: p + 100, gain: 0.7 }, { id: `${id}:fall`, cue: 'dragon-fall', atMs: p + v.land - DRAGON_FALL_IMPACT_MS, gain: 1 },
        { id: `${id}:fanfare`, cue: 'victory-fanfare', atMs: p + v.land + 700, gain: 0.9 });
      break;
    }
    case 'retreat': {
      const r = DRAGON_BEAT.retreat;
      out.push({ id: `${id}:roar`, cue: 'dragon-roar', atMs: p + r.roar, gain: 0.8 });
      for (let k = 0; k < 4; k++) out.push({ id: `${id}:away${k}`, cue: 'dragon-wings', atMs: p + r.away[0] + k * 1100, gain: 0.8 - k * 0.15 });
      break;
    }
  }
  return out;
}

const FORM_TITLE: Readonly<Record<DragonForm, string>> = {
  young: 'The dragon wakes', elder: 'The elder dragon wakes', 10: 'The dragon of ten wakes', 25: 'The dragon of twenty-five wakes',
  50: 'The dragon of fifty wakes', 100: 'The dragon of a hundred wakes', record: 'The greatest dragon the kingdom has seen', golden: 'A golden dragon wakes',
};

/** Fighters are the crowd that struck, never who paid. Counts appear only as the authority reports them. */
export function dragonCaption(battle: BattleState, atMs: number): CaptionFrame | null {
  if (!Number.isFinite(battle.phaseAt)) return null;
  const t = atMs - battle.phaseAt, id = `battle.${battle.battleKey}:${battle.phase}`;
  const fade = (a: number, b: number) => smooth(a, a + 600, t) * (1 - smooth(b, b + 900, t));
  const fought = battle.fighters === 1 ? '1 fighter' : `${battle.fighters} fighters`;
  switch (battle.phase) {
    case 'summoning': {
      const lead = bellLead(battle);
      return { id, at: { kind: 'place', place: 'dragon' }, title: FORM_TITLE[battle.form], line: battle.source === 'wyrm-bell' ? 'The Wyrm Bell rang: the realm fights for free' : 'The Hype Train woke it: !strike to fight',
        detail: battle.sharedSessionKey ? 'One dragon over the bridge, for every kingdom in the shared chat' : null, opacity: fade(lead + DRAGON_BEAT.summoning.roar - 400, lead + DRAGON_BEAT.summoning.end) };
    }
    case 'active':
      return { id, at: { kind: 'place', place: 'dragon' }, title: 'Strike the dragon', line: '!strike in chat, or fight on the walls', detail: battle.fighters ? fought : null, opacity: fade(200, 7000) };
    case 'victory':
      return { id, at: { kind: 'place', place: 'dragon' }, title: 'The dragon falls', line: 'The realm stands. Every fighter is remembered', detail: fought,
        opacity: fade(DRAGON_BEAT.victory.land - 200, DRAGON_BEAT.victory.end - 1400) };
    case 'retreat':
      return { id, at: { kind: 'place', place: 'dragon' }, title: 'The dragon flies home', line: 'It will wake again. Nothing is lost', detail: null, opacity: fade(DRAGON_BEAT.retreat.turn[1], DRAGON_BEAT.retreat.end - 1600) };
  }
}

/** How long the director stays with a dragon phase before handing the camera back; the fight itself goes on. */
export function dragonFocusWindow(battle: BattleState): [number, number] | null {
  if (!Number.isFinite(battle.phaseAt)) return null;
  const p = battle.phaseAt;
  switch (battle.phase) {
    case 'summoning': return [p, p + bellLead(battle) + DRAGON_BEAT.summoning.end];
    case 'active': return [p, p + 9000];
    case 'victory': return [p, p + DRAGON_BEAT.victory.end - 1200];
    case 'retreat': return [p, p + DRAGON_BEAT.retreat.end - 800];
  }
}
