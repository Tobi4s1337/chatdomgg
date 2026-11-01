import { describe, expect, it } from 'vitest';
import { installFrameGate } from './frames';

/** A window whose frames tick only when the test says so. */
function fakeWindow() {
  let queue: { id: number; callback: FrameRequestCallback }[] = [], id = 0;
  const win = {
    requestAnimationFrame(callback: FrameRequestCallback) { queue.push({ id: ++id, callback }); return id; },
    cancelAnimationFrame(handle: number) { queue = queue.filter(each => each.id !== handle); },
    tick() { const now = queue; queue = []; for (const each of now) each.callback(16); },
  };
  return win;
}

describe('the capture frame gate', () => {
  it('parks frame requests while held and lets exactly the asked-for frames go by', async () => {
    const win = fakeWindow();
    const gate = installFrameGate(win as unknown as Window);
    let drawn = 0;
    const loop = () => { drawn++; win.requestAnimationFrame(loop); };
    win.requestAnimationFrame(loop);
    win.tick();
    expect(drawn).toBe(1);
    gate.hold(true);
    win.tick(); // the request made before holding still runs once
    win.tick(); win.tick();
    expect(drawn).toBe(2);
    const two = gate.frames(2);
    win.tick(); await Promise.resolve();
    win.tick(); await two;
    expect(drawn).toBe(4);
    win.tick(); win.tick();
    expect(drawn).toBe(5);
  });

  it('cancels a parked request', () => {
    const win = fakeWindow();
    const gate = installFrameGate(win as unknown as Window);
    gate.hold(true);
    let ran = false;
    const id = win.requestAnimationFrame(() => { ran = true; });
    win.cancelAnimationFrame(id);
    gate.hold(false);
    win.tick();
    expect(ran).toBe(false);
  });
});
