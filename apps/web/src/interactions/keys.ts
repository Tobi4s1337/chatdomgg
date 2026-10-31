import { isEditableTarget, isKeyboardControl } from '../walk/input/keyboard';

/**
 * E means this one action. One press, one use: never on key repeat, never while typing or composing text, never
 * with Ctrl/Cmd/Alt, never on another keyboard-focused control or dialog. A press that began somewhere E was not
 * ours stays spent until the key comes up, so leaving a field with E still held cannot fire it.
 * Walking never reads E (walk-camera README, input ownership table).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  if (isEditableTarget(target)) return true;
  return !!(target as Element).closest('[contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
}
/** A focused control other than the prompt itself, showing its keyboard focus ring: E is not for the world then. */
export function isOtherControl(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  if ((target as Element).closest('[data-ix-prompt]')) return false;
  return isKeyboardControl(target);
}
type UseKeyEvent = Pick<KeyboardEvent, 'code' | 'key' | 'repeat' | 'isComposing' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>;
export function isUsePress(event: UseKeyEvent): boolean {
  return event.code === 'KeyE' && !event.repeat && !event.isComposing && event.key !== 'Process'
    && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target) && !isOtherControl(event.target);
}

export interface UseKeyOptions {
  /** Default window. */
  readonly keyboard?: EventTarget;
  /** False means another surface owns E right now (Forge, build mode, a menu): the press is left alone. */
  readonly owned?: () => boolean;
  /** Default document: a hidden page lets go of a held E like a blur does. */
  readonly page?: { readonly hidden: boolean } & EventTarget;
}
/** Listens for the use key. Returns the unbind. */
export function bindUseKey(onUse: () => void, options: UseKeyOptions = {}): () => void {
  const keyboard = options.keyboard ?? window;
  const page = options.page ?? (typeof document === 'undefined' ? undefined : document);
  // Physical E is down: this press is spent, whatever it did (or was refused to do) when it went down.
  let held = false;
  const keydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.code !== 'KeyE') return;
    const fresh = !held && !key.repeat;
    held = true;
    if (!fresh || !isUsePress(key) || options.owned?.() === false) return;
    key.preventDefault();
    onUse();
  };
  const keyup = (event: Event) => { if ((event as KeyboardEvent).code === 'KeyE') held = false; };
  const letGo = () => { held = false; };
  const visibility = () => { if (page?.hidden) held = false; };
  keyboard.addEventListener('keydown', keydown);
  keyboard.addEventListener('keyup', keyup);
  keyboard.addEventListener('blur', letGo);
  page?.addEventListener('visibilitychange', visibility);
  return () => {
    keyboard.removeEventListener('keydown', keydown);
    keyboard.removeEventListener('keyup', keyup);
    keyboard.removeEventListener('blur', letGo);
    page?.removeEventListener('visibilitychange', visibility);
  };
}
