import { describe, expect, it } from 'vitest';
import { createWalkPointer, isClickPress, wheelPixels } from './pointer';

type PointerInit = { id?: number; type?: string; x: number; y: number; button?: number; buttons?: number; primary?: boolean };
function pointer(target: EventTarget, type: string, init: PointerInit) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: init.id ?? 1, pointerType: init.type ?? 'mouse', isPrimary: init.primary ?? true, button: init.button ?? 0, buttons: init.buttons ?? 1, clientX: init.x, clientY: init.y });
  target.dispatchEvent(event);
}
function surface() {
  const captured = new Set<number>();
  const target = Object.assign(new EventTarget(), {
    setPointerCapture: (id: number) => { captured.add(id); },
    releasePointerCapture: (id: number) => { captured.delete(id); },
    hasPointerCapture: (id: number) => captured.has(id),
  });
  return { target, captured };
}
function click(target: EventTarget) {
  let heard = false;
  const listener = () => { heard = true; };
  target.addEventListener('click', listener);
  const event = new Event('click', { cancelable: true });
  target.dispatchEvent(event);
  target.removeEventListener('click', listener);
  return { heard, prevented: event.defaultPrevented };
}

describe('free-cursor camera input', () => {
  it('keeps a short press a click for the interaction owner', () => {
    const { target } = surface(), input = createWalkPointer(target, new EventTarget());
    pointer(target, 'pointerdown', { x: 100, y: 100 });
    pointer(target, 'pointermove', { x: 105, y: 104 });
    pointer(target, 'pointerup', { x: 105, y: 104, buttons: 0 });
    expect(input.takeOrbit()).toEqual({ dx: 0, dy: 0 });
    expect(click(target)).toEqual({ heard: true, prevented: false });
    expect(isClickPress(5, 4, 120)).toBe(true);
    expect(isClickPress(9, 0, 120)).toBe(false);
    expect(isClickPress(1, 1, 300)).toBe(false);
  });

  it('orbits once a press travels, gathers every move until the next frame, and eats the trailing click', () => {
    const { target, captured } = surface(), input = createWalkPointer(target, new EventTarget());
    pointer(target, 'pointerdown', { x: 100, y: 100 });
    pointer(target, 'pointermove', { x: 112, y: 100 });
    expect(input.dragging).toBe(true);
    expect(captured.has(1)).toBe(true);
    pointer(target, 'pointermove', { x: 130, y: 90 });
    pointer(target, 'pointermove', { x: 150, y: 95 });
    // The whole hand travel from the press arrives, the slop included, so the view follows the hand exactly.
    expect(input.takeOrbit()).toEqual({ dx: 50, dy: -5 });
    expect(input.takeOrbit()).toEqual({ dx: 0, dy: 0 });
    pointer(target, 'pointerup', { x: 150, y: 95, buttons: 0 });
    expect([input.dragging, captured.has(1)]).toEqual([false, false]);
    expect(click(target)).toEqual({ heard: false, prevented: true });
    // Only that one click.
    expect(click(target).heard).toBe(true);
  });

  it('ends a drag whose button was released outside the window', () => {
    const { target } = surface(), input = createWalkPointer(target, new EventTarget());
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 20, y: 0 });
    pointer(target, 'pointermove', { x: 40, y: 0, buttons: 0 });
    expect(input.dragging).toBe(false);
    pointer(target, 'pointermove', { x: 90, y: 0, buttons: 0 });
    expect(input.takeOrbit().dx).toBe(20);
  });

  it('drops the drag on blur and when a menu takes the pointer', () => {
    const { target, captured } = surface(), keyboard = new EventTarget(), input = createWalkPointer(target, keyboard);
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 30, y: 0 });
    keyboard.dispatchEvent(new Event('blur'));
    expect([input.dragging, captured.size, input.takeOrbit().dx]).toEqual([false, 0, 0]);
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 30, y: 0 });
    input.setEnabled(false);
    expect([input.dragging, input.takeOrbit().dx]).toEqual([false, 0]);
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 30, y: 0 });
    expect(input.takeOrbit().dx).toBe(0);
  });

  it('ignores secondary buttons, leaves touch to the phone controls, and drags with a pen', () => {
    const { target } = surface(), input = createWalkPointer(target, new EventTarget());
    pointer(target, 'pointerdown', { x: 0, y: 0, button: 2 });
    pointer(target, 'pointermove', { x: 40, y: 0, buttons: 2 });
    expect(input.takeOrbit().dx).toBe(0);
    pointer(target, 'pointerdown', { id: 7, type: 'touch', x: 0, y: 0 });
    pointer(target, 'pointermove', { id: 7, type: 'touch', x: 40, y: 0 });
    expect([input.dragging, input.takeOrbit().dx]).toEqual([false, 0]);
    pointer(target, 'pointerdown', { id: 9, type: 'pen', x: 0, y: 0 });
    pointer(target, 'pointermove', { id: 9, type: 'pen', x: 20, y: 0 });
    expect(input.takeOrbit().dx).toBe(20);
  });

  it('never drags while mouse look holds the pointer, and switching drops a drag', () => {
    const { target, captured } = surface(), input = createWalkPointer(target, new EventTarget());
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 30, y: 0 });
    input.setLocked(true);
    expect([input.dragging, captured.size, input.takeOrbit().dx]).toEqual([false, 0, 0]);
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 30, y: 0 });
    expect([input.dragging, input.takeOrbit().dx]).toEqual([false, 0]);
    // The lock refused or let go: the bounded drag is back.
    input.setLocked(false);
    pointer(target, 'pointerup', { x: 30, y: 0, buttons: 0 });
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 30, y: 0 });
    expect(input.takeOrbit().dx).toBe(30);
  });

  it('reads wheel lines and pages, bounds a single flick, and only scrolls the world', () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1, preventDefault() {} })).toBe(48);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2, preventDefault() {} })).toBe(240);
    expect(wheelPixels({ deltaY: -5000, deltaMode: 0, preventDefault() {} })).toBe(-240);
    expect(wheelPixels({ deltaY: Number.NaN, deltaMode: 0, preventDefault() {} })).toBe(0);
    const { target } = surface(), input = createWalkPointer(target, new EventTarget());
    const wheel = new Event('wheel', { cancelable: true });
    Object.assign(wheel, { deltaY: 100, deltaMode: 0 });
    target.dispatchEvent(wheel);
    target.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -30, deltaMode: 0 }));
    expect(wheel.defaultPrevented).toBe(true);
    expect(input.takeZoom()).toBe(70);
    expect(input.takeZoom()).toBe(0);
  });

  it('stops listening when disposed', () => {
    const { target } = surface(), input = createWalkPointer(target, new EventTarget());
    input.dispose();
    pointer(target, 'pointerdown', { x: 0, y: 0 });
    pointer(target, 'pointermove', { x: 50, y: 0 });
    const wheel = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 100, deltaMode: 0 });
    target.dispatchEvent(wheel);
    expect([input.takeOrbit().dx, input.takeZoom(), wheel.defaultPrevented]).toEqual([0, 0, false]);
  });
});
