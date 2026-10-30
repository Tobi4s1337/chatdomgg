import { describe, expect, it } from 'vitest';
import { createWalkKeys, isEditableTarget, isKeyboardControl } from './keyboard';

type KeyInit = { code: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown };
function key(target: EventTarget, type: 'keydown' | 'keyup', init: KeyInit): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code: init.code, repeat: init.repeat ?? false, ctrlKey: !!init.ctrlKey, metaKey: !!init.metaKey, altKey: !!init.altKey });
  if (init.target !== undefined) Object.defineProperty(event, 'target', { value: init.target });
  target.dispatchEvent(event);
  return event;
}
const page = () => Object.assign(new EventTarget(), { hidden: false });

describe('walking keys', () => {
  it('turns held WASD and arrows into intent, and owns only its keys', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    const w = key(keyboard, 'keydown', { code: 'KeyW' });
    key(keyboard, 'keydown', { code: 'ArrowLeft' });
    expect([keys.forward, keys.right]).toEqual([1, -1]);
    expect(w.defaultPrevented).toBe(true);
    key(keyboard, 'keydown', { code: 'KeyS' });
    expect(keys.forward).toBe(0);
    key(keyboard, 'keyup', { code: 'KeyW' });
    expect(keys.forward).toBe(-1);
    // E is the interaction owner's key; Escape, Tab and Q are not ours either.
    for (const code of ['KeyE', 'Escape', 'Tab', 'KeyQ']) expect(key(keyboard, 'keydown', { code }).defaultPrevented).toBe(false);
  });

  it('makes one jump per press, never from a held key repeating', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    key(keyboard, 'keydown', { code: 'Space' });
    for (let n = 0; n < 12; n++) key(keyboard, 'keydown', { code: 'Space', repeat: true });
    expect(keys.takeJump()).toBe(true);
    expect(keys.takeJump()).toBe(false);
    // A repeat that arrives without a fresh press (focus returned while held) is still not a press.
    key(keyboard, 'keyup', { code: 'Space' });
    key(keyboard, 'keydown', { code: 'Space', repeat: true });
    expect(keys.takeJump()).toBe(false);
    key(keyboard, 'keyup', { code: 'Space' });
    key(keyboard, 'keydown', { code: 'Space' });
    expect(keys.takeJump()).toBe(true);
  });

  it('sprints only while Shift is held', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    key(keyboard, 'keydown', { code: 'ShiftRight' });
    expect(keys.sprint).toBe(true);
    key(keyboard, 'keyup', { code: 'ShiftRight' });
    expect(keys.sprint).toBe(false);
  });

  it('leaves typing, forms and shortcuts alone', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    const field = { tagName: 'INPUT', type: 'text' };
    const typed = key(keyboard, 'keydown', { code: 'KeyW', target: field });
    key(keyboard, 'keydown', { code: 'Space', target: { tagName: 'DIV', isContentEditable: true } });
    expect([keys.forward, keys.takeJump(), typed.defaultPrevented]).toEqual([0, false, false]);
    const closeTab = key(keyboard, 'keydown', { code: 'KeyW', ctrlKey: true });
    key(keyboard, 'keydown', { code: 'KeyA', metaKey: true });
    expect([keys.forward, keys.right, closeTab.defaultPrevented]).toEqual([0, 0, false]);
    expect(isEditableTarget({ tagName: 'textarea' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('leaves Space and arrows to a keyboard-focused control, but walks and jumps past a clicked button', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    const control = (tagName: string, focusVisible: boolean, attrs: Record<string, string> = {}) => ({
      tagName, getAttribute: (name: string) => attrs[name] ?? null, hasAttribute: (name: string) => name in attrs,
      matches: (selector: string) => selector === ':focus-visible' && focusVisible,
    });
    const tabbed = control('BUTTON', true);
    const space = key(keyboard, 'keydown', { code: 'Space', target: tabbed });
    key(keyboard, 'keydown', { code: 'ArrowUp', target: control('DIV', true, { role: 'slider' }) });
    expect([space.defaultPrevented, keys.takeJump(), keys.forward]).toEqual([false, false, 0]);
    key(keyboard, 'keyup', { code: 'Space' }); key(keyboard, 'keyup', { code: 'ArrowUp' });
    // W walks even with a focused control: no control uses letters.
    key(keyboard, 'keydown', { code: 'KeyW', target: tabbed });
    expect(keys.forward).toBe(1);
    key(keyboard, 'keyup', { code: 'KeyW' });
    // The time-of-day button someone just clicked keeps focus without a ring: Space is a jump, not a second click.
    const clicked = key(keyboard, 'keydown', { code: 'Space', target: control('BUTTON', false) });
    expect([clicked.defaultPrevented, keys.takeJump()]).toEqual([true, true]);
    key(keyboard, 'keyup', { code: 'Space' });
    key(keyboard, 'keydown', { code: 'ArrowLeft', target: control('A', false, { href: '/map' }) });
    expect(keys.right).toBe(-1);
    expect(isKeyboardControl(control('A', true))).toBe(false);
    expect(isKeyboardControl(control('DIV', true))).toBe(false);
    expect(isKeyboardControl(control('SUMMARY', true))).toBe(true);
  });

  it('leaves keys to an IME that is composing', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyW', repeat: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: true });
    keyboard.dispatchEvent(event);
    expect([keys.forward, event.defaultPrevented]).toEqual([0, false]);
  });

  it('never leaves a key stuck after blur, a hidden page, a chat box, a context menu, Cmd or a menu', () => {
    const keyboard = new EventTarget(), doc = page(), keys = createWalkKeys(keyboard, doc);
    const hold = () => { key(keyboard, 'keydown', { code: 'KeyW' }); key(keyboard, 'keydown', { code: 'ShiftLeft' }); key(keyboard, 'keydown', { code: 'Space' }); };
    const released = () => keys.forward === 0 && !keys.sprint && !keys.takeJump();
    hold(); keyboard.dispatchEvent(new Event('blur')); expect(released()).toBe(true);
    hold(); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); expect(released()).toBe(true);
    doc.hidden = false;
    hold();
    const focus = new Event('focusin'); Object.defineProperty(focus, 'target', { value: { tagName: 'TEXTAREA' } });
    keyboard.dispatchEvent(focus); expect(released()).toBe(true);
    // macOS drops the keyup of W when it is released while Cmd is held.
    hold(); key(keyboard, 'keyup', { code: 'MetaLeft' }); expect(keys.forward).toBe(0);
    // A native context menu swallows keyups; one the page handles itself does not.
    hold(); keyboard.dispatchEvent(new Event('contextmenu', { cancelable: true })); expect(released()).toBe(true);
    const handled = new Event('contextmenu', { cancelable: true }); handled.preventDefault();
    key(keyboard, 'keydown', { code: 'KeyW' }); keyboard.dispatchEvent(handled); expect(keys.forward).toBe(1);
    key(keyboard, 'keyup', { code: 'KeyW' });
    hold(); keys.setEnabled(false); expect(released()).toBe(true);
    key(keyboard, 'keydown', { code: 'KeyD' }); expect(keys.right).toBe(0);
    keys.setEnabled(true); key(keyboard, 'keydown', { code: 'KeyD' }); expect(keys.right).toBe(1);
  });

  it('lets go of the page when disposed', () => {
    const keyboard = new EventTarget(), keys = createWalkKeys(keyboard);
    key(keyboard, 'keydown', { code: 'KeyW' });
    keys.dispose();
    expect(keys.forward).toBe(0);
    expect(key(keyboard, 'keydown', { code: 'KeyW' }).defaultPrevented).toBe(false);
    expect(keys.forward).toBe(0);
  });
});
