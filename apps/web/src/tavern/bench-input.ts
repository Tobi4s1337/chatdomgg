import type { GameInputLease } from '../games/input';

const GAME_KEYS = new Set(['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space']);
/** Local inspection adapter only. Integrated play supplies its own requestInput lease. */
export function requestBenchGameInput(surface: HTMLCanvasElement): GameInputLease {
  let active = true;
  const keys = new Set<(code: string, down: boolean) => void>(), pointers = new Set<(dx: number, dy: number, buttons: number) => void>();
  const key = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (!active || !GAME_KEYS.has(event.code) || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
      || (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    for (const listener of keys) listener(event.code, event.type === 'keydown');
  };
  const focus = () => { if (active && document.pointerLockElement !== surface) void surface.requestPointerLock?.().catch(() => {}); };
  const pointer = (event: MouseEvent) => {
    if (active && document.pointerLockElement === surface) for (const listener of pointers) listener(event.movementX, event.movementY, event.buttons);
  };
  const clear = () => { for (const code of GAME_KEYS) for (const listener of keys) listener(code, false); };
  const hidden = () => { if (document.hidden) clear(); };
  window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
  window.addEventListener('blur', clear); document.addEventListener('visibilitychange', hidden);
  surface.addEventListener('pointerdown', focus); document.addEventListener('mousemove', pointer);
  focus();
  return {
    get active() { return active; },
    onKey(listener) { keys.add(listener); return () => keys.delete(listener); },
    onPointer(listener) { pointers.add(listener); return () => pointers.delete(listener); },
    release() {
      if (!active) return; active = false; clear(); keys.clear(); pointers.clear();
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
      window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', hidden);
      surface.removeEventListener('pointerdown', focus); document.removeEventListener('mousemove', pointer);
      if (document.pointerLockElement === surface) document.exitPointerLock();
    },
  };
}
