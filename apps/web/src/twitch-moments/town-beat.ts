import type { GroveEntry, TwitchMomentFact } from './contracts';
import type { AudioCueFrame, CaptionFrame, FocusFrame, MomentSubject } from './controller';
import type { StageCandidate, StageProfile } from './stage-beat';
import {
  DEFAULT_TOWN_COLOUR, EMPTY_TOWN, TOWN_BEAT, TOWN_COLOURS, TOWN_DYES, TOWN_LIMITS, colourOf, smoothstep, type BoardChoiceFrame, type BoardFrame,
  type GateFrame, type PlantingFrame, type RelightFrame, type TownColour, type TownFrame,
} from './town';

/**
 * How the town is shaped by its channel, as the stream view plays it: a follower's sapling by their new door, a citizen
 * coming home to the relight, the night opening at the gate, the kingdom rewards (the bell, a festival, a planted tree,
 * a home shown), the decree board where the town decides together, and the colours it decrees. Lasting state (the
 * night, the grove, the colours, a running poll, a festival) comes from current facts and simply stands after a
 * reload; only what happens live is a beat, and beats take their turn on the stage like every other moment.
 */

export type TownAct = 'sapling' | 'tree' | 'relight' | 'gate' | 'bell' | 'festival' | 'show-home' | 'board' | 'decide' | 'colours' | 'welcome';

export interface TownBeat {
  readonly kind: 'town';
  readonly act: TownAct;
  readonly id: string;
  readonly subject: MomentSubject;
  /** The home this beat is about, when it is about one. */
  readonly slot: number | null;
  readonly title: string;
  readonly line: string;
  readonly detail: string | null;
  readonly startAt: number;
  readonly endAt: number;
  /** For `board` and `decide`: the poll. For `colours`: the decree's from/to. */
  readonly pollKey: string | null;
  readonly from: TownColour | null;
  readonly to: TownColour | null;
}

/** How long each act holds the stage before the next subject may start (its own end may run on beneath). */
export function townHold(beat: TownBeat): number {
  switch (beat.act) {
    case 'gate': return 9000;
    case 'festival': return 6500;
    // A poll's opening keeps the board on the stage long enough to see the first votes move the pennants.
    case 'board': return 12_000;
    case 'decide': return 6500;
    default: return Math.min(beat.endAt - beat.startAt, 6500);
  }
}

const LENGTH: Readonly<Record<TownAct, number>> = {
  sapling: TOWN_BEAT.sapling.end, tree: TOWN_BEAT.tree.end, relight: TOWN_BEAT.relight.end, gate: TOWN_BEAT.gate.end, bell: TOWN_BEAT.bell.end,
  festival: TOWN_BEAT.festival.caption[1] + 600, 'show-home': TOWN_BEAT.relight.end + 1500, board: 14_000, decide: TOWN_BEAT.board.decide[1] + 5200,
  colours: TOWN_BEAT.colours.wave[1] + 2400, welcome: 6500,
};
/** When each act's caption is in, ms from its start. */
const CAPTION: Readonly<Record<TownAct, readonly [number, number]>> = {
  sapling: TOWN_BEAT.sapling.caption, tree: TOWN_BEAT.tree.caption, relight: TOWN_BEAT.relight.caption, gate: TOWN_BEAT.gate.caption,
  bell: TOWN_BEAT.bell.caption, festival: TOWN_BEAT.festival.caption, 'show-home': [600, LENGTH['show-home'] - 600],
  board: [900, 13_400], decide: [TOWN_BEAT.board.decide[1] - 1400, LENGTH.decide - 500], colours: [TOWN_BEAT.colours.wave[0], LENGTH.colours - 500],
  welcome: [500, 6000],
};

const FRIEND = 'A friend of the realm';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lasting public town state, from current facts. */
export interface TownState {
  night: { readonly number: number; readonly phase: 'open' | 'rest'; readonly openedAt: number } | null;
  readonly grove: Map<number, GroveEntry>;
  /** Names last seen on each home this session, for the tag on its planting. Never stored beyond the session. */
  readonly names: Map<number, string>;
  colour: TownColour;
  /** The poll the board shows: its latest public state, and how each choice's share is easing. */
  board: BoardState | null;
  festival: { readonly id: string; readonly at: number } | null;
}
interface BoardState {
  readonly key: string; readonly title: string; readonly roseAt: number; readonly endedAt: number | null; readonly phase: 'begin' | 'progress' | 'end';
  readonly winnerId: string | null; readonly cancelled: boolean; readonly decree: boolean;
  readonly choices: readonly { readonly id: string; readonly title: string; readonly votes: number; readonly colour: TownColour; readonly from: number; readonly to: number; readonly changedAt: number }[];
}

