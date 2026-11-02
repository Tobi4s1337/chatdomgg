import { GATHER_HZ, PONG_RULES, type PongView, type PongContact } from '@chatdom/shared';

/** Logical tabletop metres; paddle zero is on the near (+Y) end. */
export const PONG = PONG_RULES;
export type PongSeat = 0 | 1;
export interface PongState {
  match: string; phase: PongView['phase']; tick: number; at: number; serveAt: number;
  ball: { x: number; y: number; vx: number; vy: number };
  paddles: [number, number]; targets: [number, number]; acknowledged: [number, number];
  score: [number, number]; winner: PongSeat | null; reason: PongView['reason'];
  /** Server-only serve sequence, never part of a view. */
  seed: number; cursor: number; serveTo: PongSeat;
  contacts?: PongContact[];
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function clampPaddle(n: number): number { return clamp(n, -1 + PONG.paddleHalf, 1 - PONG.paddleHalf); }
export function movePaddle(current: number, target: number, dt: number): number {
  return clampPaddle(current + clamp(clampPaddle(target) - current, -PONG.paddleSpeed * dt, PONG.paddleSpeed * dt));
}
function random(state: PongState): number {
  // Counter mixing: seed and cursor persist together. No ambient randomness in game rules.
  let n = (state.seed + Math.imul(++state.cursor, 0x9e3779b9)) | 0;
  n = Math.imul(n ^ n >>> 16, 0x21f0aaad); n = Math.imul(n ^ n >>> 15, 0x735a2d97);
  return ((n ^ n >>> 15) >>> 0) / 0x1_0000_0000;
}
export function startPong(match: string, seed: number, now: number): PongState {
  return { match, phase: 'serve', tick: 0, at: now, serveAt: now + PONG.serveMs,
    ball: { x: 0, y: 0, vx: 0, vy: 0 }, paddles: [0, 0], targets: [0, 0], acknowledged: [-1, -1],
    score: [0, 0], winner: null, reason: null, seed: seed >>> 0, cursor: 0, serveTo: 0, contacts: [] };
}
/** Inputs are ordered per seat, not per socket: replaying after a reconnect cannot move a paddle backwards. */
export function inputPong(state: PongState, seat: PongSeat, sequence: number, paddle: number): boolean {
  if (state.phase === 'finished' || state.phase === 'interrupted' || !Number.isInteger(sequence)
    || sequence < 0 || sequence > 0xffff_ffff || sequence <= state.acknowledged[seat]
    || !Number.isFinite(paddle) || Math.abs(paddle) > 1) return false;
  state.acknowledged[seat] = sequence; state.targets[seat] = clampPaddle(paddle); return true;
}
export function concedePong(state: PongState, seat: PongSeat): void {
  if (state.phase === 'finished' || state.phase === 'interrupted') return;
  state.phase = 'finished'; state.winner = seat === 0 ? 1 : 0; state.reason = 'conceded';
  state.ball.vx = 0; state.ball.vy = 0;
}
export function interruptPong(state: PongState): void {
  if (state.phase === 'finished' || state.phase === 'interrupted') return;
  state.phase = 'interrupted'; state.winner = null; state.reason = 'restart'; state.ball.vx = 0; state.ball.vy = 0;
}
/** One fixed authoritative step. The host owns the clock and calls exactly once per 1/30 s. */
export function tickPong(state: PongState): void {
  if (state.phase === 'finished' || state.phase === 'interrupted') return;
  state.tick++; state.at += 1000 / GATHER_HZ;
  for (const seat of [0, 1] as const) state.paddles[seat] = movePaddle(state.paddles[seat], state.targets[seat], PONG.step);
  if (state.phase === 'serve') {
    if (state.at < state.serveAt) return;
    const angle = (random(state) * 2 - 1) * .5;
    state.ball.vx = Math.sin(angle) * PONG.startSpeed;
    state.ball.vy = Math.cos(angle) * PONG.startSpeed * (state.serveTo === 0 ? 1 : -1);
    state.phase = 'rally';
  }
  const ball = state.ball;
  // Swept impacts consume the remaining fraction of a step, so a fast ball cannot tunnel through a paddle.
  let left = PONG.step;
  for (let impacts = 0; left > 1e-9 && impacts < 4; impacts++) {
    const wall = ball.vx > 0 ? (1 - PONG.radius - ball.x) / ball.vx
      : ball.vx < 0 ? (-1 + PONG.radius - ball.x) / ball.vx : Infinity;
    const seat: PongSeat = ball.vy > 0 ? 0 : 1;
    const plane = (seat === 0 ? 1 : -1) * (PONG.paddleY - PONG.radius);
    const paddleTime = ball.vy !== 0 ? (plane - ball.y) / ball.vy : Infinity;
    const paddleX = ball.x + ball.vx * paddleTime;
    const hit = paddleTime >= -1e-9 && Math.abs(paddleX - state.paddles[seat]) <= PONG.paddleHalf + PONG.radius;
    const paddle = hit ? Math.max(0, paddleTime) : Infinity;
    const duration = Math.min(left, Math.max(0, wall), paddle);
    ball.x += ball.vx * duration; ball.y += ball.vy * duration; left -= duration;
    if (paddle <= duration && paddle <= wall) {
      contact(state, 'paddle', left);
      const offset = clamp((ball.x - state.paddles[seat]) / (PONG.paddleHalf + PONG.radius), -1, 1);
      const speed = Math.min(PONG.maxSpeed, Math.hypot(ball.vx, ball.vy) * 1.075);
      ball.vx = Math.sin(offset * .95) * speed; ball.vy = Math.cos(offset * .95) * speed * (seat === 0 ? -1 : 1);
    } else if (wall <= duration) { contact(state, 'rail', left); ball.vx *= -1; }
    else break;
  }
  if (Math.abs(ball.y) > PONG.paddleY + .25) {
    const scorer: PongSeat = ball.y > 0 ? 1 : 0;
    state.score[scorer]++;
    state.serveTo = scorer === 0 ? 1 : 0;
    if (state.score[scorer] >= PONG.winningScore) {
      state.phase = 'finished'; state.winner = scorer; state.reason = 'points'; ball.vx = 0; ball.vy = 0;
    } else {
      state.phase = 'serve'; state.serveAt = state.at + PONG.serveMs;
      ball.x = 0; ball.y = 0; ball.vx = 0; ball.vy = 0;
    }
  }
}
function contact(state: PongState, kind: PongContact['kind'], remaining: number): void {
  const contacts = state.contacts ??= [];
  contacts.push({ sequence: (contacts.at(-1)?.sequence ?? 0) + 1, tick: state.tick,
    at: Math.round(state.at - remaining * 1000), kind, x: state.ball.x, y: state.ball.y });
  if (contacts.length > 8) contacts.shift();
}
/** Explicit public projection: never spread the authoritative state into a message or log. */
export function pongView(state: PongState): PongView {
  return { match: state.match, phase: state.phase, tick: state.tick, at: Math.round(state.at), serveAt: Math.round(state.serveAt),
    ball: { ...state.ball }, paddles: [...state.paddles], acknowledged: [...state.acknowledged],
    score: [...state.score], winner: state.winner, reason: state.reason,
    ...(state.contacts ? { contacts: state.contacts.map(hit => ({ ...hit })) } : {}) };
}
