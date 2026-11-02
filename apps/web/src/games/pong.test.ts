import { describe, expect, it } from 'vitest';
import { GatherFrameSchema, PONG_RULES, type PongView } from '@chatdom/shared';
import { inputPong, pongView, startPong, tickPong } from '../../../realm/src/games/pong';
import { clampPongPaddle, PONG_BUFFER_MS, PongPresentation } from './pong';

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const sameScore = (a: PongView, b: PongView) => a.score[0] === b.score[0] && a.score[1] === b.score[1];

/** Reconstruct the public server path at an arbitrary time, only within the same rally. */
function referenceAt(history: readonly PongView[], at: number): Point | null {
  const right = history.findIndex(view => view.at >= at);
  if (right < 1) return null;
  const a = history[right - 1]!, b = history[right]!;
  if (a.phase !== 'rally' || b.phase !== 'rally' || !sameScore(a, b)) return null;
  const t = (at - a.at) / (b.at - a.at);
  return { x: a.ball.x + (b.ball.x - a.ball.x) * t, y: a.ball.y + (b.ball.y - a.ball.y) * t };
}

interface Packet { due: number; view: PongView }
interface Command { due: number; sequence: number; target: number }
function latencyRun(rtt: number) {
  const oneWay = rtt / 2, start = 10_000;
  const state = startPong(`latency-${rtt}`, 1652, start);
  const presentation = new PongPresentation(); presentation.setSeat(0);
  const packets: Packet[] = [{ due: start + oneWay, view: pongView(state) }];
  const commands: Command[] = [];
  const history: PongView[] = [pongView(state)];
  let sequence = 0, opponentSequence = 0, offset = -Infinity;
  let inputAt = 0, responseAt: number | null = null, initialPaddle = 0;
  let maxError = 0, maxCorrection = 0, maxPaddleStep = 0, rallySamples = 0, reversals = 0;
  let previous: PongView | null = null;
  // Server ticks at 30 Hz; the client renders at 60 Hz. Inputs and authoritative snapshots both traverse half RTT.
  for (let frame = 0; frame <= 900; frame++) {
    const now = start + frame * 1000 / 60;
    if (frame > 0 && frame % 2 === 0) {
      while (commands.length && commands[0]!.due <= now + .0001) {
        const command = commands.shift()!; inputPong(state, 0, command.sequence, command.target);
      }
      inputPong(state, 1, opponentSequence++, Math.max(-1, Math.min(1, state.ball.x)));
      const oldVy = state.ball.vy, oldPhase = state.phase;
      tickPong(state);
      if (oldPhase === 'rally' && state.phase === 'rally' && oldVy * state.ball.vy < 0) reversals++;
      const view = pongView(state); history.push(view); packets.push({ due: view.at + oneWay, view });
    }
    while (packets.length && packets[0]!.due <= now + .0001) {
      const packet = packets.shift()!;
      if (presentation.receive(packet.view, now)) offset = Math.max(offset, packet.view.at - now);
    }
    if (frame === 24) {
      initialPaddle = presentation.sample(now)?.paddles[0] ?? 0;
      inputAt = now;
      const target = presentation.aim(.7, now);
      commands.push({ due: now + oneWay, sequence: sequence++, target });
    } else if (frame > 48 && frame % 12 === 0 && state.phase !== 'finished') {
      // The player follows the last displayed ball, not the private server state.
      const seen = presentation.sample(now);
      if (seen) {
        const target = presentation.aim(seen.ball.x, now);
        commands.push({ due: now + oneWay, sequence: sequence++, target });
      }
    }
    const view = presentation.sample(now);
    if (!view) continue;
    if (frame > 24 && responseAt === null && Math.abs(view.paddles[0] - initialPaddle) > 1e-6) responseAt = now;
    if (previous && view.match === previous.match && view.phase !== 'finished') {
      maxPaddleStep = Math.max(maxPaddleStep, Math.abs(view.paddles[0] - previous.paddles[0]));
    }
    maxCorrection = Math.max(maxCorrection, presentation.correctionDistance);
    const expected = Number.isFinite(offset) ? referenceAt(history, now + offset - PONG_BUFFER_MS) : null;
    if (expected && view.phase === 'rally') { maxError = Math.max(maxError, distance(view.ball, expected)); rallySamples++; }
    previous = view;
  }
  return { responseMs: responseAt === null ? Infinity : responseAt - inputAt, maxError, maxCorrection, maxPaddleStep, rallySamples, reversals };
}