export function createTownState(): TownState {
  return { night: null, grove: new Map(), names: new Map(), colour: DEFAULT_TOWN_COLOUR, board: null, festival: null };
}

/** Any other poll's pennants: a fixed dye by position, never a colour the town has decided on. */
const POSITION_DYES: readonly TownColour[] = ['tide', 'ember', 'meadow', 'dusk', 'rose'];

function shareAt(choice: BoardState['choices'][number], atMs: number): number {
  return choice.from + (choice.to - choice.from) * smoothstep(0, TOWN_BEAT.board.climb, atMs - choice.changedAt);
}

/** Folds one current or live town fact into the lasting state. `animate`: a live change eases; a restored one just is. */
export function applyTownState(state: TownState, fact: TwitchMomentFact, now: number, animate: boolean): void {
  const body = fact.body;
  switch (body.kind) {
    case 'night':
      state.night = { number: body.number, phase: body.phase, openedAt: body.openedAt };
      return;
    case 'grove':
      state.grove.clear();
      for (const entry of body.plantings.slice(0, TOWN_LIMITS.plantings * 8)) state.grove.set(entry.slot, entry);
      return;
    case 'decree': state.colour = body.choice; return;
    case 'follow': case 'homecoming':
      if (body.credit?.slot != null) remember(state, body.credit.slot, body.credit.displayName);
      return;
    case 'redemption':
      if (body.credit?.slot != null) remember(state, body.credit.slot, body.credit.displayName);
      if (body.mappingKey === 'call-a-festival' && body.status === 'fulfilled') state.festival = { id: body.redemptionKey, at: fact.occurredAt };
      return;
    case 'poll': {
      const previous = state.board?.key === body.pollKey ? state.board : null;
      const total = body.choices.reduce((sum, c) => sum + c.votes, 0);
      const decree = body.choices.every(c => colourOf(c.title) !== null);
      const choices = body.choices.slice(0, TOWN_LIMITS.choices).map((c, i) => {
        const to = total > 0 ? c.votes / total : 0, before = previous?.choices.find(p => p.id === c.id);
        const from = before ? shareAt(before, now) : animate ? 0 : to;
        return { id: c.id, title: c.title, votes: c.votes, colour: colourOf(c.title) ?? POSITION_DYES[i % POSITION_DYES.length]!, from, to, changedAt: animate ? now : -Infinity };
      });
      state.board = { key: body.pollKey, title: body.title, roseAt: previous?.roseAt ?? (animate ? now : -Infinity),
        endedAt: body.phase === 'end' ? (previous?.endedAt ?? (animate ? now : -Infinity)) : null, phase: body.phase,
        winnerId: body.winnerId, cancelled: body.cancelled, decree, choices };
      return;
    }
    default: return;
  }
}

function remember(state: TownState, slot: number, name: string): void {
  state.names.delete(slot);
  state.names.set(slot, name);
  if (state.names.size > TOWN_LIMITS.plantings) state.names.delete(state.names.keys().next().value!);
}

/**
 * The beat a live town fact plays, or null when it is state only. `colourBefore` is the town's colour before this
 * fact was folded in (a decree's wave runs from it).
 */
