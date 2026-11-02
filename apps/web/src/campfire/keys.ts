import type { GameInputLease } from '../games/input';

/*
 * The fire's keys while you sit. A seated place view holds the walk camera, so play's input lease hears nothing then;
 * the fire listens to the page's own keys instead, and only to the few it uses. E and Escape are never taken: they
 * stand you up through the seat's own interaction. Keys typed into a field are never read.
 */
const USED = /^(?:Arrow(?:Left|Right)|Key[AD]|Enter|Space|(?:Digit|Numpad)\d)$/;

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function windowKeys(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): GameInputLease {
  const listeners = new Set<(code: string, down: boolean) => void>();
  let released = false;
  const handle = (down: boolean) => (event: Event) => {
    const key = event as KeyboardEvent;
    if (released || !USED.test(key.code) || editable(key.target) || key.ctrlKey || key.metaKey || key.altKey) return;
    // A focused button already answers Enter and Space with its own click.
    if ((key.code === 'Enter' || key.code === 'Space') && key.target instanceof HTMLButtonElement) return;
    if (down) key.preventDefault();
    for (const listener of [...listeners]) listener(key.code, down);
  };
  const down = handle(true), up = handle(false);
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return {
    get active() { return !released; },
    onKey(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onPointer() { return () => {}; },
    release() {
      if (released) return;
      released = true; listeners.clear();
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
    },
  };
}
