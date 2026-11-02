/**
 * GPU time of whole frames from EXT_disjoint_timer_query_webgl2, for the quality governor. One TIME_ELAPSED query
 * spans a frame's passes (reflection, shadow update, scene, post); results arrive a few frames later and are read
 * without stalling. A frame the GPU reports disjoint (power state change, context switch) is dropped. Browsers
 * without the extension, or that coarsen it, give `null`, and the governor falls back to frame intervals.
 */
export interface GpuFrameTimer {
  readonly supported: boolean;
  begin(): void;
  end(): void;
  /** The newest finished frame's GPU milliseconds, once; null when none finished since the last call. */
  take(): number | null;
  dispose(): void;
}

/** At most this many frames in flight; a GPU further behind than that skips timing frames rather than queueing. */
const IN_FLIGHT = 4;
/** A query with no result after this many frames (a lost or set-aside query) is given up. */
const GIVE_UP = 60;

export function createGpuFrameTimer(gl: WebGL2RenderingContext | WebGLRenderingContext): GpuFrameTimer {
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl : null;
  const ext = webgl2?.getExtension('EXT_disjoint_timer_query_webgl2') as
    { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number } | null | undefined;
  if (!webgl2 || !ext) return { supported: false, begin() {}, end() {}, take: () => null, dispose() {} };
  const pending: { readonly query: WebGLQuery; readonly frame: number }[] = [];
  let active: WebGLQuery | null = null, latest: number | null = null, frame = 0;
  return {
    supported: true,
    begin() {
      frame++;
      while (pending.length && frame - pending[0]!.frame > GIVE_UP) webgl2.deleteQuery(pending.shift()!.query);
      if (active || pending.length >= IN_FLIGHT) return;
      // Another owner's timer (a profiler) may hold the target; never fight it.
      if (webgl2.getQuery(ext.TIME_ELAPSED_EXT, webgl2.CURRENT_QUERY)) return;
      const query = webgl2.createQuery();
      if (!query) return;
      webgl2.beginQuery(ext.TIME_ELAPSED_EXT, query);
      active = query;
    },
    end() {
      if (!active) return;
      webgl2.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push({ query: active, frame }); active = null;
    },
    take() {
      const disjoint = !!webgl2.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length) {
        const { query } = pending[0]!;
        if (!webgl2.getQueryParameter(query, webgl2.QUERY_RESULT_AVAILABLE)) break;
        const ns = webgl2.getQueryParameter(query, webgl2.QUERY_RESULT) as number;
        pending.shift(); webgl2.deleteQuery(query);
        if (!disjoint) latest = ns / 1e6;
      }
      if (disjoint) { for (const item of pending) webgl2.deleteQuery(item.query); pending.length = 0; latest = null; }
      const result = latest; latest = null;
      return result;
    },
    dispose() {
      if (active) { webgl2.endQuery(ext.TIME_ELAPSED_EXT); webgl2.deleteQuery(active); active = null; }
      for (const item of pending) webgl2.deleteQuery(item.query);
      pending.length = 0;
    },
  };
}
