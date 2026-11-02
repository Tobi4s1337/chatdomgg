// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BakeMessage, BakeReply, InitMessage } from './bake.worker';
import type { PaintScene } from './paint';
import { tileKey, type TileKey } from './pyramid';
import { BAKE_DEADLINE_MS, MAX_RESPAWNS, READY_DEADLINE_MS, RETRY_MS, TileFarm, type Baker, type FarmClock, type FarmOptions, type TileImage } from './tiles';

class FakeClock implements FarmClock {
  time = 0;
  private timers: { at: number; run: () => void; handle: number }[] = [];
  private nextHandle = 1;
  now(): number {
    return this.time;
  }
  set(run: () => void, ms: number): number {
    const handle = this.nextHandle++;
    this.timers.push({ at: this.time + ms, run, handle });
    return handle;
  }
  clear(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.handle !== handle);
  }
  /** Moves time forward, running every timer that falls due on the way, in order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.handle - b.handle)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = Math.max(this.time, due.at);
      due.run();
    }
    this.time = end;
  }
}

class FakeBaker implements Baker {
  onmessage: ((event: MessageEvent<BakeReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: (InitMessage | BakeMessage)[] = [];
  terminated = false;
  /** A silent baker never says it is ready (a stamp sheet that never arrives); others say so at once. */
  constructor(private readonly silent = false) {}
  postMessage(message: InitMessage | BakeMessage): void {
    this.posted.push(message);
    if (message.type === 'init' && !this.silent) this.ready();
  }
  ready(): void {
    this.onmessage?.({ data: { type: 'ready' } } as MessageEvent<BakeReply>);
  }
  terminate(): void {
    this.terminated = true;
  }
  get bakes(): BakeMessage[] {
    return this.posted.filter((message): message is BakeMessage => message.type === 'bake');
  }
  /** Answers the latest bake request. */
  answer(ok: boolean): { closed: boolean } {
    const job = this.bakes.at(-1)!;
    const bitmap = { closed: false, close() { this.closed = true; } };
    const reply: BakeReply = ok ? { type: 'baked', id: job.id, bitmap: bitmap as unknown as ImageBitmap } : { type: 'failed', id: job.id, message: 'no ink' };
    this.onmessage?.({ data: reply } as MessageEvent<BakeReply>);
    return bitmap;
  }
  crash(): void {
    this.onerror?.({} as ErrorEvent);
  }
}

const key = (tx: number): TileKey => ({ level: 4, tx, ty: 2 });
const SCENE = {} as Omit<PaintScene, 'stamps'>;

