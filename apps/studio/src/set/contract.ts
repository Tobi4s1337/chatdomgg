// What every set piece gives the recorder. A set piece is a module under src/set/ that exports
// `start(query, canvas)`; `main.ts` picks it from `?scene=`. Each one stages product modules (read-only imports)
// and computes every pose and event from its own shot time t, where t is virtual seconds since the scene said it
// was ready (plus `?from=`). Nothing reads the wall clock.
declare global {
  interface Window {
    __set?: SetHandle;
    __chatdomReady?: boolean;
  }
}

export interface SetHandle {
  /** The scene's name (the `scene` param). */
  scene: string;
  /** The take's length in seconds, when the scene knows it (the recorder records [from, to) of it). */
  duration?: number;
  /** The canvas whose pixels are the plate (WebCodecs capture reads it; nothing else is drawn over it). */
  canvas: HTMLCanvasElement;
  /** True once the frame on screen is final: every chunk resident, no meshing or light solve pending. */
  idle(): boolean;
  /** Shot time in seconds. */
  t(): number;
  /** Anything worth logging in the take's sidecar. */
  stats(): unknown;
}

export interface SetModule {
  start(query: URLSearchParams, canvas: HTMLCanvasElement): Promise<void>;
}

/** Shot time from the virtual clock: 0 until `begin()` is called (the scene is ready), then virtual seconds. */
export function shotClock(offset = 0): { begin(): void; t(): number; started(): boolean } {
  let start: number | null = null;
  return {
    begin() { if (start === null) start = performance.now(); },
    t: () => start === null ? offset : offset + (performance.now() - start) / 1000,
    started: () => start !== null,
  };
}
