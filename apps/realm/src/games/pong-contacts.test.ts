import { describe, expect, it } from 'vitest';
import { PongViewSchema } from '@chatdom/shared';
import { PONG, pongView, startPong, tickPong } from './pong';

describe('Pong public swept contacts', () => {
  it('records only real impacts, at the impact point and time within the step', () => {
    const state = startPong('hearth', 3, 1000);
    tickPong(state);
    expect(pongView(state).contacts).toEqual([]);
    state.phase = 'rally';
    state.ball = { x: 0, y: 0, vx: .2, vy: .2 };
    tickPong(state);
    expect(pongView(state).contacts).toEqual([]);
    state.ball = { x: .9, y: PONG.paddleY - PONG.radius - .01, vx: 0, vy: 3 };
    tickPong(state);
    expect(pongView(state).contacts).toEqual([]);
    state.ball = { x: 0, y: PONG.paddleY - PONG.radius - .05, vx: 0, vy: 3 };
    const start = state.at;
    tickPong(state);
    const paddle = pongView(state).contacts![0]!;
    expect(paddle).toMatchObject({ sequence: 1, tick: state.tick, kind: 'paddle' });
    expect(paddle.x).toBeCloseTo(0);
    expect(paddle.y).toBeCloseTo(PONG.paddleY - PONG.radius);
    expect(paddle.at).toBeCloseTo(start + .05 / 3 * 1000, 0);
    expect(paddle.at).toBeLessThan(state.at);
    state.ball = { x: 1 - PONG.radius - .01, y: 0, vx: 3, vy: .2 };
    const railStart = state.at;
    tickPong(state);
    const rail = pongView(state).contacts![1]!;
    expect(rail).toMatchObject({ sequence: 2, tick: state.tick, kind: 'rail' });
    expect(rail.x).toBeCloseTo(1 - PONG.radius);
    expect(rail.y).toBeCloseTo(.2 * .01 / 3);
    expect(rail.at).toBeCloseTo(railStart + .01 / 3 * 1000, 0);
  });

  it('replays identically, keeps the latest eight impacts and isolates the public copy', () => {
    const play = () => {
      const state = startPong('hearth', 987, 0);
      state.phase = 'rally';
      for (let i = 0; i < 20; i++) {
        state.ball = { x: 1 - PONG.radius - .01, y: 0, vx: 3, vy: 0 };
        tickPong(state);
      }
      return state;
    };
    const state = play(), view = pongView(state);
    expect(view).toEqual(pongView(play()));
    expect(view.contacts).toHaveLength(8);
    expect(view.contacts!.map(c => c.sequence)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(view).not.toHaveProperty('seed');
    expect(view).not.toHaveProperty('cursor');
    expect(view).not.toHaveProperty('targets');
    const before = structuredClone(state);
    (view.contacts![0] as { x: number }).x = 42;
    (view.contacts as unknown[]).pop();
    expect(state).toEqual(before);
  });

  it('admits a real rail impact beyond a missed paddle without closing the destination protocol', () => {
    const state = startPong('missed-paddle-rail', 4, 1000);
    state.phase = 'rally';
    state.ball = { x: 1 - PONG.radius - .01, y: PONG.paddleY + .1, vx: 3, vy: .2 };
    tickPong(state);
    const view = pongView(state);
    expect(view.contacts).toHaveLength(1);
    expect(view.contacts![0]!.kind).toBe('rail');
    expect(view.contacts![0]!.y).toBeGreaterThan(PONG.paddleY);
    expect(PongViewSchema.safeParse(view).success).toBe(true);
  });

  it('accepts old stored views and rejects malformed or excessive contacts', () => {
    const old = pongView(startPong('hearth', 1, 0));
    delete (old as { contacts?: unknown }).contacts;
    expect(PongViewSchema.safeParse(old).success).toBe(true);
    const hit = { sequence: 1, tick: 1, at: 10, kind: 'rail', x: 1, y: 0 };
    expect(PongViewSchema.safeParse({ ...old, contacts: [hit] }).success).toBe(true);
    for (const contacts of [Array(9).fill(hit), [{ ...hit, x: 1.1 }], [{ ...hit, y: 4.1 }], [{ ...hit, kind: 'goal' }], [{ ...hit, sequence: -1 }], [{ ...hit, at: -1 }]]) {
      expect(PongViewSchema.safeParse({ ...old, contacts }).success).toBe(false);
    }
  });
});
