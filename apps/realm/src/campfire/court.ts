import { DUSK_COURT, type DuskCourtPhase, type DuskCourtRole, type DuskCourtView, type CampfireSelf } from '@chatdom/shared';

/*
 * Dusk Court, the short version, as a pure state machine. The fire owns one of these per kingdom; every input comes
 * with the room's clock and every random draw comes from the persisted seed and cursor. Roles, night taps, ballots,
 * the pending dawn and the Gallery's identities are private state: `courtView` projects only what everyone may know,
 * and the public `revision` moves only when that projection changes, so a secret tap never shows up as activity.
 */

export interface CourtPlayer {
  seat: number; person: string; name: string;
  /** Null until the deal. */
  role: DuskCourtRole | null;
  lantern: 'lit' | 'snuffed' | 'sent';
  /** Room time this player stepped off their log, or null while seated. */
  awaySince: number | null;
  gone: boolean;
}
export interface CourtState {
  match: string;
  /** Public revision: moves only with the public view. */
  revision: number;
  phase: DuskCourtPhase; night: number; startedAt: number; deadline: number;
  /** The clock has run out and the fire waits for the Magistrate (until `deadline`, which then holds the grace). */
  waiting: boolean;
  wolves: 1 | 2;
  players: CourtPlayer[];
  /** Night taps by seat (the Wolves' snuff, the Watchman's question) and ballots by seat. Private. */
  taps: Record<string, number | null>;
  votes: Record<string, number | null>;
  /** The Watchman's answers, private to the Watchman. */
  answers: { night: number; seat: number; wolf: boolean }[];
  /** Resolved but not yet read aloud (a Magistrate reads it). Private until then. */
  pending: { kind: 'dawn'; seat: number | null } | { kind: 'verdict'; seat: number | null; tie: boolean; votes: number } | null;
  dawn: { night: number; seat: number | null } | null;
  verdict: { night: number; seat: number | null; tie: boolean; votes: number } | null;
  result: { winner: 'town' | 'wolves' | null; reason: 'caught' | 'outnumbered' | 'lanterns' | 'left' } | null;
  /** The Gallery today: one suspicion per Twitch identity, dropped when the day ends. Private. */
  gallery: { night: number; counted: Record<string, number> };
  /** Server-only randomness. */
  seed: number; cursor: number;
}
export interface CourtSeat { readonly seat: number; readonly person: string; readonly name: string }

const SEAT_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const lit = (p: CourtPlayer) => p.lantern === 'lit' && !p.gone;
const bySeat = (state: CourtState, seat: number) => state.players.find(p => p.seat === seat);

function draw(state: CourtState, below: number): number {
  if (below <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / below) * below;
  let value: number;
  do {
    state.cursor = (state.cursor + 1) >>> 0;
    let n = (state.seed + Math.imul(state.cursor, 0x9e3779b9)) | 0;
    n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
    n = Math.imul(n ^ n >>> 15, 0x735a2d97);
    value = (n ^ n >>> 15) >>> 0;
  } while (value >= limit);
  return value % below;
}

function touch(state: CourtState): void { state.revision += 1; }

/** A round asked for by the circle: the call phase, while the roster may still change. */
export function openCourt(match: string, seed: number, now: number, seated: readonly CourtSeat[]): CourtState {
  if (!SEAT_RE.test(match) || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || !Number.isSafeInteger(now) || now < 0) throw new RangeError('Invalid Dusk Court start');
  const state: CourtState = { match, revision: 0, phase: 'call', night: 1, startedAt: now, deadline: now + DUSK_COURT.callMs, waiting: false,
    wolves: 1, players: [], taps: {}, votes: {}, answers: [], pending: null, dawn: null, verdict: null, result: null,
    gallery: { night: 1, counted: {} }, seed, cursor: 0 };
  setRoster(state, seated);
  return state;
}

function setRoster(state: CourtState, seated: readonly CourtSeat[]): boolean {
  const next = [...seated].filter(s => Number.isInteger(s.seat) && s.seat >= 1).sort((a, b) => a.seat - b.seat).slice(0, DUSK_COURT.maxPlayers);
  const before = state.players.map(p => `${p.seat}:${p.person}:${p.name}`).join('|');
  state.players = next.map(s => ({ seat: s.seat, person: s.person, name: s.name, role: null, lantern: 'lit', awaySince: null, gone: false }));
  state.wolves = state.players.length >= DUSK_COURT.secondWolfAt ? 2 : 1;
  const changed = before !== state.players.map(p => `${p.seat}:${p.person}:${p.name}`).join('|');
  if (changed) touch(state);
  return changed;
}

