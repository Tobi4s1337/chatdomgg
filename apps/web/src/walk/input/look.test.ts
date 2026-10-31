import { describe, expect, it } from 'vitest';
import { createWalkLook, filterLookDelta, LOOK } from './look';

type Outcome = 'grant' | 'refuse' | 'throw';
function harness(outcomes: Outcome[] = []) {
  let now = 1000;
  const requests: ({ unadjustedMovement?: boolean } | undefined)[] = [];
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock() {
      if (doc.pointerLockElement === null) return;
      doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const grant = () => { doc.pointerLockElement = surface; doc.dispatchEvent(new Event('pointerlockchange')); };
  const pending: (() => void)[] = [];
  const surface = Object.assign(new EventTarget(), {
    requestPointerLock(options?: { unadjustedMovement?: boolean }) {
      requests.push(options);
      const outcome = outcomes.shift() ?? 'grant';
      if (outcome === 'throw') throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      if (outcome === 'refuse') {
        // Chrome both rejects the promise and fires pointerlockerror.
        doc.dispatchEvent(new Event('pointerlockerror'));
        return Promise.reject(Object.assign(new Error('cooldown'), { name: 'SecurityError' }));
      }
      pending.push(grant);
      return Promise.resolve();
    },
  });
  const keyboard = new EventTarget();
  const look = createWalkLook(surface, doc, keyboard, () => now);
  const key = (code: string, init: { repeat?: boolean; target?: unknown } = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: !!init.repeat, ctrlKey: false, metaKey: false, altKey: false });
    if (init.target) Object.defineProperty(event, 'target', { value: init.target });
    keyboard.dispatchEvent(event);
    return event;
  };
  const move = (movementX: number, movementY: number) => doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); pending.splice(0).forEach(fn => fn()); };
  return { look, doc, surface, keyboard, requests, key, move, settle, click: () => look.toggle({ type: 'click', isTrusted: true, detail: 1 }), advance: (ms: number) => { now += ms; } };
}

describe('mouse look', () => {
  it('filters locked movement exactly as R8 asks', () => {
    expect(filterLookDelta(20, -10, 119)).toBeNull();
    expect(filterLookDelta(20, -10, 120)).toEqual({ dx: 20, dy: -10 });
    expect(filterLookDelta(Number.NaN, 0, 500)).toBeNull();
    expect(filterLookDelta(0, Infinity, 500)).toBeNull();
    // Either axis past 250 px discards the whole event, not just that axis.
    expect(filterLookDelta(251, 3, 500)).toBeNull();
    expect(filterLookDelta(4, -251, 500)).toBeNull();
    expect(filterLookDelta(250, -250, 500)).toEqual({ dx: LOOK.clampPx, dy: -LOOK.clampPx });
    expect(filterLookDelta(-180, 99, 500)).toEqual({ dx: -100, dy: 99 });
  });

  it('opts in with a real pointer click, ignores the settle window and warps, and gathers every event of a slow frame', async () => {
    const { look, click, move, settle, advance, requests } = harness();
    expect(look.mode).toBe('free');
    click();
    expect(look.mode).toBe('requesting');
    expect(requests).toEqual([undefined]);
    await settle();
    expect(look.mode).toBe('locked');
    move(140, 0); advance(60); move(30, 0);
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
    advance(80);
    // One slow frame: five events, one of them a warp, one over the clamp.
    move(12, 3); move(-4, 1); move(900, 2); move(160, -20); move(8, 0);
    expect(look.takeLook()).toEqual({ dx: 116, dy: -16 });
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('gives the cursor back on Escape, click, blur and when disabled for a menu', async () => {
    const { look, doc, key, click, move, settle, advance, keyboard } = harness();
    click(); await settle(); advance(200);
    move(10, 0);
    key('Escape');
    expect([look.mode, doc.pointerLockElement, look.takeLook().dx]).toEqual(['free', null, 0]);
    click(); await settle(); expect(look.mode).toBe('locked');
    click(); expect([look.mode, doc.pointerLockElement]).toEqual(['free', null]);
    click(); await settle();
    keyboard.dispatchEvent(new Event('blur'));
    expect([look.mode, doc.pointerLockElement]).toEqual(['free', null]);
    click(); await settle();
    look.setEnabled(false);
    expect([look.mode, doc.pointerLockElement]).toEqual(['free', null]);
    expect(key('KeyV').defaultPrevented).toBe(false);
    expect(look.mode).toBe('free');
    look.setEnabled(true);
    // The browser's own unlock (its Escape) is followed too.
    click(); await settle(); doc.exitPointerLock();
    expect(look.mode).toBe('free');
  });

  it('falls back to drag on a refused lock, never on a fast flick, and a later lock clears it', async () => {
    const { look, key, click, move, settle, advance } = harness(['grant', 'refuse', 'grant']);
    click(); await settle(); advance(200);
    // A violent flick is discarded but never switches the mode.
    for (let n = 0; n < 20; n++) move(n % 2 ? 900 : -900, 400);
    expect([look.mode, look.takeLook()]).toEqual(['locked', { dx: 0, dy: 0 }]);
    key('Escape');
    // Chrome refuses a re-lock right after Escape.
    click(); await settle();
    expect(look.mode).toBe('fallback');
    move(50, 0);
    expect(look.takeLook().dx).toBe(0);
    key('Escape'); expect(look.mode).toBe('fallback');
    // A later click retries, lands, and the fallback is gone; the settle window starts again.
    click(); expect(look.mode).toBe('requesting');
    await settle();
    expect(look.mode).toBe('locked');
    move(40, 0); expect(look.takeLook().dx).toBe(0);
    advance(130); move(40, 0); expect(look.takeLook().dx).toBe(40);
  });

  it('makes only one standard request per click and quietly survives rejection or a throwing request', async () => {
    const refused = harness(['refuse']);
    refused.click(); await refused.settle();
    expect(refused.requests).toEqual([undefined]);
    expect(refused.look.mode).toBe('fallback');
    for (let n = 0; n < 20; n++) refused.key('KeyV');
    await refused.settle();
    expect(refused.requests).toHaveLength(1);
    const thrown = harness(['throw']);
    thrown.click();
    expect(thrown.look.mode).toBe('fallback');
  });

  it('hands back a lock that lands after the walker let go, and ignores late refusals', async () => {
    const { look, doc, click, settle } = harness();
    click();
    look.setEnabled(false);
    await settle();
    expect([look.mode, doc.pointerLockElement]).toEqual(['free', null]);
  });

  it('never acquires from keyboard activation, synthetic clicks, V or a text field', () => {
    const { look, key, requests } = harness();
    key('KeyV', { target: { tagName: 'INPUT', type: 'text' } });
    key('KeyV', { repeat: true });
    look.toggle({ type: 'click', isTrusted: true, detail: 0 });
    look.toggle({ type: 'click', isTrusted: false, detail: 1 });
    expect(look.mode).toBe('free');
    expect(requests).toHaveLength(0);
  });

  it('reports each change once and stops on dispose', async () => {
    const { look, click, settle, doc } = harness();
    const seen: string[] = [];
    look.onChange(mode => seen.push(mode));
    click(); await settle();
    look.dispose();
    expect(seen).toEqual(['requesting', 'locked', 'free']);
    expect(doc.pointerLockElement).toBeNull();
    click();
    expect(look.mode).toBe('free');
  });
});
