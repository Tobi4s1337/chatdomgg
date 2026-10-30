/**
 * Walking keys. Physical key codes, so WASD stays under the same fingers on AZERTY and Dvorak layouts.
 * E is deliberately absent: it belongs to the interaction owner.
 */
export interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: unknown;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}
export interface PageLike extends EventTarget { readonly hidden: boolean }

export interface WalkKeys {
  /** Forward/back intent in [-1, 1]. */
  readonly forward: number;
  /** Right/left intent in [-1, 1]. */
  readonly right: number;
  readonly sprint: boolean;
  /** True once per fresh Space press; key repeat never makes another. */
  takeJump(): boolean;
  /** Stop or resume owning keys. Disabling forgets held keys and a pending jump. */
  setEnabled(enabled: boolean): void;
  /** Forget everything held or pending (blur, hidden page, menu, disconnect). */
  clear(): void;
  dispose(): void;
}

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const JUMP = 'Space';
const OWNED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...SPRINT, JUMP]);

/** A focused text field, select or contenteditable keeps its keys. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = typeof element.type === 'string' ? element.type.toLowerCase() : 'text';
  return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(type);
}

export function createWalkKeys(keyboard: EventTarget, page?: PageLike): WalkKeys {
  const held = new Set<string>();
  let jump = false, enabled = true;
  const has = (codes: ReadonlySet<string>) => { for (const code of codes) if (held.has(code)) return true; return false; };
  const clear = () => { held.clear(); jump = false; };
  const keydown = (raw: Event) => {
    const event = raw as unknown as KeyEventLike;
    if (!enabled || event.defaultPrevented || !OWNED.has(event.code) || isEditableTarget(event.target)) return;
    // Browser and system shortcuts (Ctrl+W, Cmd+A, Alt+arrows) are never walking.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.code === JUMP) { if (!event.repeat && !held.has(JUMP)) jump = true; }
    held.add(event.code);
  };
  const keyup = (raw: Event) => {
    const event = raw as unknown as KeyEventLike;
    // macOS swallows the keyup of anything released while Cmd was down; letting go of Cmd ends them all.
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') { held.clear(); return; }
    held.delete(event.code);
  };
  const visibility = () => { if (page?.hidden) clear(); };
  // Moving focus into a chat box or form mid-stride must not leave the citizen walking while someone types.
  const focusin = (event: Event) => { if (isEditableTarget(event.target)) clear(); };
  keyboard.addEventListener('keydown', keydown);
  keyboard.addEventListener('keyup', keyup);
  keyboard.addEventListener('blur', clear);
  keyboard.addEventListener('focusin', focusin);
  page?.addEventListener('visibilitychange', visibility);
  return {
    get forward() { return Number(has(FORWARD)) - Number(has(BACK)); },
    get right() { return Number(has(RIGHT)) - Number(has(LEFT)); },
    get sprint() { return has(SPRINT); },
    takeJump() { const pressed = jump; jump = false; return pressed; },
    setEnabled(value) { enabled = value; if (!value) clear(); },
    clear,
    dispose() {
      clear(); enabled = false;
      keyboard.removeEventListener('keydown', keydown);
      keyboard.removeEventListener('keyup', keyup);
      keyboard.removeEventListener('blur', clear);
      keyboard.removeEventListener('focusin', focusin);
      page?.removeEventListener('visibilitychange', visibility);
    },
  };
}