export function planTownBeat(fact: TwitchMomentFact, startAt: number, colourBefore: TownColour, truncate: (name: string) => string): TownBeat | null {
  const body = fact.body, id = `${body.key}@${fact.seq}`;
  const beat = (act: TownAct, subject: MomentSubject, slot: number | null, title: string, line: string, detail: string | null = null,
    extra: Partial<Pick<TownBeat, 'pollKey' | 'from' | 'to'>> = {}): TownBeat =>
    ({ kind: 'town', act, id, subject, slot, title, line, detail, startAt, endAt: startAt + LENGTH[act], pollKey: null, from: null, to: null, ...extra });
  const home = (slot: number): MomentSubject => ({ kind: 'home', slot });
  switch (body.kind) {
    case 'follow': {
      // A quiet follower never reaches the stage; a named one is welcomed at their door, or at the gate without a home.
      if (!body.credit) return null;
      const name = truncate(body.credit.displayName), slot = body.homeSlot ?? body.credit.slot;
      if (slot === null) return beat('welcome', { kind: 'place', place: 'gate' }, null, name, 'follows the realm', 'welcome, traveller');
      return beat('sapling', home(slot), slot, name, body.returning ? 'follows · a sapling by the door' : 'follows · a new home on the edge of town',
        body.returning ? null : 'their sapling takes root');
    }
    case 'homecoming': {
      if (!body.credit || body.credit.slot === null) return null;
      return beat('relight', home(body.credit.slot), body.credit.slot, `Welcome back, ${truncate(body.credit.displayName)}`,
        body.awayDays !== null ? `home after ${plural(body.awayDays, 'day', 'days')} away` : 'the lights come on at home', null);
    }
    case 'night': {
      if (body.phase !== 'open') return null;
      return beat('gate', { kind: 'place', place: 'gate' }, null, 'The gate opens', `Night ${body.number} · welcome home, everyone`,
        body.number === 1 ? 'the first night of the realm' : null);
    }
    case 'redemption': {
      if (body.status !== 'fulfilled') return null;
      const name = body.credit ? truncate(body.credit.displayName) : FRIEND, slot = body.credit?.slot ?? null;
      switch (body.mappingKey) {
        case 'ring-the-bell': return beat('bell', { kind: 'place', place: 'castle' }, null, name, 'rings the castle bell', null);
        case 'call-a-festival': return beat('festival', { kind: 'place', place: 'plaza' }, null, name, 'calls a festival', 'the streets are dressed for ten minutes');
        case 'plant-a-tree': return slot === null ? null : beat('tree', home(slot), slot, name, 'plants a tree at home', null);
        case 'show-my-home': return slot === null ? null : beat('show-home', home(slot), slot, name, 'shows their home', null);
        default: return null;
      }
    }
    case 'poll': {
      const extra = { pollKey: body.pollKey };
      if (body.phase === 'begin') return beat('board', { kind: 'place', place: 'plaza' }, null, body.title, 'the town decides together', null, extra);
      if (body.phase !== 'end') return null;
      if (body.cancelled) return beat('decide', { kind: 'place', place: 'plaza' }, null, body.title, 'the decree is set aside', null, extra);
      const winner = body.choices.find(c => c.id === body.winnerId);
      const total = body.choices.reduce((sum, c) => sum + c.votes, 0);
      return winner
        ? beat('decide', { kind: 'place', place: 'plaza' }, null, body.title, `The town chose ${winner.title}`, plural(total, 'voice', 'voices'), extra)
        : beat('decide', { kind: 'place', place: 'plaza' }, null, body.title, total === 0 ? 'nobody spoke' : 'the town is divided', total === 0 ? null : 'nothing changes', extra);
    }
    case 'decree': {
      if (body.choice === colourBefore) return null;
      return beat('colours', { kind: 'place', place: 'plaza' }, null, `The town flies ${TOWN_DYES[body.choice].name}`, 'by decree of its people', null,
        { from: colourBefore, to: body.choice });
    }
    default: return null;
  }
}

/** The beat's caption, faded in and out over its window. */
export function townCaption(beat: TownBeat, atMs: number): CaptionFrame | null {
  const [from, to] = CAPTION[beat.act], t = atMs - beat.startAt;
  const opacity = smoothstep(from, from + 600, t) * (1 - smoothstep(to - 700, to, t));
  return opacity > 0.01 ? { id: beat.id, at: beat.subject, title: beat.title, line: beat.line, detail: beat.detail, opacity } : null;
}

/** The running board's own words while no beat speaks for it: the question, and how long is left. */
export function boardCaption(state: TownState, atMs: number, beats: readonly TownBeat[]): CaptionFrame | null {
  const board = state.board;
  if (!board || board.endedAt !== null || beats.some(b => b.pollKey === board.key && atMs < b.endAt)) return null;
  const leader = [...board.choices].sort((a, b) => b.votes - a.votes)[0];
  const total = board.choices.reduce((sum, c) => sum + c.votes, 0);
  return { id: `board.${board.key}`, at: { kind: 'place', place: 'plaza' }, title: board.title, line: 'the town decides together',
    detail: total === 0 || !leader ? 'vote in the poll' : `${plural(total, 'voice', 'voices')} · ${leader.title} leads`, opacity: 0.92 };
}

