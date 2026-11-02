import { describe, expect, it } from 'vitest';
import { createFight, FIGHT_TICK_MS, MAX_FIGHT_TICKS, replayFight, stepFight, verifyFight,
  type FightInput, type FightProfile, type FightState } from './fight';

const profiles: readonly FightProfile[] = ['dart', 'steady', 'surge'];
// Uses only displayed phase and tension; no seed, future schedule or private counters.
const fair = (state: FightState) => state.phase === 'rest' && state.tension < 6_000;
const play = (seed: number, profile: FightProfile, control = fair) => {
  let state = createFight(seed, profile), previous = false;
  const inputs: FightInput[] = [], states: FightState[] = [state];
  while (state.outcome === 'active') {
    const reel = control(state);
    if (reel !== previous) inputs.push({ tick: state.tick + 1, reel });
    state = stepFight(state, reel);
    states.push(state);
    previous = reel;
  }
  return { state, inputs, states };
};

describe('deterministic fishing fight', () => {
  it('lands fairly in 8–20 seconds across every profile and 256 varied seeds, with warning and fatigue', () => {
    expect(FIGHT_TICK_MS).toBe(50);
    expect(MAX_FIGHT_TICKS).toBe(600);
    for (const profile of profiles) for (let i = 0; i < 256; i++) {
      const seed = i === 255 ? 0xffff_ffff : Math.imul(i, 0x9e3779b9) >>> 0;
      const { state, states } = play(seed, profile);
      expect(state.outcome, `${profile}/${seed} at ${state.tick}`).toBe('landed');
      expect(state.tick).toBeGreaterThanOrEqual(160);
      expect(state.tick).toBeLessThanOrEqual(400);
      expect(state.tired).toBe(true);
      expect(states.some(s => s.phase === 'run')).toBe(true);
      let warning = 0, readableWarnings = true;
      for (let j = 1; j < states.length; j++) {
        const s = states[j]!;
        if (s.phase === 'warning') warning++;
        if (s.phase === 'run' && states[j - 1]!.phase !== 'run') {
          readableWarnings &&= warning * FIGHT_TICK_MS >= 750;
          warning = 0;
        }
      }
      expect(readableWarnings).toBe(true);
      expect(states.every(s => Number.isInteger(s.tension) && Number.isInteger(s.progress) &&
        s.tension >= 0 && s.tension < 10_000 && s.progress >= 0 && s.progress <= 10_000)).toBe(true);
    }
  }, 15_000);

  it('holding snaps and sustained slack escapes on every profile', () => {
    for (const profile of profiles) for (const seed of [0, 1, 17, 0xffff_ffff]) {
      const held = play(seed, profile, () => true);
      expect(held.state.outcome).toBe('snapped');
      expect(held.state.phase).toBe('run');
      expect(held.state.tension).toBe(10_000);
      const idle = play(seed, profile, () => false);
      expect(idle.state.outcome).toBe('escaped');
      expect(idle.state.slack).toBe(30);
      expect(idle.state.tick).toBeLessThan(100);
      for (const played of [held, idle]) {
        expect(verifyFight({ seed, profile, inputs: played.inputs, throughTick: 600, claimed: played.state })).toBe(true);
      }
    }
  });

  it('stops at the lifetime bound even when controls keep the line without landing', () => {
    const { state, inputs } = play(0, 'surge', s => s.tension < (s.phase === 'run' ? 7_500 : 1_500));
    expect(state.outcome).toBe('timeout');
    expect(state.tick).toBe(MAX_FIGHT_TICKS);
    expect(verifyFight({ seed: 0, profile: 'surge', inputs, throughTick: 600, claimed: state })).toBe(true);
    expect(stepFight(state, true)).toEqual(state);
  });

  it('matches live stepping, JSON resume, replay partitions and the complete terminal record', () => {
    for (const profile of profiles) {
      const { state, inputs, states } = play(713, profile);
      for (const throughTick of [0, 1, 23, 90, 133, state.tick, 600]) {
        const prefix = inputs.filter(input => input.tick <= throughTick);
        const replay = replayFight({ seed: 713, profile, inputs: prefix, throughTick });
        expect(replay).toStrictEqual(states[Math.min(throughTick, state.tick)]);
        if (replay.outcome === 'active') {
          expect(stepFight(JSON.parse(JSON.stringify(replay)), fair(replay))).toStrictEqual(states[throughTick + 1]);
        }
      }
      expect(verifyFight({ seed: 713, profile, inputs, throughTick: state.tick, claimed: JSON.parse(JSON.stringify(state)) })).toBe(true);
      for (const [key, changed] of Object.entries({ version: 2, seed: 714, profile: 'unknown', tick: state.tick - 1,
        tension: state.tension + 1, progress: 9_999, slack: 1, phase: 'run', tired: false, outcome: 'escaped' })) {
        if (state[key as keyof FightState] === changed) continue;
        expect(verifyFight({ seed: 713, profile, inputs, throughTick: state.tick, claimed: { ...state, [key]: changed } }), key).toBe(false);
      }
    }
  });

  it('gives snap, escape and timeout priority when progress reaches landing on the same tick', () => {
    const { states } = play(1, 'steady');
    const before = states.find(s => s.tick > 40 && s.phase === 'rest')!;
    const snapped = stepFight({ ...before, tension: 9_999, progress: 9_999 }, true);
    expect(snapped.progress).toBe(10_000);
    expect(snapped.outcome).toBe('snapped');
    const escaped = stepFight({ ...before, tension: 0, progress: 9_999, slack: 29 }, true);
    expect(escaped.progress).toBe(10_000);
    expect(escaped.outcome).toBe('escaped');
    const prolonged = play(0, 'surge', s => s.tension < (s.phase === 'run' ? 7_500 : 1_500));
    const last = prolonged.states[599]!;
    const timeout = stepFight({ ...last, progress: 9_999, tension: 4_000, slack: 0 }, true);
    expect(timeout.progress).toBe(10_000);
    expect(timeout.outcome).toBe('timeout');
  });

  it('freezes all returned state and never aliases caller-owned snapshots or tape', () => {
    const original = createFight(4, 'dart'), mutable = { ...original };
    const next = stepFight(mutable, true);
    expect(mutable).toEqual(original);
    expect(next).not.toBe(mutable);
    expect(Object.isFrozen(original) && Object.isFrozen(next)).toBe(true);
    mutable.tension = 9_999;
    expect(next.tension).not.toBe(9_999);
    const tape = [{ tick: 1, reel: true }];
    const replay = replayFight({ seed: 4, profile: 'dart', inputs: tape, throughTick: 1 });
    expect(replay).toEqual(next);
    tape[0]!.reel = false;
    expect(replay).toEqual(next);
    const terminal = { ...play(4, 'dart').state };
    const stopped = stepFight(terminal, false);
    expect(stopped).not.toBe(terminal);
    expect(Object.isFrozen(stopped)).toBe(true);
  });
});

