import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGpuFrameTimer } from './gpu-timer';

const TIME_ELAPSED = 0x88bf, DISJOINT = 0x8fbb, AVAILABLE = 0x8867, RESULT = 0x8866, CURRENT = 0x8865;

/** A WebGL2 context with only the query calls, whose GPU finishes each query `lag` takes after it ends. */
function fakeContext(options: { extension?: boolean; lag?: number } = {}) {
  class Fake {
    readonly QUERY_RESULT_AVAILABLE = AVAILABLE; readonly QUERY_RESULT = RESULT; readonly CURRENT_QUERY = CURRENT;
    open: object | null = null; disjoint = false; ended: { query: object; ns: number; age: number }[] = []; deleted = 0; nextNs = 4e6;
    getExtension(name: string) { return options.extension === false || name !== 'EXT_disjoint_timer_query_webgl2' ? null : { TIME_ELAPSED_EXT: TIME_ELAPSED, GPU_DISJOINT_EXT: DISJOINT }; }
    createQuery() { return {}; }
    deleteQuery() { this.deleted++; }
    getQuery() { return this.open; }
    beginQuery(_target: number, query: object) { if (this.open) throw new Error('a query is already open'); this.open = query; }
    endQuery() { this.ended.push({ query: this.open!, ns: this.nextNs, age: 0 }); this.open = null; }
    getParameter(name: number) { return name === DISJOINT ? this.disjoint : null; }
    getQueryParameter(query: object, name: number) {
      const item = this.ended.find(entry => entry.query === query)!;
      return name === AVAILABLE ? item.age >= (options.lag ?? 2) : item.ns;
    }
    tick() { for (const item of this.ended) item.age++; }
  }
  vi.stubGlobal('WebGL2RenderingContext', Fake);
  return new Fake();
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('the GPU frame timer', () => {
  it('reads each frame a few frames later without stalling', () => {
    const gl = fakeContext({ lag: 2 }), timer = createGpuFrameTimer(gl as unknown as WebGL2RenderingContext);
    expect(timer.supported).toBe(true);
    const results: (number | null)[] = [];
    for (let frame = 0; frame < 6; frame++) { timer.begin(); timer.end(); gl.tick(); results.push(timer.take()); }
    expect(results).toEqual([null, 4, 4, 4, 4, 4]);
  });

  it('drops frames the GPU reports disjoint', () => {
    const gl = fakeContext({ lag: 0 }), timer = createGpuFrameTimer(gl as unknown as WebGL2RenderingContext);
    timer.begin(); timer.end(); gl.disjoint = true;
    expect(timer.take()).toBeNull();
    gl.disjoint = false; timer.begin(); timer.end();
    expect(timer.take()).toBe(4);
  });

  it('never opens a query while another owner holds the target, and gives up results that never come', () => {
    const gl = fakeContext({ lag: 1e9 }), timer = createGpuFrameTimer(gl as unknown as WebGL2RenderingContext);
    gl.open = {};
    timer.begin(); timer.end();
    expect(gl.ended).toHaveLength(0);
    gl.open = null;
    for (let frame = 0; frame < 100; frame++) { timer.begin(); timer.end(); gl.tick(); expect(timer.take()).toBeNull(); }
    // Four in flight at most; the stale ones were released rather than kept forever.
    expect(gl.deleted).toBeGreaterThan(0);
    timer.dispose();
    expect(gl.deleted).toBe(gl.ended.length);
  });

  it('reports unsupported without the extension, and does nothing', () => {
    const gl = fakeContext({ extension: false }), timer = createGpuFrameTimer(gl as unknown as WebGL2RenderingContext);
    expect(timer.supported).toBe(false);
    timer.begin(); timer.end();
    expect(timer.take()).toBeNull();
    expect(gl.ended).toHaveLength(0);
  });
});