/** Ms of each act the camera holds; the town's quiet beats (a relight) take the close shot, the gate and the board the wide one. */
export function townFocus(beat: TownBeat, cut: boolean): FocusFrame | null {
  // A festival is the whole town dressed: the director's view over the streets is its shot, so it takes no camera.
  if (beat.act === 'festival') return null;
  const wide = beat.act === 'gate' || beat.act === 'board' || beat.act === 'decide' || beat.act === 'colours' || beat.act === 'bell' || beat.act === 'welcome';
  const hold = beat.act === 'gate' ? 11_000 : beat.endAt - beat.startAt;
  return { id: beat.id, subject: beat.subject, startAt: beat.startAt, endAt: beat.startAt + hold, cut, wide, follow: null, toward: [],
    ...(beat.subject.kind === 'home' ? { framing: 'garden' as const } : beat.act === 'board' || beat.act === 'decide' || beat.act === 'colours' ? { framing: 'board' as const } : {}) };
}

export function townProfile(beat: TownBeat): StageProfile {
  switch (beat.act) {
    case 'gate': return { rank: 4, climax: TOWN_BEAT.gate.beacon[1], payoff: TOWN_BEAT.gate.beacon[1] + 3200, end: 11_000, reach: 'town', hush: 0.12, cheer: true, voices: true };
    case 'festival': return { rank: 3, climax: TOWN_BEAT.festival.dress[1], payoff: TOWN_BEAT.festival.dress[1] + 2600, end: 7000, reach: 'town', hush: 0.06, cheer: true, voices: true };
    case 'decide': return { rank: 3, climax: TOWN_BEAT.board.decide[1], payoff: TOWN_BEAT.board.decide[1] + 2400, end: LENGTH.decide, reach: 'town', hush: 0.1,
      cheer: beat.line.startsWith('The town chose'), voices: true };
    case 'board': return { rank: 2, climax: TOWN_BEAT.board.rise[1], payoff: TOWN_BEAT.board.rise[1] + 2000, end: 6000, reach: 'street', hush: 0, cheer: false, voices: true };
    case 'colours': return { rank: 3, climax: TOWN_BEAT.colours.wave[1], payoff: TOWN_BEAT.colours.wave[1] + 1800, end: LENGTH.colours, reach: 'town', hush: 0, cheer: true, voices: true };
    case 'bell': return { rank: 2, climax: TOWN_BEAT.bell.strokes[0], payoff: TOWN_BEAT.bell.strokes[2] + 1500, end: TOWN_BEAT.bell.end, reach: 'town', hush: 0.08, cheer: false, voices: false };
    case 'sapling': return { rank: 2, climax: TOWN_BEAT.sapling.sprout[1], payoff: TOWN_BEAT.sapling.caption[1] - 1500, end: TOWN_BEAT.sapling.end, reach: 'neighbours', hush: 0, cheer: true, voices: false };
    case 'tree': return { rank: 2, climax: TOWN_BEAT.tree.grow[1], payoff: TOWN_BEAT.tree.caption[1] - 1500, end: TOWN_BEAT.tree.end, reach: 'neighbours', hush: 0, cheer: true, voices: false };
    case 'relight': case 'show-home': return { rank: 1, climax: TOWN_BEAT.relight.flare[1], payoff: TOWN_BEAT.relight.settle[1], end: LENGTH[beat.act], reach: 'neighbours', hush: 0, cheer: false, voices: false };
    case 'welcome': return { rank: 1, climax: 1200, payoff: 4000, end: LENGTH.welcome, reach: 'neighbours', hush: 0, cheer: false, voices: false };
  }
}
export const townCandidate = (beat: TownBeat): StageCandidate => ({ beat: beat.id, subject: beat.subject, startAt: beat.startAt, profile: townProfile(beat) });

