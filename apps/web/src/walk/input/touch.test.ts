import { describe, expect, it } from 'vitest';
import { createWalkTouch, stickIntent, stickRegion, TOUCH } from './touch';

const W = 390, H = 844;
function setup() {
  const style = { touchAction: 'auto' };
  const surface = Object.assign(new EventTarget(), { style, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) });
  const keyboard = new EventTarget();
  const touch = createWalkTouch(surface, keyboard);
  const send = (type: string, id: number, x: number, y: number, pointerType = 'touch') =>
    surface.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: id, pointerType, isPrimary: id === 1, button: 0, buttons: 1, clientX: x, clientY: y }));
  const click = () => {
    let heard = false;
    const listener = () => { heard = true; };
    surface.addEventListener('click', listener);
    surface.dispatchEvent(new Event('click', { cancelable: true }));
    surface.removeEventListener('click', listener);
    return heard;
  };
  return { touch, surface, style, keyboard, send, click };
}

describe('phone walking', () => {
  it('splits the surface into a lower-left stick and an orbit region', () => {
    expect(stickRegion(60, 700, W, H)).toBe('stick');
    expect(stickRegion(60, 200, W, H)).toBe('orbit');
    expect(stickRegion(300, 700, W, H)).toBe('orbit');
    expect(stickRegion(1440 * .4, 800, 1440, 900)).toBe('stick');
  });

  it('turns thumb offset into gentle, capped intent and sprints past the rim', () => {
    expect(stickIntent(0, 0)).toMatchObject({ forward: 0, right: 0, sprint: false });
    expect(stickIntent(0, -TOUCH.radius * .1).forward).toBe(0);
    const half = stickIntent(0, -TOUCH.radius * .58);
    expect(half.forward).toBeCloseTo(.5, 5);
    const rim = stickIntent(TOUCH.radius, 0);
    expect([rim.right, rim.sprint, rim.knobX]).toEqual([1, false, TOUCH.radius]);
    const past = stickIntent(-TOUCH.radius * 2, 0);
    expect([past.right, past.sprint, past.knobX]).toEqual([-1, true, -TOUCH.radius]);
    expect(stickIntent(Number.NaN, 1)).toMatchObject({ forward: 0, right: 0 });
  });

  it('floats the stick under the thumb, keeps it on screen, and lets go cleanly', () => {
    const { touch, send } = setup();
    send('pointerdown', 1, 120, 640);
    expect(touch.stick).toMatchObject({ x: 120, y: 640, forward: 0, right: 0 });
    send('pointermove', 1, 120, 600);
    expect(touch.forward).toBeCloseTo((40 / TOUCH.radius - TOUCH.deadZone) / (1 - TOUCH.deadZone), 9);
    send('pointermove', 1, 120 + TOUCH.radius * 1.4, 640);
    expect([touch.right, touch.forward, touch.sprint]).toEqual([1, 0, true]);
    send('pointerup', 1, 0, 0);
    expect([touch.stick, touch.forward, touch.sprint]).toEqual([null, 0, false]);
    // A thumb landing at the very edge gets the whole ring on screen and already leans that way.
    send('pointerdown', 2, 4, 830);
    const margin = TOUCH.radius + TOUCH.edge;
    expect(touch.stick).toMatchObject({ x: margin, y: H - margin });
    expect(touch.right).toBeLessThan(0);
    expect(touch.forward).toBeLessThan(0);
  });

  it('keeps a tap in either region a click, and eats the click that ended a drag', () => {
    const { touch, send, click } = setup();
    send('pointerdown', 1, 100, 700); send('pointermove', 1, 103, 702); send('pointerup', 1, 103, 702);
    expect(click()).toBe(true);
    send('pointerdown', 1, 300, 300); send('pointerup', 1, 300, 300);
    expect([click(), touch.takeOrbit()]).toEqual([true, { dx: 0, dy: 0 }]);
    send('pointerdown', 1, 100, 700); send('pointermove', 1, 100, 650); send('pointerup', 1, 100, 650);
    expect(click()).toBe(false);
    expect(click()).toBe(true);
  });

  it('orbits with one finger from the first pixel of the press, while the other thumb walks', () => {
    const { touch, send } = setup();
    send('pointerdown', 1, 90, 700);
    send('pointermove', 1, 90, 650);
    send('pointerdown', 2, 300, 400);
    send('pointermove', 2, 305, 400);
    expect([touch.orbiting, touch.takeOrbit()]).toEqual([false, { dx: 0, dy: 0 }]);
    send('pointermove', 2, 330, 390);
    send('pointermove', 2, 350, 395);
    expect(touch.orbiting).toBe(true);
    expect(touch.takeOrbit()).toEqual({ dx: 50, dy: -5 });
    expect(touch.forward).toBeGreaterThan(.9);
    send('pointerup', 2, 350, 395);
    expect(touch.orbiting).toBe(false);
    expect(touch.forward).toBeGreaterThan(.9);
  });

  it('pinches the boom with two orbit fingers and never orbits during the pinch', () => {
    const { touch, send } = setup();
    send('pointerdown', 1, 250, 300);
    send('pointerdown', 2, 330, 300);
    send('pointermove', 1, 230, 300);
    send('pointermove', 2, 350, 300);
    // Spread 80 → 120: forty pixels apart leans in.
    expect(touch.takeZoom()).toBe(-40 * TOUCH.pinchZoom);
    expect(touch.takeOrbit()).toEqual({ dx: 0, dy: 0 });
    send('pointermove', 2, 310, 300);
    expect(touch.takeZoom()).toBe(40 * TOUCH.pinchZoom);
    // One finger lifts: the other turns on from where it is, without a jump.
    send('pointerup', 2, 310, 300);
    send('pointermove', 1, 240, 300);
    expect(touch.takeOrbit()).toEqual({ dx: 10, dy: 0 });
  });

  it('drops every finger on blur, when disabled for a menu, and ignores mouse and pen', () => {
    const { touch, send, keyboard } = setup();
    send('pointerdown', 1, 90, 700); send('pointermove', 1, 90, 640);
    send('pointerdown', 2, 300, 300); send('pointermove', 2, 340, 300);
    keyboard.dispatchEvent(new Event('blur'));
    expect([touch.stick, touch.forward, touch.orbiting, touch.takeOrbit().dx]).toEqual([null, 0, false, 0]);
    send('pointermove', 1, 90, 600);
    expect(touch.forward).toBe(0);
    send('pointerdown', 3, 90, 700); send('pointermove', 3, 90, 640);
    touch.setEnabled(false);
    expect(touch.stick).toBeNull();
    send('pointerdown', 4, 90, 700);
    expect(touch.stick).toBeNull();
    touch.setEnabled(true);
    send('pointerdown', 5, 90, 700, 'mouse'); send('pointermove', 5, 90, 600, 'mouse');
    expect([touch.stick, touch.used]).toEqual([null, true]);
  });

  it('owns touch-action while alive and restores it', () => {
    const { touch, style, send } = setup();
    expect(style.touchAction).toBe('none');
    touch.dispose();
    expect(style.touchAction).toBe('auto');
    send('pointerdown', 1, 90, 700);
    expect(touch.stick).toBeNull();
  });
});