/**
 * Who sits on the logs now. During the call the roster follows the logs; afterwards it is fixed, and a player off
 * their log is away for `awayMs`, then gone. Returns whether anything public changed.
 */
export function seatedNow(state: CourtState, seated: readonly CourtSeat[], now: number): boolean {
  if (state.phase === 'call') return setRoster(state, seated);
  if (state.phase === 'ended') return false;
  let changed = false;
  for (const player of state.players) {
    if (player.gone) continue;
    const here = seated.some(s => s.seat === player.seat && s.person === player.person);
    if (here && player.awaySince !== null) { player.awaySince = null; changed = true; }
    else if (!here && player.awaySince === null) { player.awaySince = now; changed = true; }
  }
  if (changed) touch(state);
  return changed;
}

/** Choices open to one seat now. */
export function choiceOf(state: CourtState, seat: number): { kind: 'snuff' | 'watch' | 'vote'; targets: number[] } | null {
  const me = bySeat(state, seat);
  if (!me || !lit(me) || me.awaySince !== null) return null;
  const living = state.players.filter(lit);
  if (state.phase === 'night' && me.role === 'wolf') return { kind: 'snuff', targets: living.filter(p => p.role !== 'wolf').map(p => p.seat) };
  if (state.phase === 'night' && me.role === 'watchman') return { kind: 'watch', targets: living.filter(p => p.seat !== seat).map(p => p.seat) };
  if (state.phase === 'ballot') return { kind: 'vote', targets: living.filter(p => p.seat !== seat).map(p => p.seat) };
  return null;
}

/** A night tap or a ballot. Null rests or abstains; a later choice in the same phase replaces the earlier one. */
export function choose(state: CourtState, seat: number, target: number | null): 'accepted' | 'refused' {
  const open = choiceOf(state, seat);
  if (!open || (target !== null && !open.targets.includes(target)) || state.waiting) return 'refused';
  if (open.kind === 'vote') {
    const before = state.votes[seat] !== undefined && state.votes[seat] !== null;
    state.votes[seat] = target;
    // Only whether a seat has voted is public, never for whom.
    if (before !== (target !== null)) touch(state);
  } else state.taps[seat] = target;
  return 'accepted';
}

function setPhase(state: CourtState, phase: DuskCourtPhase, now: number, ms: number): void {
  state.phase = phase; state.startedAt = now; state.deadline = now + ms; state.waiting = false; touch(state);
}