describe('authoritative Pong presentation', () => {
  it('schedules witnessed contact sound on the stable board clock despite packet jitter', () => {
    const presentation = new PongPresentation();
    const initial = pongView(startPong('contact-clock', 4, 10_000));
    expect(presentation.contactDelay(10_000, 1000)).toBe(0);
    presentation.receive(initial, 1000);
    // An additional 80 ms of transit cannot rebase the already established presentation clock.
    presentation.receive({ ...initial, tick: 3, at: 10_100 }, 1180);
    expect(presentation.contactDelay(10_100, 1180)).toBeCloseTo(.02);
    expect(presentation.contactDelay(10_100, 1200)).toBe(0);
    expect(presentation.contactDelay(10_100, 1300)).toBe(0);
    presentation.reset();
    expect(presentation.contactDelay(10_100, 1180)).toBe(0);
  });
  it.each([60, 120, 250])('moves the local paddle immediately and follows the delayed server ball at %i ms RTT', rtt => {
    const metrics = latencyRun(rtt);
    console.log(`Pong RTT ${rtt} ms: ${JSON.stringify(metrics)}`);
    expect(metrics.rallySamples).toBeGreaterThan(100);
    expect(metrics.reversals).toBeGreaterThan(0);
    expect(metrics.responseMs).toBeLessThanOrEqual(1000 / 60 + .001);
    expect(metrics.maxPaddleStep).toBeLessThanOrEqual(PONG_RULES.paddleSpeed / 60 + .001);
    expect(metrics.maxCorrection).toBeLessThanOrEqual(PONG_RULES.radius * 2 + 1e-8);
    // A bounded correction is insufficient if the accumulated path drifts well away from the server ball.
    expect(metrics.maxError).toBeLessThanOrEqual(PONG_RULES.radius * 2 + .005);
  });

  it('holds the last witnessed ball through a long packet stall, including at full speed and 30 fps', () => {
    const state = startPong('fast-stall', 3, 10_000);
    state.phase = 'rally'; state.tick = 100; state.ball = { x: 0, y: 0, vx: 0, vy: PONG_RULES.maxSpeed };
    const p = new PongPresentation();
    expect(p.receive(pongView(state), 10_000)).toBe(true);
    p.sample(10_000);
    for (let i = 1; i <= 30; i++) p.sample(10_000 + i * 1000 / 30);
    const shown = p.sample(11_000)!;
    expect(distance(shown.ball, state.ball)).toBeLessThanOrEqual(PONG_RULES.radius * 2);
  });

  it('exposes only an isolated copy of the public projection, never the seed, cursor or input target', () => {
    const state = startPong('privacy', 7654, 10_000);
    const view = pongView(state), p = new PongPresentation();
    p.receive(view, 10_000);
    state.ball.x = .7;
    (view.ball as { x: number }).x = .6;
    expect(p.latest!.ball.x).toBe(0);
    expect(Object.keys(p.latest!)).not.toContain('seed');
    expect(Object.keys(p.latest!)).not.toContain('cursor');
    expect(Object.keys(p.latest!)).not.toContain('targets');
    (p.latest!.ball as { x: number }).x = -.7;
    expect(p.latest!.ball.x).toBe(0);
    const shown = p.sample(10_016)!;
    (shown.paddles as unknown as number[])[0] = .6;
    expect(p.sample(10_032)!.paddles[0]).toBe(0);
  });

  it('bounds history and ignores stale, duplicate and old-match snapshots', () => {
    const p = new PongPresentation();
    const old = startPong('old', 9, 10_000);
    for (let i = 0; i < 90; i++) { tickPong(old); expect(p.receive(pongView(old), old.at + 30)).toBe(true); }
    expect(p.buffered).toBeLessThanOrEqual(48);
    expect(p.receive(pongView(old), old.at + 35)).toBe(false);
    const earlier = { ...pongView(old), tick: old.tick - 1, at: old.at - 1000 / 30 };
    expect(p.receive(earlier, old.at + 40)).toBe(false);
    const fresh = startPong('new', 10, 20_000);
    expect(p.receive(pongView(fresh), fresh.at + 30)).toBe(true);
    expect(p.receive(pongView(old), fresh.at + 45)).toBe(false);
    expect(p.latest?.match).toBe('new');
  });

  it('adopts an already-running seat and resets local prediction when the owned seat changes', () => {
    const p = new PongPresentation(), state = startPong('seat', 1, 10_000);
    state.paddles = [.5, -.5];
    p.receive(pongView(state), 10_000);
    p.setSeat(0);
    expect(p.sample(10_000)!.paddles[0]).toBeCloseTo(.5);
    p.aim(.79, 10_000); p.sample(10_100);
    p.setSeat(1);
    expect(p.sample(10_100)!.paddles[1]).toBeCloseTo(-.5);
    expect(p.aimPosition).toBeCloseTo(-.5);
    p.reset(); expect(p.sample(10_200)).toBeNull();
  });

  it('displays a same-tick server concession and an interruption without inventing a winner', () => {
    const p = new PongPresentation(), state = startPong('ending', 1, 10_000);
    state.phase = 'rally'; state.tick = 50;
    const ongoing = pongView(state);
    expect(p.receive(ongoing, 10_000)).toBe(true);
    p.setSeat(1); p.aim(.79, 10_000); p.sample(10_100);
    const ended: PongView = { ...ongoing, phase: 'finished', winner: 1, reason: 'conceded', ball: { ...ongoing.ball, vx: 0, vy: 0 } };
    expect(p.receive(ended, 10_010)).toBe(true);
    expect(p.sample(10_010)).toMatchObject({ phase: 'finished', winner: 1, reason: 'conceded' });
    p.aim(-.79, 10_020);
    expect(p.sample(10_030)!.paddles).toEqual(ended.paddles);
    const interrupted: PongView = { ...ended, match: 'next', at: 20_000, tick: 1, phase: 'interrupted', winner: null, reason: 'restart' };
    expect(p.receive(interrupted, 20_010)).toBe(true);
    expect(p.sample(20_010)).toMatchObject({ phase: 'interrupted', winner: null, reason: 'restart' });
    p.aim(.79, 20_020);
    expect(p.sample(20_030)!.paddles).toEqual(interrupted.paddles);
  });

  it('clamps non-finite and out-of-range paddle input without admitting NaN to the view', () => {
    const p = new PongPresentation(), state = startPong('clamp', 1, 10_000);
    p.setSeat(0); p.receive(pongView(state), 10_000); p.sample(10_000);
    expect(p.aim(999, 10_001)).toBeCloseTo(clampPongPaddle(999));
    expect(p.aim(Number.NaN, 10_002)).toBeCloseTo(clampPongPaddle(999));
    for (let i = 1; i <= 60; i++) p.sample(10_000 + i * 1000 / 60);
    expect(p.sample(11_000)!.paddles[0]).toBeCloseTo(1 - PONG_RULES.paddleHalf);
  });

  it('accepts a real fixed-step frame in the browser wire schema', () => {
    const state = startPong('wire', 1, 10_000);
    tickPong(state);
    const parsed = GatherFrameSchema.safeParse({ at: Math.round(state.at), tables: [{ table: 'west', revision: 1,
      seats: ['First', 'Second'], pong: pongView(state) }] });
    expect(parsed.success).toBe(true);
  });

  it('presents a scored point as a new serve without inventing an in-flight crossing', () => {
    const p = new PongPresentation(), state = startPong('score', 1, 10_000);
    state.phase = 'rally'; state.tick = 10; state.ball = { x: .4, y: 1.58, vx: 0, vy: 1.8 };
    p.receive(pongView(state), 10_000);
    tickPong(state);
    expect(state.phase).toBe('serve');
    expect(state.score).toEqual([0, 1]);
    p.receive(pongView(state), state.at);
    const shown = p.sample(state.at + PONG_BUFFER_MS + 5)!;
    expect(shown.phase).toBe('serve');
    expect(shown.score).toEqual([0, 1]);
    expect(shown.ball).toEqual({ x: 0, y: 0, vx: 0, vy: 0 });
  });
});
