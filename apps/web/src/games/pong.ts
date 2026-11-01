import { PONG_RULES as FIELD, type PongView } from '@chatdom/shared';

export const PONG_BUFFER_MS = 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const clampPongPaddle = (n: number) => clamp(n, -FIELD.halfWidth + FIELD.paddleHalf, FIELD.halfWidth - FIELD.paddleHalf);
const move = (from: number, to: number, dt: number) => from + clamp(to - from, -FIELD.paddleSpeed * dt, FIELD.paddleSpeed * dt);
const copy = (view: PongView): PongView => ({ ...view, ball: { ...view.ball }, paddles: [...view.paddles], acknowledged: [...view.acknowledged], score: [...view.score] });
interface Frame { readonly view: PongView; readonly received: number }

/** Public snapshots only. This never decides a bounce, score or result. */
export class PongPresentation {
  private frames: Frame[] = [];
  private seat: 0 | 1 | null = null;
  private target = 0;
  private local = 0;
  private lastAt: number | null = null;
  private last: PongView | null = null;
  private clockOffset = -Infinity;
  private localInputAt = -Infinity;
  private initialized = false;
  private correction = 0;
  private retired: string[] = [];

  get latest(): PongView | null { const view = this.frames.at(-1)?.view; return view ? copy(view) : null; }
  get buffered(): number { return this.frames.length; }
  /** Last correction component, distinct from normal travel during the rendered frame. */
  get correctionDistance(): number { return this.correction; }
  setSeat(seat: 0 | 1 | null): void {
    if (this.seat === seat) return;
    this.seat = seat; this.initialized = false;
    const latest = this.latest;
    if (seat !== null && latest) { this.local = this.target = latest.paddles[seat]; this.initialized = true; }
  }
  receive(view: PongView, receivedAt: number): boolean {
    if (!Number.isFinite(receivedAt)) return false;
    const latest = this.latest;
    if (this.retired.includes(view.match)) return false;
    if (latest?.match === view.match && (view.tick < latest.tick || view.tick === latest.tick
      && !(latest.phase !== 'finished' && latest.phase !== 'interrupted' && (view.phase === 'finished' || view.phase === 'interrupted')))) return false;
    if (latest?.match !== view.match) {
      if (latest && view.at < latest.at - 1000) return false;
      if (latest) { this.retired.push(latest.match); if (this.retired.length > 8) this.retired.shift(); }
      this.frames = []; this.last = null; this.lastAt = null; this.clockOffset = -Infinity; this.initialized = false;
    }
    this.frames.push({ view: copy(view), received: receivedAt });
    if (this.frames.length > 48) this.frames.shift();
    // Lowest observed transit time is the stable clock baseline. Jitter changes the buffer, never the path.
    this.clockOffset = Math.max(this.clockOffset, view.at - receivedAt);
    if (!this.initialized && this.seat !== null) {
      this.local = view.paddles[this.seat]; this.target = this.local; this.initialized = true;
    }
    return true;
  }
  aim(value: number, now: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(now)) return this.target;
    this.target = clampPongPaddle(value); this.localInputAt = now; return this.target;
  }
  get aimPosition(): number { return this.target; }
  reset(): void {
    this.frames = []; this.last = null; this.lastAt = null; this.clockOffset = -Infinity; this.initialized = false; this.correction = 0; this.retired = [];
  }
  sample(now: number): PongView | null {
    const latest = this.latest;
    if (!latest || !Number.isFinite(now)) return null;
    const dt = this.lastAt === null ? 0 : clamp((now - this.lastAt) / 1000, 0, .1);
    this.lastAt = now;
    if (latest.phase === 'finished' || latest.phase === 'interrupted') {
      this.correction = 0;
      if (this.seat !== null) this.local = this.target = latest.paddles[this.seat];
      this.last = copy(latest); return copy(latest);
    }
    const at = now + this.clockOffset - PONG_BUFFER_MS;
    let before = this.frames[0]!.view, after = before;
    for (const frame of this.frames) {
      if (frame.view.at > at) { after = frame.view; break; }
      before = after = frame.view;
    }
    // Scores and serve resets are witnessed phase changes, never interpolated across a tabletop.
    const samePath = before.phase === 'rally' && after.phase === 'rally'
      && before.score[0] === after.score[0] && before.score[1] === after.score[1];
    const ratio = after.at === before.at ? 0 : clamp((at - before.at) / (after.at - before.at), 0, 1);
    let ball = { ...before.ball };
    if (samePath) ball = { x: before.ball.x + (after.ball.x - before.ball.x) * ratio,
      y: before.ball.y + (after.ball.y - before.ball.y) * ratio,
      vx: before.ball.vx + (after.ball.vx - before.ball.vx) * ratio, vy: before.ball.vy + (after.ball.vy - before.ball.vy) * ratio };
    this.correction = 0;
    const previous = this.last;
    if (samePath && previous?.phase === 'rally' && previous.score[0] === before.score[0] && previous.score[1] === before.score[1]) {
      // Without a following witness there is no path to extrapolate: hold, including under a long outage.
      const travel = before === after ? 0 : dt;
      let x = previous.ball.x + previous.ball.vx * travel;
      const edge = FIELD.halfWidth - FIELD.radius;
      if (x > edge) x = 2 * edge - x;
      if (x < -edge) x = -2 * edge - x;
      const y = previous.ball.y + previous.ball.vy * travel;
      const dx = ball.x - x, dy = ball.y - y, distance = Math.hypot(dx, dy);
      const amount = Math.min(1, FIELD.radius * 2 / Math.max(1e-9, distance));
      this.correction = distance * amount;
      ball = { ...ball, x: clamp(x + dx * amount, -edge, edge), y: y + dy * amount };
    }
    const paddles: [number, number] = [before.paddles[0] + (after.paddles[0] - before.paddles[0]) * ratio,
      before.paddles[1] + (after.paddles[1] - before.paddles[1]) * ratio];
    if (this.seat !== null) {
      // The hand moves locally on this frame. Authority eventually agrees at the same bounded target.
      this.local = move(this.local, this.target, dt);
      if (now - this.localInputAt > 500 && latest.phase !== 'rally' && latest.phase !== 'serve') this.local = latest.paddles[this.seat];
      paddles[this.seat] = this.local;
    }
    const result = { ...before, ball,
      paddles, acknowledged: [...latest.acknowledged] as [number, number] };
    this.last = result; return copy(result);
  }
}
