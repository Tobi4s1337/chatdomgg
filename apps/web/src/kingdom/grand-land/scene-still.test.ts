import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSceneStills } from './scene-still';

function fakeCanvas() {
  const draws: number[][] = [];
  const canvas = {
    width: 0, height: 0, draws, encoded: [] as [string, number][],
    getContext: () => ({ drawImage: (_: unknown, x: number, y: number, w: number, h: number) => { draws.push([x, y, w, h]); } }),
    toBlob(callback: (blob: Blob | null) => void, type: string, quality: number) { canvas.encoded.push([type, quality]); callback(new Blob(['x'], { type })); },
  };
  return canvas;
}

describe('scene stills', () => {
  afterEach(() => { vi.useRealTimers(); });
  const source = { width: 1920, height: 1080 } as HTMLCanvasElement;

  it('answers from the next drawn frame, scaled to the asked width with the canvas aspect', async () => {
    const requestDraw = vi.fn(), copies: ReturnType<typeof fakeCanvas>[] = [];
    const stills = createSceneStills(source, { requestDraw, createCanvas: () => { const c = fakeCanvas(); copies.push(c); return c as never; } });
    const pending = stills.still(636);
    expect(requestDraw).toHaveBeenCalledOnce();
    expect(stills.waiting).toBe(1);
    stills.drawn();
    const blob = await pending;
    expect(blob.type).toBe('image/webp');
    expect(copies[0]!.draws).toEqual([[0, 0, 636, 358]]);
    expect(copies[0]!.encoded).toEqual([['image/webp', .85]]);
    expect(stills.waiting).toBe(0);
  });

  it('never upscales, refuses bad requests and rejects on close or when no frame is drawn', async () => {
    vi.useFakeTimers();
    const copies: ReturnType<typeof fakeCanvas>[] = [];
    const stills = createSceneStills(source, { requestDraw: () => {}, timeoutMs: 1000, createCanvas: () => { const c = fakeCanvas(); copies.push(c); return c as never; } });
    const big = stills.still(4000, { type: 'image/jpeg', quality: .5 });
    stills.drawn();
    await big;
    expect(copies[0]!.draws[0]).toEqual([0, 0, 1920, 1080]);
    await expect(stills.still(4)).rejects.toThrow(RangeError);
    await expect(stills.still(300, { quality: 2 })).rejects.toThrow(RangeError);
    const late = stills.still(300);
    vi.advanceTimersByTime(1001);
    await expect(late).rejects.toThrow('no frame');
    const closing = stills.still(300);
    stills.dispose();
    await expect(closing).rejects.toThrow('closed');
    await expect(stills.still(300)).rejects.toThrow('closed');
  });
});