export function townCues(beat: TownBeat): AudioCueFrame[] {
  const at = (ms: number) => beat.startAt + ms, id = (suffix: string) => `${beat.id}:${suffix}`;
  switch (beat.act) {
    case 'sapling': return [{ id: id('soil'), cue: 'parcel-land', atMs: at(TOWN_BEAT.sapling.soil[0]), gain: 0.55 },
      { id: id('leaf'), cue: 'kite-wind', atMs: at(TOWN_BEAT.sapling.sprout[0]), gain: 0.35 }, { id: id('tag'), cue: 'gift-bell', atMs: at(TOWN_BEAT.sapling.tag[0]), gain: 0.5 }];
    case 'tree': return [{ id: id('soil'), cue: 'parcel-land', atMs: at(TOWN_BEAT.tree.soil[0]), gain: 0.65 },
      { id: id('leaf'), cue: 'kite-wind', atMs: at(TOWN_BEAT.tree.grow[0] + 400), gain: 0.5 }, { id: id('tag'), cue: 'gift-bell', atMs: at(TOWN_BEAT.tree.tag[0]), gain: 0.5 }];
    case 'relight': case 'show-home': return [{ id: id('light'), cue: 'gift-bell', atMs: at(TOWN_BEAT.relight.flare[0]), gain: 0.55 }];
    case 'welcome': return [{ id: id('horn'), cue: 'horn', atMs: at(400), gain: 0.45 }];
    case 'gate': return [{ id: id('drum'), cue: 'festival-drum', atMs: at(TOWN_BEAT.gate.braziers[0]), gain: 0.7 },
      { id: id('horn'), cue: 'horn', atMs: at(TOWN_BEAT.gate.standard[0]), gain: 1 }, { id: id('cloth'), cue: 'cloth-unfurl', atMs: at(TOWN_BEAT.gate.standard[1] - 900), gain: 0.7 },
      { id: id('beacon'), cue: 'spark-rise', atMs: at(TOWN_BEAT.gate.beacon[0]), gain: 0.6 }];
    case 'bell': return TOWN_BEAT.bell.strokes.map((ms, i) => ({ id: id(`stroke${i}`), cue: 'wyrm-bell' as const, atMs: at(ms), gain: i === 2 ? 0.8 : 0.65 }));
    case 'festival': return [{ id: id('drum'), cue: 'festival-drum', atMs: at(200), gain: 0.9 }, { id: id('pop'), cue: 'confetti-pop', atMs: at(TOWN_BEAT.festival.dress[1] - 600), gain: 0.7 },
      { id: id('cloth'), cue: 'cloth-unfurl', atMs: at(900), gain: 0.6 }];
    case 'board': return [{ id: id('horn'), cue: 'horn', atMs: at(200), gain: 0.7 }, { id: id('cloth'), cue: 'cloth-unfurl', atMs: at(TOWN_BEAT.board.rise[1] - 600), gain: 0.6 }];
    case 'decide': return beat.line.startsWith('The town chose')
      ? [{ id: id('fanfare'), cue: 'victory-fanfare', atMs: at(TOWN_BEAT.board.decide[1] - 200), gain: 0.75 }]
      : [{ id: id('murmur'), cue: 'crowd-murmur', atMs: at(TOWN_BEAT.board.decide[1] - 600), gain: 0.5 }];
    case 'colours': return [{ id: id('cloth'), cue: 'cloth-unfurl', atMs: at(TOWN_BEAT.colours.wave[0]), gain: 0.8 }];
  }
}

