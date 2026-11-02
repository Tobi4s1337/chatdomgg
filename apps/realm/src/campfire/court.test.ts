import { describe, expect, it } from 'vitest';
import { DUSK_COURT, DuskCourtViewSchema } from '@chatdom/shared';
import { advance, call, choiceOf, choose, courtSelf, courtView, openCourt, seatedNow, suspect, type CourtSeat, type CourtState } from './court';

const T0 = Date.UTC(2026, 10, 2, 21, 0, 0);
const circle = (n: number): CourtSeat[] => Array.from({ length: n }, (_, i) => ({ seat: i + 1, person: String(1000 + i), name: `Sitter ${i + 1}` }));
const until = (state: CourtState, phase: CourtState['phase'], presiding = false, seated?: CourtSeat[]) => {
  let now = state.startedAt;
  for (let i = 0; i < 64 && state.phase !== phase; i++) {
    now = Math.max(now, state.deadline);
    if (seated) seatedNow(state, seated, now);
    advance(state, now, presiding);
  }
  expect(state.phase).toBe(phase);
  return now;
};
const dealt = (n: number, seed = 7) => { const state = openCourt('fire-test', seed, T0, circle(n)); until(state, 'deal'); return state; };

describe('Dusk Court', () => {
  it('deals one Wolf (two from eight), one Watchman and Townsfolk for every count from four to ten', () => {
    for (let n = DUSK_COURT.minPlayers; n <= DUSK_COURT.maxPlayers; n++) for (const seed of [1, 2, 99, 0xffff_fffe]) {
      const state = dealt(n, seed), roles = state.players.map(p => p.role);
      expect(roles.filter(r => r === 'wolf')).toHaveLength(n >= 8 ? 2 : 1);
      expect(roles.filter(r => r === 'watchman')).toHaveLength(1);
      expect(roles.filter(r => r === 'townsfolk')).toHaveLength(n - (n >= 8 ? 3 : 2));
      expect(state.wolves).toBe(n >= 8 ? 2 : 1);
      // The same seed deals the same cards.
      expect(dealt(n, seed).players.map(p => p.role)).toEqual(roles);
    }
  });

  it('cancels a call that ends with fewer than four on the logs, and follows the logs until the deal', () => {
    const state = openCourt('fire-call', 3, T0, circle(5));
    seatedNow(state, circle(3), T0 + 1000);
    expect(state.players).toHaveLength(3);
    expect(advance(state, T0 + DUSK_COURT.callMs, false)).toBe('cancelled');
    const full = openCourt('fire-full', 3, T0, circle(12));
    expect(full.players).toHaveLength(DUSK_COURT.maxPlayers);
  });

  it('finishes with no input at all', () => {
    for (let n = 4; n <= 10; n++) {
      const state = openCourt('fire-idle', n, T0, circle(n));
      let now = T0;
      for (let i = 0; i < 200 && state.phase !== 'ended'; i++) { now = state.deadline; advance(state, now, false); }
      expect(state.phase).toBe('ended');
      expect(state.result?.winner).toBe('wolves');
      expect(now - T0).toBeLessThan(12 * 60_000);
    }
  });

  it('snuffs the Wolf’s lantern at dawn and sends away the most voted; a tie sends nobody', () => {
    const state = dealt(6);
    until(state, 'night');
    const wolf = state.players.find(p => p.role === 'wolf')!, watchman = state.players.find(p => p.role === 'watchman')!;
    const prey = state.players.find(p => p.role === 'townsfolk')!;
    expect(choose(state, wolf.seat, wolf.seat)).toBe('refused');
    expect(choose(state, prey.seat, wolf.seat)).toBe('refused');
    expect(choose(state, wolf.seat, prey.seat)).toBe('accepted');
    expect(choose(state, watchman.seat, wolf.seat)).toBe('accepted');
    until(state, 'dawn');
    expect(state.dawn).toEqual({ night: 1, seat: prey.seat });
    expect(courtView(state).players.find(p => p.seat === prey.seat)).toMatchObject({ lantern: 'snuffed', role: 'townsfolk' });
    expect(courtSelf(state, watchman.person).answers).toEqual([{ night: 1, seat: wolf.seat, wolf: true }]);
    // The dark lantern watches: no vote.
    until(state, 'ballot');
    expect(choiceOf(state, prey.seat)).toBeNull();
    const voters = state.players.filter(p => p.lantern === 'lit');
    const [a, b] = voters.filter(p => p.seat !== wolf.seat);
    // Two against two: a tie.
    choose(state, voters[0]!.seat === a!.seat ? b!.seat : voters[0]!.seat, a!.seat);
    let votes = 0;
    for (const voter of voters) {
      const target = votes < 2 ? (voter.seat === a!.seat ? b!.seat : a!.seat) : (voter.seat === b!.seat ? a!.seat : b!.seat);
      if (votes >= 4) break;
      if (choose(state, voter.seat, target) === 'accepted') votes++;
    }
    const tally = new Map<number, number>();
    for (const target of Object.values(state.votes)) if (target !== null) tally.set(target, (tally.get(target) ?? 0) + 1);
    until(state, 'verdict');
    const top = Math.max(...tally.values()), leaders = [...tally].filter(([, n]) => n === top);
    if (leaders.length > 1) expect(state.verdict).toMatchObject({ seat: null, tie: true });
    else expect(state.verdict?.seat).toBe(leaders[0]![0]);
  });

  it('the town wins by sending the Wolf away; the Wolves win when they equal the rest', () => {
    const town = dealt(5);
    until(town, 'ballot');
    const wolf = town.players.find(p => p.role === 'wolf')!;
    for (const voter of town.players.filter(p => p.lantern === 'lit' && p.seat !== wolf.seat)) choose(town, voter.seat, wolf.seat);
    until(town, 'ended');
    expect(town.result).toEqual({ winner: 'town', reason: 'caught' });
    expect(courtView(town).players.every(p => p.role !== null)).toBe(true);

    const wolves = dealt(4);
    until(wolves, 'ballot');
    const innocent = wolves.players.find(p => p.lantern === 'lit' && p.role !== 'wolf')!;
    for (const voter of wolves.players.filter(p => p.lantern === 'lit' && p.seat !== innocent.seat)) choose(wolves, voter.seat, innocent.seat);
    until(wolves, 'ended');
    expect(wolves.result).toEqual({ winner: 'wolves', reason: 'outnumbered' });
  });

  it.each([false, true])('keeps secrets out of every public view and every other seat (Magistrate presiding: %s)', presiding => {
    const state = dealt(8, 41), views: string[] = [];
    for (let i = 0; i < 400 && state.phase !== 'ended'; i++) {
      // With a Magistrate the dawn and the verdict wait for a call; every other one is read by the grace instead.
      if (presiding && state.waiting && i % 2) { call(state, state.startedAt); DuskCourtViewSchema.parse(courtView(state)); if (state.result) break; }
      for (const player of state.players) {
        const open = choiceOf(state, player.seat);
        if (open?.targets.length) choose(state, player.seat, open.targets[(i + player.seat) % open.targets.length]!);
      }
      if (i % 3 === 0) suspect(state, `chatter-${i}`, state.players[i % state.players.length]!.name);
      const view = courtView(state);
      DuskCourtViewSchema.parse(view);
      views.push(JSON.stringify(view));
      // A lit lantern never shows its role before the end; taps and answers are never public.
      for (const p of view.players) if (p.lantern === 'lit') expect(p.role).toBeNull();
      expect(JSON.stringify(view)).not.toMatch(/taps|answers|pending|counted|seed|cursor|person/);
      // Another seat's own view never carries this seat's card, taps or answers.
      for (const player of state.players) {
        const self = courtSelf(state, player.person);
        if (player.role !== 'wolf') expect(self.wolves).toEqual([]);
        if (player.role !== 'watchman') expect(self.answers).toEqual([]);
        expect(self.role).toBe(state.phase === 'call' ? null : player.role);
      }
      advance(state, state.deadline, presiding);
    }
    expect(state.phase).toBe('ended');
    expect(courtSelf(state, 'someone-else')).toMatchObject({ match: null, role: null, choice: null });
  });

  it('gives the same public trace for the same public moves until a reveal, whatever the secrets', () => {
    const traces = [3, 5, 8, 13].map(seed => {
      const state = openCourt('fire-trace', seed, T0, circle(7)), trace: string[] = [];
      while (state.phase !== 'dawn') {
        // Secret moves: every Wolf taps someone, the Watchman asks, differently per seed.
        for (const player of state.players) {
          const open = choiceOf(state, player.seat);
          if (open && open.kind !== 'vote') choose(state, player.seat, open.targets[seed % open.targets.length]!);
        }
        trace.push(JSON.stringify(courtView(state)));
        advance(state, state.deadline, false);
      }
      return trace;
    });
    for (const trace of traces) expect(trace).toEqual(traces[0]);
  });

  it('counts the Gallery once per identity per day, only for living players, and starts over each day', () => {
    const state = dealt(6);
    expect(suspect(state, 'viewer-1', 'Sitter 2')).toBe('ignored');
    until(state, 'talk');
    const living = state.players.find(p => p.lantern === 'lit')!;
    expect(suspect(state, 'viewer-1', `@${living.name.toUpperCase()}`)).toBe('counted');
    expect(suspect(state, 'viewer-1', living.name)).toBe('ignored');
    expect(suspect(state, 'viewer-2', 'nobody here')).toBe('ignored');
    expect(suspect(state, 'viewer-2', living.name)).toBe('counted');
    expect(courtView(state).players.find(p => p.seat === living.seat)?.embers).toBe(3);
    until(state, 'night');
    expect(state.gallery.counted).toEqual({});
    expect(courtView(state).players.every(p => p.embers === 0)).toBe(true);
  });

  it('waits for a presiding Magistrate to read the dawn and the verdict, within the grace', () => {
    const state = dealt(6);
    until(state, 'night');
    const now = state.deadline;
    advance(state, now, true);
    expect(state).toMatchObject({ phase: 'dawn', waiting: true });
    // Nothing is revealed until it is read.
    expect(courtView(state).dawn).toBeNull();
    expect(call(state, now + 2000)).toBe('accepted');
    expect(state.dawn?.night).toBe(1);
    // The talk may be called early; the ballot is never shortened.
    advance(state, state.deadline, true);
    expect(state.phase).toBe('talk');
    expect(call(state, state.startedAt + 5000)).toBe('accepted');
    expect(state.phase).toBe('ballot');
    expect(call(state, state.startedAt + 1)).toBe('refused');
    advance(state, state.deadline, true);
    expect(state).toMatchObject({ phase: 'verdict', waiting: true });
    // A Magistrate who stays silent: the fire reads it after the grace.
    advance(state, state.deadline, true);
    expect(state.waiting).toBe(false);
    expect(state.verdict?.night).toBe(1);
  });

  it('holds an away player’s place, then lets them go; a departure can end the round', () => {
    const state = dealt(4);
    until(state, 'night');
    const wolf = state.players.find(p => p.role === 'wolf')!;
    const without = circle(4).filter(s => s.seat !== wolf.seat);
    seatedNow(state, without, state.startedAt + 1000);
    expect(courtView(state).players.find(p => p.seat === wolf.seat)?.away).toBe(true);
    seatedNow(state, circle(4), state.startedAt + 2000);
    expect(courtView(state).players.find(p => p.seat === wolf.seat)?.away).toBe(false);
    seatedNow(state, without, state.startedAt + 3000);
    advance(state, state.startedAt + 3000 + DUSK_COURT.awayMs, false);
    expect(state.result).toEqual({ winner: null, reason: 'left' });
  });
});
