/**
 * A capture's hand on the page's animation frames. Under `?capture=1` every `requestAnimationFrame` (the kingdom
 * worlds, the map's ticker, the route's own loop) goes through this gate: while it is held, frame requests wait, and
 * the capture lets exactly the frames it needs go by before each picture. A software-rendered kingdom frame can take
 * half a minute, so a page that drew continuously between pictures would spend the whole capture drawing frames
 * nobody keeps. Outside captures the gate is never installed.
 */
export interface FrameGate {
  /** Hold every frame request until released (`true`), or let them all run as they come (`false`). */
  hold(value: boolean): void;
  /** Let `count` frames go by, then hold again. */
  frames(count: number): Promise<void>;
}

export function installFrameGate(target: Window = window): FrameGate {
  const native = target.requestAnimationFrame.bind(target);
  const nativeCancel = target.cancelAnimationFrame.bind(target);
  let held = false, nextId = 1;
  const parked = new Map<number, FrameRequestCallback>();
  const running = new Map<number, number>();

  const run = (id: number, callback: FrameRequestCallback) => {
    running.set(id, native(time => { running.delete(id); callback(time); }));
  };
  target.requestAnimationFrame = callback => {
    const id = nextId++;
    if (held) parked.set(id, callback);
    else run(id, callback);
    return id;
  };
  target.cancelAnimationFrame = id => {
    parked.delete(id);
    const handle = running.get(id);
    if (handle !== undefined) { nativeCancel(handle); running.delete(id); }
  };

  const hold = (value: boolean) => {
    held = value;
    if (held) return;
    const waiting = [...parked];
    parked.clear();
    for (const [id, callback] of waiting) run(id, callback);
  };
  return {
    hold,
    async frames(count) {
      hold(false);
      for (let i = 0; i < count; i++) await new Promise<void>(resolve => native(() => resolve()));
      hold(true);
    },
  };
}
