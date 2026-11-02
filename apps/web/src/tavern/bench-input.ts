import type { GameInputLease } from '../games/input';

const PONG_KEYS = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'];
const TURN_KEYS = ['ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'KeyR', 'KeyH', ...Array.from({ length: 7 }, (_, i) => [`Digit${i + 1}`, `Numpad${i + 1}`]).flat()];
const owners = new WeakMap<HTMLCanvasElement, symbol>();
/**
 * The tavern's own pointer-lock lease on its seated canvas: the room route uses it, and so does the portal
 * destination unless play hands it a lease of its own.
 */
export function requestBenchGameInput(surface: HTMLCanvasElement, reason = 'pong'): GameInputLease {
  const gameKeys = new Set(reason.startsWith('pong') ? PONG_KEYS : TURN_KEYS);
  const owner = Symbol('table input'); owners.set(surface, owner);
  let active = true;
  let pendingLocks = 0;
  let pressedButtons = 0;
  const keys = new Set<(code: string, down: boolean) => void>(), pointers = new Set<(dx: number, dy: number, buttons: number) => void>();
  const key = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (!active || !gameKeys.has(event.code)) return;
    // Release held game keys even when a modifier or editable element acquired focus in the meantime.
    if (event.type === 'keyup') { for (const listener of keys) listener(event.code, false); return; }
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey
      || (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
        || event.target.tagName === 'BUTTON' && (event.code === 'Enter' || event.code === 'Space')))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    for (const listener of keys) listener(event.code, event.type === 'keydown');
  };
  const rejectLateLock = () => {
    if (!active && !owners.has(surface) && document.pointerLockElement === surface) document.exitPointerLock();
  };
  const retireGuard = () => { if (!active && !pendingLocks) document.removeEventListener('pointerlockchange', rejectLateLock); };
  const focus = () => {
    if (!active || pendingLocks || document.pointerLockElement === surface) return;
    pendingLocks++;
    void (async () => {
      try { await surface.requestPointerLock?.(); } catch { /* A fresh gesture may acquire it later. */ }
      finally { pendingLocks--; rejectLateLock(); retireGuard(); }
    })();
  };
  const pointer = (event: MouseEvent) => {
    if (!active || document.pointerLockElement !== surface) return;
    // A held button from an abandoned lease is not a new click after reconnect.
    pressedButtons &= event.buttons;
    if (event.type === 'mousedown') {
      const pressed = event.button === 1 ? 4 : event.button === 2 ? 2 : 1 << event.button;
      pressedButtons |= event.buttons & pressed;
    }
    for (const listener of pointers) listener(event.movementX, event.movementY, pressedButtons);
  };
  const clear = () => {
    pressedButtons = 0;
    for (const code of gameKeys) for (const listener of keys) listener(code, false);
    for (const listener of pointers) listener(0, 0, 0);
  };
  const context = (event: Event) => { if (active && document.pointerLockElement === surface) event.preventDefault(); };
  const hidden = () => { if (document.hidden) clear(); };
  const editing = (event: Event) => {
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) clear();
  };
  window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
  window.addEventListener('blur', clear); document.addEventListener('visibilitychange', hidden);
  document.addEventListener('focusin', editing); document.addEventListener('pointerlockchange', rejectLateLock);
  surface.addEventListener('pointerdown', focus); document.addEventListener('mousemove', pointer);
  document.addEventListener('mousedown', pointer); document.addEventListener('mouseup', pointer);
  document.addEventListener('contextmenu', context);
  focus();
  return {
    get active() { return active; },
    onKey(listener) { keys.add(listener); return () => keys.delete(listener); },
    onPointer(listener) { pointers.add(listener); return () => pointers.delete(listener); },
    release() {
      if (!active) return; active = false; clear(); keys.clear(); pointers.clear();
      if (owners.get(surface) === owner) owners.delete(surface);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('focusin', editing);
      surface.removeEventListener('pointerdown', focus); document.removeEventListener('mousemove', pointer);
      document.removeEventListener('mousedown', pointer); document.removeEventListener('mouseup', pointer);
      document.removeEventListener('contextmenu', context);
      rejectLateLock(); retireGuard();
    },
  };
}