describe('fight evidence boundary', () => {
  const valid = { seed: 0, profile: 'dart', inputs: [{ tick: 1, reel: true }], throughTick: 1 };

  it('validates every bounded tape entry before replay, even entries beyond an early failure', () => {
    const terminal = play(0, 'dart', () => true).state;
    const sparse = Array<FightInput>(2);
    sparse[0] = { tick: 1, reel: true };
    const invalid = [null, undefined, {}, [], { ...valid, extra: true },
      ...[-1, -0, 1.1, NaN, Infinity, 0x1_0000_0000, '1'].map(seed => ({ ...valid, seed })),
      ...[-1, -0, 1.1, NaN, Infinity, 601, 1e100, '1'].map(throughTick => ({ ...valid, throughTick })),
      { ...valid, profile: 'toString' }, { ...valid, inputs: {} }, { ...valid, inputs: Array(601).fill(null) },
      { ...valid, inputs: sparse }, { ...valid, inputs: [{ tick: 0, reel: true }] },
      { ...valid, inputs: [{ tick: 1, reel: false }] }, { ...valid, inputs: [{ tick: 1, reel: 1 }] },
      { ...valid, inputs: [{ tick: 1, reel: true, extra: true }] },
      { ...valid, inputs: [{ tick: 1, reel: true }, { tick: 1, reel: false }] },
      { ...valid, throughTick: 5, inputs: [{ tick: 3, reel: true }, { tick: 2, reel: false }] },
      { ...valid, throughTick: 5, inputs: [{ tick: 1, reel: true }, { tick: 2, reel: true }] },
      { ...valid, inputs: [{ tick: 2, reel: true }] },
      { ...valid, throughTick: 600, inputs: [{ tick: 1, reel: true }, { tick: 600, reel: 'bad' }] }];
    for (const request of invalid) {
      expect(() => replayFight(request)).toThrow();
      expect(verifyFight(request)).toBe(false);
      if (request && typeof request === 'object' && !Array.isArray(request)) {
        expect(verifyFight({ ...request, claimed: terminal })).toBe(false);
      }
    }
  });

  it('rejects accessors, inherited fields, extra fields, noncanonical states and terminal tape tails', () => {
    let reads = 0;
    const getter = { ...valid, get seed() { reads++; return 0; } };
    const edgeGetter = { ...valid, inputs: [{ tick: 1, get reel() { reads++; return true; } }] };
    expect(() => replayFight(getter)).toThrow();
    expect(() => replayFight(edgeGetter)).toThrow();
    expect(reads).toBe(0);
    expect(() => replayFight(Object.create(valid))).toThrow();
    const initial = createFight(0, 'dart');
    expect(verifyFight({ ...valid, throughTick: 0, inputs: [], claimed: initial })).toBe(false);
    for (const changed of [{ tick: 1e100 }, { tension: NaN }, { slack: 1 }, { version: 2 },
      { phase: 'run' }, { tired: true }, { outcome: 'landed' }, { extra: true }]) {
      expect(() => stepFight({ ...initial, ...changed } as FightState, true)).toThrow();
    }
    expect(() => stepFight(initial, 1 as unknown as boolean)).toThrow();
    for (const seed of [-1, NaN, Infinity, 0x1_0000_0000]) expect(() => createFight(seed, 'dart')).toThrow();
    expect(() => createFight(1, 'constructor' as FightProfile)).toThrow();
    const held = play(0, 'dart', () => true);
    const tail = { seed: 0, profile: 'dart', throughTick: 600,
      inputs: [...held.inputs, { tick: held.state.tick + 1, reel: false }] };
    expect(() => replayFight(tail)).toThrow();
    expect(verifyFight({ ...tail, claimed: held.state })).toBe(false);
    expect(verifyFight({ ...valid, claimed: { ...held.state, extra: true } })).toBe(false);
  });
});