function farm(options: Partial<FarmOptions> = {}, silent = () => false) {
  const clock = new FakeClock();
  const bakers: FakeBaker[] = [];
  const mainBakes: string[] = [];
  const result = new TileFarm(SCENE, '/stamps.png', [], async () => null, 2, {
    clock,
    workers: 1,
    spawn: () => {
      const baker = new FakeBaker(silent());
      bakers.push(baker);
      return baker;
    },
    bakeOnMain: async () => (tile) => {
      mainBakes.push(tileKey(tile));
      return { width: 1, height: 1 } as HTMLCanvasElement;
    },
    ...options,
  });
  const baked: string[] = [];
  const failed: string[] = [];
  result.onBaked = (tile: TileKey, image: TileImage) => {
    void image;
    baked.push(tileKey(tile));
  };
  result.onFailed = (tile) => failed.push(tileKey(tile));
  const requested = () => bakers.flatMap((baker) => baker.bakes.map((message) => tileKey(message.key)));
  return { farm: result, clock, bakers, baked, failed, requested, mainBakes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TileFarm', () => {
  it('bakes the most wanted tile first and drops wishes that went stale', () => {
    const { farm: f, bakers, baked, requested } = farm();
    // No baker is started until a tile is wanted (a map seeded with the still's land may never need one).
    f.want([]);
    expect(bakers).toHaveLength(0);
    f.want([key(1), key(2), key(3)]);
    expect(bakers[0]!.posted[0]!.type).toBe('init');
    expect(requested()).toEqual(['4/1/2']);
    f.want([key(3), key(1)]); // key(2) is no longer on screen; key(1) is already being baked
    bakers[0]!.answer(true);
    expect(baked).toEqual(['4/1/2']);
    expect(requested()).toEqual(['4/1/2', '4/3/2']);
  });

  it('retries a failed tile after 1.5 s and 6 s, then gives it up once, without a storm in between', () => {
    const { farm: f, clock, bakers, failed, requested } = farm();
    expect(RETRY_MS).toEqual([1500, 6000]);
    f.want([key(1), key(2)]);
    bakers[0]!.answer(false);
    // The other tile goes on baking while the failed one waits.
    expect(requested()).toEqual(['4/1/2', '4/2/2']);
    bakers[0]!.answer(true);
    for (let t = 0; t < 1490; t += 10) {
      f.want([key(1)]); // the layer asks every frame
      clock.advance(10);
    }
    expect(requested()).toHaveLength(2);
    clock.advance(10);
    expect(requested()).toEqual(['4/1/2', '4/2/2', '4/1/2']);
    bakers[0]!.answer(false);
    f.want([key(1)]);
    clock.advance(5999);
    expect(requested()).toHaveLength(3);
    clock.advance(1);
    expect(requested()).toHaveLength(4);
    expect(failed).toEqual([]);
    bakers[0]!.answer(false);
    expect(failed).toEqual(['4/1/2']);
    clock.advance(60_000);
    expect(requested()).toHaveLength(4);
    // Asked again later (the layer's retry), it gets a fresh round.
    f.want([key(1)]);
    expect(requested()).toHaveLength(5);
  });

  it('fails the tile of a crashed worker, replaces the worker, and retries the tile there', () => {
    const { farm: f, clock, bakers, requested } = farm();
    f.want([key(1)]);
    bakers[0]!.crash();
    expect(bakers[0]!.terminated).toBe(true);
    expect(bakers).toHaveLength(2);
    expect(bakers[1]!.posted[0]!.type).toBe('init');
    expect(bakers[1]!.bakes).toEqual([]);
    clock.advance(RETRY_MS[0]);
    expect(bakers[1]!.bakes.map((message) => tileKey(message.key))).toEqual(['4/1/2']);
    expect(requested()).toHaveLength(2);
  });

  it('hands baking to the main thread once workers have crashed more than MAX_RESPAWNS times', async () => {
    const { farm: f, clock, bakers, baked, mainBakes } = farm();
    f.want([key(1), key(2), key(3), key(4), key(5)]);
    for (let i = 0; i <= MAX_RESPAWNS; i++) bakers.at(-1)!.crash();
    expect(bakers).toHaveLength(1 + MAX_RESPAWNS);
    await settle();
    clock.advance(0);
    clock.advance(0);
    expect(mainBakes).toEqual(['4/5/2']);
    expect(baked).toEqual(['4/5/2']);
    // The four crashed tiles come back after their backoff, still one per tick.
    clock.advance(RETRY_MS[0]);
    for (let i = 0; i < 6; i++) clock.advance(0);
    expect(mainBakes.slice(1).sort()).toEqual(['4/1/2', '4/2/2', '4/3/2', '4/4/2']);
  });

  it('falls back to the main thread when no worker can start at all', async () => {
    const { farm: f, clock, baked } = farm({
      spawn: () => {
        throw new Error('blocked');
      },
    });
    f.want([key(7)]);
    await settle();
    clock.advance(0);
    expect(baked).toEqual(['4/7/2']);
  });

  it('fails only the tile whose reply could not be read, and keeps the worker', () => {
    const { farm: f, bakers, requested } = farm();
    f.want([key(1), key(2)]);
    bakers[0]!.onmessageerror?.({} as MessageEvent);
    expect(bakers[0]!.terminated).toBe(false);
    expect(requested()).toEqual(['4/1/2', '4/2/2']);
  });

  it('replaces a worker that hangs on a bake, retries its tile, and ignores the hung reply', () => {
    const { farm: f, clock, bakers, baked, requested } = farm();
    f.want([key(1)]);
    clock.advance(BAKE_DEADLINE_MS - 1);
    expect(bakers).toHaveLength(1);
    clock.advance(1);
    expect(bakers[0]!.terminated).toBe(true);
    expect(bakers).toHaveLength(2);
    clock.advance(RETRY_MS[0]);
    expect(bakers[1]!.bakes.map((message) => tileKey(message.key))).toEqual(['4/1/2']);
    // The hung worker wakes up after all: its bitmap is freed, not drawn.
    const late = bakers[0]!.answer(true);
    expect(late.closed).toBe(true);
    bakers[1]!.answer(true);
    expect(baked).toEqual(['4/1/2']);
    expect(requested()).toHaveLength(2);
  });

  it('never times out an idle worker or one that answers in time', () => {
    const { farm: f, clock, bakers, baked } = farm();
    clock.advance(10 * READY_DEADLINE_MS);
    f.want([key(1), key(2)]);
    clock.advance(BAKE_DEADLINE_MS - 1);
    bakers[0]!.answer(true);
    clock.advance(BAKE_DEADLINE_MS - 1);
    bakers[0]!.answer(true);
    clock.advance(10 * READY_DEADLINE_MS);
    expect(bakers).toHaveLength(1);
    expect(bakers[0]!.terminated).toBe(false);
    expect(baked).toEqual(['4/1/2', '4/2/2']);
  });

  it('bakes a tile once even though every frame still asks for it while it bakes', () => {
    const { farm: f, clock, bakers, baked } = farm();
    f.want([key(1), key(2)]);
    clock.advance(16);
    // The next frame asks again: neither tile is in the cache yet.
    f.want([key(1), key(2)]);
    bakers[0]!.answer(true);
    clock.advance(16);
    f.want([key(2)]);
    bakers[0]!.answer(true);
    expect(baked).toEqual(['4/1/2', '4/2/2']);
    expect(bakers[0]!.bakes.map((bake) => tileKey(bake.key))).toEqual(['4/1/2', '4/2/2']);
  });

  it('gives a worker READY_DEADLINE_MS to get ready, and a waiting bake its full deadline from then', () => {
    let quiet = true;
    const { farm: f, clock, bakers, baked } = farm({}, () => quiet);
    f.want([key(1)]);
    clock.advance(READY_DEADLINE_MS - 1);
    expect(bakers[0]!.terminated).toBe(false);
    bakers[0]!.ready();
    clock.advance(BAKE_DEADLINE_MS - 1);
    expect(bakers[0]!.terminated).toBe(false);
    clock.advance(1);
    expect(bakers[0]!.terminated).toBe(true);
    // A replacement that never gets ready is caught too.
    expect(bakers).toHaveLength(2);
    // The next replacement is healthy: it says ready at once and, idle, is never timed out.
    quiet = false;
    clock.advance(READY_DEADLINE_MS);
    expect(bakers[1]!.terminated).toBe(true);
    expect(bakers).toHaveLength(3);
    // It bakes the retried tile in time and then sits idle past every deadline.
    for (let t = 0; t < READY_DEADLINE_MS + BAKE_DEADLINE_MS; t += 250) {
      f.want(baked.length ? [] : [key(1)]);
      if (bakers[2]!.bakes.length && !baked.length) bakers[2]!.answer(true);
      clock.advance(250);
    }
    expect(baked).toEqual(['4/1/2']);
    expect(bakers[2]!.terminated).toBe(false);
    expect(bakers).toHaveLength(3);
  });

  it('hands baking to the main thread when workers keep hanging', async () => {
    const { farm: f, clock, bakers, baked, mainBakes } = farm();
    // The layer asks every frame; no worker ever answers.
    for (let t = 0; t < 4 * (BAKE_DEADLINE_MS + RETRY_MS[1]); t += 250) {
      f.want([key(1)]);
      clock.advance(250);
    }
    expect(bakers).toHaveLength(1 + MAX_RESPAWNS);
    expect(bakers.every((baker) => baker.terminated)).toBe(true);
    expect(mainBakes).toEqual([]);
    await settle();
    for (let t = 0; t < RETRY_MS[1] && !baked.length; t += 250) {
      f.want([key(1)]);
      clock.advance(250);
    }
    expect(mainBakes).toEqual(['4/1/2']);
    expect(baked).toEqual(['4/1/2']);
  });

  it('closes bitmaps that arrive for nobody', () => {
    const { farm: f, bakers, baked } = farm();
    f.want([key(1)]);
    f.dispose();
    expect(bakers[0]!.terminated).toBe(true);
    const late = bakers[0]!.answer(true);
    expect(late.closed).toBe(true);
    expect(baked).toEqual([]);
  });
});
