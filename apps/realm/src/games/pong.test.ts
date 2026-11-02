import { describe, expect, it } from 'vitest';
import { GATHER_HZ } from '@chatdom/shared';
import { PONG, clampPaddle, concedePong, inputPong, interruptPong, movePaddle, pongView, startPong, tickPong } from './pong';

describe('authoritative Pong', () => {
  it('plays a complete match to seven and replays the same inputs from the seed', () => {
    const play = (seed: number) => {
      const state = startPong('hearth', seed, 10_000);
      const scores: [number, number][] = [];
      let last = '0:0';
      // Both players choose the far left edge; this produces rallies and missed balls through normal ticks.
      expect(inputPong(state, 0, 0, -1)).toBe(true);
      expect(inputPong(state, 1, 0, -1)).toBe(true);
      for (let i = 0; i < 30_000 && state.phase !== 'finished'; i++) {
        tickPong(state);
        const score = state.score.join(':');
        if (score !== last) {
          scores.push([...state.score]);
          expect(state.score[0] + state.score[1]).toBe(scores.length);
          if (pongView(state).phase !== 'finished') {
            expect(state.phase).toBe('serve');
            expect(state.serveAt).toBeGreaterThan(state.at);
            expect(state.ball).toEqual({ x: 0, y: 0, vx: 0, vy: 0 });
          }
          last = score;
        }
      }
      expect(state.phase).toBe('finished');
      expect(state.reason).toBe('points');
      expect(state.winner).not.toBeNull();
      expect(state.score[state.winner!]).toBe(7);
      expect(state.score[1 - state.winner!]).toBeLessThan(7);
      expect(scores.length).toBeGreaterThanOrEqual(7);
      return { view: pongView(state), scores, cursor: state.cursor };
    };
    const first = play(12345);
    expect(play(12345)).toEqual(first);
    expect(play(54321)).not.toEqual(first);
  });

  it('rejects duplicate, stale and malformed input without changing state', () => {
    const state = startPong('hearth', 2, 0);
    expect(inputPong(state, 0, 7, .5)).toBe(true);
    const before = structuredClone(state);
    for (const [sequence, paddle] of [[7, -.5], [6, 0], [-1, 0], [1.5, 0], [Infinity, 0], [0x1_0000_0000, 0], [8, NaN], [8, Infinity], [8, 1.01]] as const) {
      expect(inputPong(state, 0, sequence, paddle)).toBe(false);
      expect(state).toEqual(before);
    }
    expect(inputPong(state, 1, 7, -.5)).toBe(true);
    expect(inputPong(state, 0, 8, -.5)).toBe(true);
  });

  it('starts after the serve deadline and limits paddle motion and position', () => {
    const state = startPong('hearth', 1, 1_000);
    expect(inputPong(state, 0, 0, 1)).toBe(true);
    tickPong(state);
    expect(state.phase).toBe('serve');
    expect(state.paddles[0]).toBeCloseTo(PONG.paddleSpeed / GATHER_HZ);
    expect(movePaddle(0, 1, PONG.step)).toBeCloseTo(state.paddles[0]);
    expect(clampPaddle(100)).toBeCloseTo(1 - PONG.paddleHalf);
    while (state.at + 1000 / GATHER_HZ < state.serveAt) tickPong(state);
    expect(state.phase).toBe('serve');
    while (state.phase === 'serve') tickPong(state);
    expect(state.phase).toBe('rally');
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeCloseTo(PONG.startSpeed);
    for (let i = 0; i < 60; i++) tickPong(state);
    expect(state.paddles[0]).toBeCloseTo(1 - PONG.paddleHalf);
  });

  it('sweeps a fast ball against a paddle, increases rally speed, and reflects at a side wall', () => {
    const state = startPong('hearth', 1, 0);
    state.phase = 'rally';
    state.ball = { x: 0, y: PONG.paddleY - PONG.radius - .05, vx: 0, vy: 3 };
    tickPong(state);
    expect(state.ball.vy).toBeLessThan(0);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(3);
    expect(state.ball.y).toBeLessThan(PONG.paddleY - PONG.radius);
    expect(state.score).toEqual([0, 0]);

    state.ball = { x: 1 - PONG.radius - .01, y: 0, vx: 3, vy: .2 };
    tickPong(state);
    expect(state.ball.vx).toBeLessThan(0);
    expect(state.ball.x).toBeLessThanOrEqual(1 - PONG.radius);
    expect(Object.values(state.ball).every(Number.isFinite)).toBe(true);
  });

  it('ends a conceded match once, and a restart interrupts without a winner', () => {
    const conceded = startPong('hearth', 1, 0);
    concedePong(conceded, 0);
    expect(pongView(conceded)).toMatchObject({ phase: 'finished', reason: 'conceded', winner: 1 });
    const final = structuredClone(conceded);
    concedePong(conceded, 1); interruptPong(conceded); tickPong(conceded);
    expect(inputPong(conceded, 1, 0, 0)).toBe(false);
    expect(conceded).toEqual(final);

    const restarted = startPong('hearth', 1, 0);
    interruptPong(restarted);
    expect(pongView(restarted)).toMatchObject({ phase: 'interrupted', reason: 'restart', winner: null });
    const interrupted = structuredClone(restarted);
    concedePong(restarted, 0); tickPong(restarted);
    expect(restarted).toEqual(interrupted);
  });

  it('projects no server seed or target and does not expose mutable state references', () => {
    const state = startPong('hearth', 12345, 1_000);
    inputPong(state, 0, 0, .5);
    const view = pongView(state);
    expect(view).not.toHaveProperty('seed');
    expect(view).not.toHaveProperty('cursor');
    expect(view).not.toHaveProperty('targets');
    expect(view).not.toHaveProperty('serveTo');
    const before = structuredClone(state);
    (view.ball as { x: number }).x = 42;
    (view.paddles as [number, number])[0] = 42;
    (view.acknowledged as [number, number])[0] = 42;
    (view.score as [number, number])[0] = 42;
    expect(state).toEqual(before);
  });
});