function deal(state: CourtState, now: number): void {
  const order = state.players.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = draw(state, i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  order.forEach((index, rank) => { state.players[index]!.role = rank < state.wolves ? 'wolf' : rank === state.wolves ? 'watchman' : 'townsfolk'; });
  setPhase(state, 'deal', now, DUSK_COURT.dealMs);
}

function resolveNight(state: CourtState): number | null {
  const living = state.players.filter(lit);
  const prey = living.filter(p => p.role !== 'wolf').map(p => p.seat);
  if (!prey.length) return null;
  const counts = new Map<number, number>();
  for (const wolf of living.filter(p => p.role === 'wolf' && p.awaySince === null)) {
    const target = state.taps[wolf.seat];
    if (typeof target === 'number' && prey.includes(target)) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  const tied = top ? [...counts].filter(([, n]) => n === top).map(([seat]) => seat).sort((a, b) => a - b) : prey;
  // An untapped night still takes a lantern: the wind chooses, from the fire's own draw.
  return tied[draw(state, tied.length)]!;
}

function resolveBallot(state: CourtState): { seat: number | null; tie: boolean; votes: number } {
  const counts = new Map<number, number>();
  let votes = 0;
  for (const voter of state.players.filter(p => lit(p) && p.awaySince === null)) {
    const target = state.votes[voter.seat];
    const victim = typeof target === 'number' ? bySeat(state, target) : undefined;
    if (!victim || !lit(victim)) continue;
    counts.set(victim.seat, (counts.get(victim.seat) ?? 0) + 1); votes += 1;
  }
  const top = Math.max(0, ...counts.values()), leaders = [...counts].filter(([, n]) => n === top);
  if (!top) return { seat: null, tie: false, votes };
  return leaders.length === 1 ? { seat: leaders[0]![0], tie: false, votes } : { seat: null, tie: true, votes };
}

/** Has someone won? Applied after every dawn, verdict and departure. */
function decide(state: CourtState, lastDay: boolean): CourtState['result'] {
  const living = state.players.filter(lit);
  const wolves = living.filter(p => p.role === 'wolf').length, others = living.length - wolves;
  if (wolves === 0) return state.players.some(p => p.role === 'wolf' && p.lantern === 'sent') ? { winner: 'town', reason: 'caught' } : { winner: null, reason: 'left' };
  if (wolves >= others) return { winner: 'wolves', reason: 'outnumbered' };
  if (lastDay) return { winner: 'wolves', reason: 'lanterns' };
  return null;
}

function end(state: CourtState, result: NonNullable<CourtState['result']>, now: number): void {
  state.result = result; state.pending = null; state.taps = {}; state.votes = {};
  state.gallery = { night: state.night, counted: {} };
  setPhase(state, 'ended', now, DUSK_COURT.endMs);
}

function readDawn(state: CourtState, seat: number | null, now: number): void {
  if (seat !== null) bySeat(state, seat)!.lantern = 'snuffed';
  state.dawn = { night: state.night, seat }; state.pending = null;
  const result = decide(state, false);
  if (result) end(state, result, now); else setPhase(state, 'dawn', now, DUSK_COURT.dawnMs);
}

function readVerdict(state: CourtState, verdict: { seat: number | null; tie: boolean; votes: number }, now: number): void {
  if (verdict.seat !== null) bySeat(state, verdict.seat)!.lantern = 'sent';
  // Only the public fields: a pending verdict carries its own `kind`, which never goes out.
  state.verdict = { night: state.night, seat: verdict.seat, tie: verdict.tie, votes: verdict.votes }; state.pending = null; state.votes = {};
  const result = decide(state, state.night >= DUSK_COURT.nights);
  if (result) end(state, result, now); else setPhase(state, 'verdict', now, DUSK_COURT.verdictMs);
}

/**
 * Advance the clock. `presiding`: a Magistrate sits in the chair with the stream live; then the dawn, the end of the
 * talk and the verdict wait for their call, for at most the grace. Returns false when the call ends without enough
 * people (the round is dropped, nothing is dealt).
 */
export function advance(state: CourtState, now: number, presiding: boolean): 'running' | 'cancelled' | 'finished' {
  for (const player of state.players) {
    if (!player.gone && player.awaySince !== null && now - player.awaySince >= DUSK_COURT.awayMs && state.phase !== 'call' && state.phase !== 'ended') {
      player.gone = true; touch(state);
      const result = decide(state, false);
      if (result) end(state, result, now);
    }
  }
  for (let guard = 0; guard < 16; guard++) {
    if (state.phase === 'ended') return now >= state.deadline ? 'finished' : 'running';
    // A Magistrate who leaves the chair while the fire waits for them: the fire calls it at once.
    const due = now >= state.deadline || (state.waiting && !presiding);
    if (!due) return 'running';
    if (state.waiting) { call(state, now); continue; }
    const at = Math.min(now, state.deadline);
    switch (state.phase) {
      case 'call':
        if (state.players.length < DUSK_COURT.minPlayers) return 'cancelled';
        deal(state, at); break;
      case 'deal': state.taps = {}; setPhase(state, 'night', at, DUSK_COURT.nightMs); break;
      case 'night': {
        const seat = resolveNight(state);
        const watchman = state.players.find(p => p.role === 'watchman' && lit(p) && p.awaySince === null);
        const asked = watchman ? state.taps[watchman.seat] : null;
        const subject = typeof asked === 'number' ? bySeat(state, asked) : undefined;
        if (watchman && subject) state.answers.push({ night: state.night, seat: subject.seat, wolf: subject.role === 'wolf' });
        state.taps = {};
        state.gallery = { night: state.night, counted: {} };
        if (presiding) { state.pending = { kind: 'dawn', seat }; state.phase = 'dawn'; state.startedAt = at; state.deadline = at + DUSK_COURT.magistrateGraceMs; state.waiting = true; touch(state); }
        else readDawn(state, seat, at);
        break;
      }
      case 'dawn': setPhase(state, 'talk', at, DUSK_COURT.talkMs); break;
      case 'talk':
        if (presiding) { state.waiting = true; state.deadline = at + DUSK_COURT.magistrateGraceMs; touch(state); }
        else { state.votes = {}; setPhase(state, 'ballot', at, DUSK_COURT.ballotMs); }
        break;
      case 'ballot': {
        const verdict = resolveBallot(state);
        if (presiding) { state.pending = { kind: 'verdict', ...verdict }; state.phase = 'verdict'; state.startedAt = at; state.deadline = at + DUSK_COURT.magistrateGraceMs; state.waiting = true; state.votes = {}; touch(state); }
        else readVerdict(state, verdict, at);
        break;
      }
      case 'verdict':
        state.night += 1; state.taps = {}; state.gallery = { night: state.night, counted: {} };
        setPhase(state, 'night', at, DUSK_COURT.nightMs);
        break;
    }
  }
  return 'running';
}

/** The Magistrate's call: read the dawn, end the talk (any time), read the verdict. */
export function call(state: CourtState, now: number): 'accepted' | 'refused' {
  if (state.phase === 'talk') { state.votes = {}; setPhase(state, 'ballot', now, DUSK_COURT.ballotMs); return 'accepted'; }
  if (!state.waiting || !state.pending) return 'refused';
  const pending = state.pending;
  if (pending.kind === 'dawn') readDawn(state, pending.seat, now);
  else readVerdict(state, pending, now);
  return 'accepted';
}

/**
 * The Gallery: `!sus name` from one Twitch identity, once per day, for a living player. Names match the approved
 * public name, ignoring case and a leading `@`.
 */
export function suspect(state: CourtState, chatter: string, name: string): 'counted' | 'ignored' {
  if (state.phase !== 'dawn' && state.phase !== 'talk' && state.phase !== 'ballot') return 'ignored';
  if (Object.hasOwn(state.gallery.counted, chatter)) return 'ignored';
  const wanted = name.trim().replace(/^@/, '').toLowerCase();
  const player = state.players.find(p => lit(p) && p.name.toLowerCase() === wanted);
  if (!player || Object.keys(state.gallery.counted).length >= 50_000) return 'ignored';
  const before = JSON.stringify([...embers(state)]);
  state.gallery.counted[chatter] = player.seat;
  if (JSON.stringify([...embers(state)]) !== before) touch(state);
  return 'counted';
}

function embers(state: CourtState): Map<number, 0 | 1 | 2 | 3> {
  const counts = new Map<number, number>();
  for (const seat of Object.values(state.gallery.counted)) counts.set(seat, (counts.get(seat) ?? 0) + 1);
  const top = Math.max(0, ...counts.values()), out = new Map<number, 0 | 1 | 2 | 3>();
  for (const [seat, n] of counts) {
    const player = bySeat(state, seat);
    if (top && player && lit(player)) out.set(seat, Math.max(1, Math.min(3, Math.ceil(3 * n / top))) as 1 | 2 | 3);
  }
  return out;
}

/** Everything everyone may know. Roles only beside a dark lantern or once the round has ended. */
export function courtView(state: CourtState): DuskCourtView {
  const glow = embers(state), ended = state.phase === 'ended';
  return {
    match: state.match, revision: state.revision, phase: state.phase, night: state.night,
    startedAt: state.startedAt, deadline: state.deadline, waiting: state.waiting, wolves: state.wolves,
    players: state.players.map(p => ({ seat: p.seat, name: p.name, lantern: p.lantern,
      role: (ended || p.lantern !== 'lit') ? p.role : null, away: p.awaySince !== null && !p.gone, gone: p.gone,
      embers: glow.get(p.seat) ?? 0, voted: state.phase === 'ballot' && state.votes[p.seat] !== undefined && state.votes[p.seat] !== null })),
    dawn: state.dawn ? { ...state.dawn } : null,
    verdict: state.verdict ? { ...state.verdict } : null,
    result: state.result ? { ...state.result } : null,
  };
}

/** One seat's own view: its card, its fellow Wolves, its open choice and the Watchman's answers. */
export function courtSelf(state: CourtState, person: string): Pick<CampfireSelf, 'match' | 'role' | 'wolves' | 'choice' | 'answers'> {
  const me = state.players.find(p => p.person === person);
  if (!me || state.phase === 'call') return { match: me ? state.match : null, role: null, wolves: [], choice: null, answers: [] };
  const open = choiceOf(state, me.seat);
  const chosen = open ? (open.kind === 'vote' ? state.votes[me.seat] : state.taps[me.seat]) ?? null : null;
  return {
    match: state.match, role: me.role,
    wolves: me.role === 'wolf' ? state.players.filter(p => p.role === 'wolf' && p.seat !== me.seat).map(p => p.seat) : [],
    choice: open && !state.waiting ? { kind: open.kind, targets: open.targets, chosen, deadline: state.deadline } : null,
    answers: me.role === 'watchman' ? state.answers.map(a => ({ ...a })) : [],
  };
}
