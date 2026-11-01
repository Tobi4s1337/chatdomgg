import type { CitizenGesture } from '../../citizens';
import { isEditableTarget } from '../input/keyboard';
import './style.css';

export type PlayableGesture = 'wave' | 'bow' | 'cheer' | 'dance' | 'sit' | 'point';

/** Durations in milliseconds; a seated citizen stays until they move or choose another gesture. */
export const GESTURE_DURATION: Record<PlayableGesture, number> = {
  wave: 2600, bow: 2200, cheer: 3200, dance: 8000, sit: Infinity, point: 3000,
};

export interface GestureState {
  play(gesture: PlayableGesture, nowMs: number): void;
  /** Sample every frame with monotonic time and actual or intended movement. */
  sample(nowMs: number, moving: boolean): CitizenGesture;
  clear(): void;
  dispose(): void;
}

/** Local animation state. The callback is the transport seam, including `none` when a gesture ends. */
export function createGestureState(onGesture: (gesture: CitizenGesture) => void): GestureState {
  let current: CitizenGesture = 'none';
  let until = 0;
  let disposed = false;
  const clear = () => {
    if (disposed || current === 'none') return;
    current = 'none'; until = 0; onGesture('none');
  };
  return {
    play(gesture, nowMs) {
      if (disposed || !Number.isFinite(nowMs)) return;
      const deadline = nowMs + GESTURE_DURATION[gesture];
      if (gesture !== 'sit' && (!Number.isFinite(deadline) || deadline <= nowMs)) return;
      if (gesture === 'sit' && current === 'sit') { clear(); return; }
      current = gesture; until = deadline; onGesture(gesture);
    },
    sample(nowMs, moving) {
      if (!disposed && (!Number.isFinite(nowMs) || nowMs >= until || (moving && (current === 'sit' || current === 'dance')))) clear();
      return current;
    },
    clear,
    dispose() { clear(); disposed = true; },
  };
}

export interface GestureSelectorOptions {
  readonly state: GestureState;
  /** True only when the caller has a working gesture transport. */
  readonly available: boolean;
  readonly visible?: boolean;
}
export interface GestureSelector {
  setAvailable(available: boolean): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const GESTURES: readonly { name: PlayableGesture; path: string; label: string }[] = [
  { name: 'wave', path: 'M9 13V6a1 1 0 0 1 2 0v5-7a1 1 0 0 1 2 0v7-6a1 1 0 0 1 2 0v7-4a1 1 0 0 1 2 0v7c0 3-2 5-5 5h-1c-2 0-3-1-4-3l-2-3a1 1 0 0 1 2-1l2 2M5 6 3 4M5 10H2M19 4l2-2', label: 'Wave' },
  { name: 'bow', path: 'M15 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM14 8l-4 4-5 1M14 8l3 4 3 1M10 12l1 4-3 5M11 16l5 5', label: 'Bow' },
  { name: 'cheer', path: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 10v6M12 11 7 8 4 4M12 11l5-3 3-4M12 16l-4 5M12 16l4 5M4 1v2M2 3h2M20 1v2M20 3h2', label: 'Cheer' },
  { name: 'dance', path: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM11 10l2 5M11 10 7 13 4 11M11 10l4 1 3-3M13 15l-5 5M13 15l4 5M19 2v4l2-1V1l-2 1Z', label: 'Dance' },
  { name: 'sit', path: 'M10 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 9l1 5h5l2 5M9 9l-2 4 3 2M6 16h11M7 16v5M16 16v5', label: 'Sit' },
  { name: 'point', path: 'M9 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 9v7M9 10l4 2 6-2M9 11l-3 3M9 16l-3 5M9 16l3 5M18 7l3 3-3 3', label: 'Point' },
];

/** Mount a small accessible selector over the walk surface. The caller owns the state. */
export function mountGestureSelector(container: HTMLElement, options: GestureSelectorOptions): GestureSelector {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const root = doc.createElement('div');
  root.className = 'walk-gestures';
  root.hidden = options.visible === false;
  const trigger = doc.createElement('button');
  trigger.type = 'button'; trigger.className = 'walk-gestures-trigger';
  trigger.textContent = 'Gestures';
  trigger.setAttribute('aria-expanded', 'false');
  const panel = doc.createElement('div');
  panel.className = 'walk-gestures-panel'; panel.hidden = true;
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Choose a gesture');
  const heading = doc.createElement('p'); heading.className = 'walk-gestures-heading'; heading.textContent = 'Say it with a gesture';
  panel.append(heading);
  const grid = doc.createElement('div'); grid.className = 'walk-gestures-grid';
  for (const gesture of GESTURES) {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'walk-gesture';
    const symbol = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    symbol.classList.add('walk-gesture-symbol'); symbol.setAttribute('viewBox', '0 0 24 24'); symbol.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', gesture.path); symbol.append(path);
    const label = doc.createElement('span'); label.textContent = gesture.label;
    button.append(symbol, label);
    button.addEventListener('click', () => { if (!available) return; options.state.play(gesture.name, win?.performance.now() ?? performance.now()); close(); trigger.focus(); });
    grid.append(button);
  }
  panel.append(grid);
  const note = doc.createElement('span'); note.className = 'walk-gestures-note'; note.id = `walk-gestures-note-${Math.random().toString(36).slice(2)}`;
  trigger.setAttribute('aria-describedby', note.id);
  root.append(trigger, panel, note); container.append(root);
  let available = options.available;
  const close = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  const update = () => {
    trigger.disabled = !available;
    note.textContent = available ? '' : 'Gestures unavailable while disconnected';
    if (!available) { close(); options.state.clear(); }
  };
  const toggle = () => { if (!available) return; panel.hidden = !panel.hidden; trigger.setAttribute('aria-expanded', String(!panel.hidden)); };
  const stopPointer = (event: Event) => event.stopPropagation();
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || panel.hidden || event.defaultPrevented || isEditableTarget(event.target)) return;
    event.preventDefault(); event.stopPropagation(); close(); trigger.focus();
  };
  const blur = () => { close(); options.state.clear(); };
  const visibility = () => { if (doc.hidden) blur(); };
  trigger.addEventListener('click', toggle);
  root.addEventListener('pointerdown', stopPointer); root.addEventListener('pointerup', stopPointer); root.addEventListener('click', stopPointer);
  doc.addEventListener('keydown', keydown); doc.addEventListener('visibilitychange', visibility); win?.addEventListener('blur', blur);
  update();
  return {
    setAvailable(value) { if (available === value) return; available = value; update(); },
    setVisible(value) { root.hidden = !value; if (!value) { close(); options.state.clear(); } },
    dispose() {
      close(); options.state.clear();
      trigger.removeEventListener('click', toggle);
      root.removeEventListener('pointerdown', stopPointer); root.removeEventListener('pointerup', stopPointer); root.removeEventListener('click', stopPointer);
      doc.removeEventListener('keydown', keydown); doc.removeEventListener('visibilitychange', visibility); win?.removeEventListener('blur', blur);
      root.remove();
    },
  };
}