/** The town as the layers draw it at `atMs`: lasting state, posed by whichever town beats are live. */
export function townFrame(state: TownState, beats: readonly TownBeat[], atMs: number, visible: boolean): TownFrame {
  if (!visible) return EMPTY_TOWN;
  const started = beats.filter(b => atMs >= b.startAt && atMs < b.endAt);
  const waiting = beats.filter(b => atMs < b.startAt);

  const plantings: PlantingFrame[] = [];
  for (const [slot, entry] of state.grove) {
    if (plantings.length >= TOWN_LIMITS.plantings) break;
    const name = state.names.get(slot) ?? null;
    for (const kind of ['sapling', 'tree'] as const) {
      if (entry[kind] === null) continue;
      const beat = started.find(b => b.slot === slot && b.act === kind);
      // A planting whose beat is still waiting for the stage is not in the ground yet.
      if (!beat && waiting.some(b => b.slot === slot && b.act === kind)) continue;
      if (beat) {
        const t = atMs - beat.startAt, timing = kind === 'sapling' ? TOWN_BEAT.sapling.sprout : TOWN_BEAT.tree.grow;
        const tag = kind === 'sapling' ? TOWN_BEAT.sapling.tag : TOWN_BEAT.tree.tag;
        const swing = t < tag[0] ? 0 : Math.sin((t - tag[0]) / 190) * 0.5 * Math.exp(-(t - tag[0]) / 900);
        plantings.push({ slot, kind, name, grow: smoothstep(timing[0], timing[1], t), tag: swing, t });
      } else plantings.push({ slot, kind, name, grow: 1, tag: 0, t: null });
    }
  }

  let colour = state.colour, colourChange: TownFrame['colourChange'] = null;
  const decreeBeat = [...started, ...waiting].find(b => b.act === 'colours');
  if (decreeBeat && decreeBeat.from && decreeBeat.to) {
    // Until its wave runs, the town still flies the colours it had.
    if (atMs < decreeBeat.startAt) colour = decreeBeat.from;
    else {
      const wave = smoothstep(TOWN_BEAT.colours.wave[0], TOWN_BEAT.colours.wave[1], atMs - decreeBeat.startAt);
      colourChange = wave < 1 ? { from: decreeBeat.from, to: decreeBeat.to, wave } : null;
    }
  }

  let gate: GateFrame | null = null;
  const night = state.night;
  if (night?.phase === 'open') {
    const beat = [...started, ...waiting].find(b => b.act === 'gate');
    if (beat && atMs >= beat.startAt) {
      const t = atMs - beat.startAt;
      gate = { number: night.number, colour, t, braziers: smoothstep(TOWN_BEAT.gate.braziers[0], TOWN_BEAT.gate.braziers[1], t),
        standard: smoothstep(TOWN_BEAT.gate.standard[0], TOWN_BEAT.gate.standard[1], t), beacon: smoothstep(TOWN_BEAT.gate.beacon[0], TOWN_BEAT.gate.beacon[1], t) };
    } else if (beat) gate = { number: night.number, colour, t: 0, braziers: 0, standard: 0, beacon: 0 };
    else gate = { number: night.number, colour, t: null, braziers: 1, standard: 1, beacon: 1 };
  }

  const relights: RelightFrame[] = started.filter(b => (b.act === 'relight' || b.act === 'show-home') && b.slot !== null).slice(0, TOWN_LIMITS.relights).map(b => {
    const t = atMs - b.startAt, f = TOWN_BEAT.relight;
    return { id: b.id, slot: b.slot!, t, flare: smoothstep(f.flare[0], f.flare[1], t) * (1 - 0.55 * smoothstep(f.settle[0], f.settle[1], t)) };
  });
  const bellBeat = started.find(b => b.act === 'bell');

  let festival: TownFrame['festival'] = null;
  if (state.festival) {
    const live = [...started, ...waiting].find(b => b.act === 'festival');
    const at = live ? live.startAt : state.festival.at, t = atMs - at, f = TOWN_BEAT.festival;
    if (t >= 0 && t < f.length) {
      festival = { id: state.festival.id, t, colour, dressed: (live ? smoothstep(f.dress[0], f.dress[1], t) : 1) * (1 - smoothstep(f.length - f.undress, f.length, t)) };
    }
  }

  return { plantings, colour, colourChange, gate, board: boardFrame(state, beats, atMs), relights, bell: bellBeat ? { id: bellBeat.id, t: atMs - bellBeat.startAt } : null, festival };
}

function boardFrame(state: TownState, beats: readonly TownBeat[], atMs: number): BoardFrame | null {
  const board = state.board;
  if (!board) return null;
  const rise = beats.find(b => b.act === 'board' && b.pollKey === board.key);
  const decide = beats.find(b => b.act === 'decide' && b.pollKey === board.key);
  // A board waits for its beat; it stands from the beat's start, or from when it was restored.
  const roseAt = rise ? rise.startAt : board.roseAt;
  if (atMs < roseAt) return null;
  // A board that ended before this session saw it is history, not a scene.
  if (board.endedAt !== null && !Number.isFinite(board.endedAt) && !decide) return null;
  // Its result is told when its decide beat takes the stage; until then it still stands open.
  const endedAt = board.endedAt === null ? null : decide ? decide.startAt : board.endedAt;
  const decidedT = endedAt === null || atMs < endedAt ? null : atMs - endedAt;
  const b = TOWN_BEAT.board;
  if (decidedT !== null && decidedT >= b.lower[1]) return null;
  const raised = (Number.isFinite(roseAt) ? smoothstep(b.rise[0], b.rise[1], atMs - roseAt) : 1) * (decidedT === null ? 1 : 1 - smoothstep(b.lower[0], b.lower[1], decidedT));
  const phase: BoardFrame['phase'] = decidedT === null ? 'open' : board.cancelled ? 'cancelled' : board.winnerId !== null ? 'decided' : 'divided';
  const choices: BoardChoiceFrame[] = board.choices.map(c => ({ id: c.id, title: c.title, votes: c.votes, colour: c.colour, share: shareAt(c, atMs),
    winner: decidedT !== null && c.id === board.winnerId && decidedT >= b.decide[0] }));
  return { key: board.key, title: board.title, t: Number.isFinite(roseAt) ? atMs - roseAt : b.rise[1] + 60_000, choices, phase, decidedT, decree: board.decree, raised };
}

export { TOWN_COLOURS };
