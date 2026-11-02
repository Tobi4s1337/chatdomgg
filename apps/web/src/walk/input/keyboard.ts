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
  /** An IME is composing: the keys belong to the text being written. */
  readonly isComposing?: boolean;
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

/** The walking actions and their default physical keys; the ledger may rebind them per device. */
export type WalkBindingAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint';
export type WalkBindings = Readonly<Record<WalkBindingAction, string>>;
export const DEFAULT_WALK_BINDINGS: WalkBindings = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft' };
/** The arrows always walk too, whatever the bindings. */
const ARROWS: Readonly<Record<'forward' | 'back' | 'left' | 'right', string>> = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const SHIFT_PAIR: Readonly<Record<string, string>> = { ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft' };

interface KeyMap { readonly forward: ReadonlySet<string>; readonly back: ReadonlySet<string>; readonly left: ReadonlySet<string>; readonly right: ReadonlySet<string>; readonly sprint: ReadonlySet<string>; readonly jump: string; readonly owned: ReadonlySet<string>; readonly letters: ReadonlySet<string> }
function keyMap(bindings: WalkBindings): KeyMap {
  const direction = (action: 'forward' | 'back' | 'left' | 'right') => new Set([bindings[action], ARROWS[action]].filter(Boolean));
  const sprint = new Set([bindings.sprint, SHIFT_PAIR[bindings.sprint] ?? ''].filter(Boolean));
  const map = { forward: direction('forward'), back: direction('back'), left: direction('left'), right: direction('right'), sprint, jump: bindings.jump };
  const owned = new Set([...map.forward, ...map.back, ...map.left, ...map.right, ...sprint, bindings.jump].filter(Boolean));
  // Keys no control uses for itself (letters, digits, Shift): they walk even while a button keeps focus.
  const letters = new Set([...owned].filter(code => /^(Key[A-Z]|Digit[0-9]|Shift(Left|Right))$/.test(code)));
  return { ...map, owned, letters };
}

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

const CONTROL_ROLES = new Set(['button', 'checkbox', 'switch', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'slider', 'spinbutton', 'link', 'treeitem', 'gridcell', 'listbox', 'menu', 'tablist', 'radiogroup', 'tree', 'grid']);

/**
 * A control that a keyboard user has focused (it shows its focus ring): Space presses it and the arrows move
 * within it, so those keys stay with it. A button merely clicked with the mouse keeps focus without the ring,
 * and then Space is a jump again rather than a second click of the last button used.
 */
export function isKeyboardControl(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; getAttribute?: (name: string) => string | null; matches?: (selector: string) => boolean; hasAttribute?: (name: string) => boolean };
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  const role = element.getAttribute?.('role') ?? '';
  const control = tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'INPUT' || (tag === 'A' && !!element.hasAttribute?.('href')) || CONTROL_ROLES.has(role);
  if (!control) return false;
  try { return element.matches?.(':focus-visible') ?? true; } catch { return true; }
}

export function createWalkKeys(keyboard: EventTarget, page?: PageLike, bindings: () => WalkBindings = () => DEFAULT_WALK_BINDINGS): WalkKeys {
  const held = new Set<string>();
  let bound = '', map = keyMap(DEFAULT_WALK_BINDINGS);
  /** Read the bindings at the moment of use, so a key rebound in the ledger walks at once. */
  const current = () => { const next = bindings(), key = JSON.stringify(next); if (key !== bound) { bound = key; map = keyMap(next); held.clear(); jump = false; } return map; };
  let jump = false, enabled = true;
  const has = (codes: ReadonlySet<string>) => { for (const code of codes) if (held.has(code)) return true; return false; };
  const clear = () => { held.clear(); jump = false; };
  const keydown = (raw: Event) => {
    const event = raw as unknown as KeyEventLike;
    const keys = current();
    if (!enabled || event.defaultPrevented || !keys.owned.has(event.code) || event.isComposing || isEditableTarget(event.target)) return;
    // Browser and system shortcuts (Ctrl+W, Cmd+A, Alt+arrows) are never walking.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!keys.letters.has(event.code) && isKeyboardControl(event.target)) return;
    event.preventDefault();
    if (event.code === keys.jump) { if (!event.repeat && !held.has(keys.jump)) jump = true; }
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
  // A native context menu takes the keyboard and swallows the keyups that would end a stride.
  const contextmenu = (event: Event) => { if (!event.defaultPrevented) clear(); };
  keyboard.addEventListener('keydown', keydown);
  keyboard.addEventListener('keyup', keyup);
  keyboard.addEventListener('blur', clear);
  keyboard.addEventListener('focusin', focusin);
  keyboard.addEventListener('contextmenu', contextmenu);
  page?.addEventListener('visibilitychange', visibility);
  return {
    get forward() { const keys = current(); return Number(has(keys.forward)) - Number(has(keys.back)); },
    get right() { const keys = current(); return Number(has(keys.right)) - Number(has(keys.left)); },
    get sprint() { return has(current().sprint); },
    takeJump() { const pressed = jump; jump = false; return pressed; },
    setEnabled(value) { enabled = value; if (!value) clear(); },
    clear,
    dispose() {
      clear(); enabled = false;
      keyboard.removeEventListener('keydown', keydown);
      keyboard.removeEventListener('keyup', keyup);
      keyboard.removeEventListener('blur', clear);
      keyboard.removeEventListener('focusin', focusin);
      keyboard.removeEventListener('contextmenu', contextmenu);
      page?.removeEventListener('visibilitychange', visibility);
    },
  };
}
