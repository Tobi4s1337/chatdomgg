/**
 * E means this one action. One non-repeating press, never while typing, composing text, holding a modifier or
 * using an unrelated focused control. Walking never reads E (walk-camera README, input ownership table).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return !!element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"]');
}
export function isUsePress(event: Pick<KeyboardEvent, 'code' | 'repeat' | 'isComposing' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>): boolean {
  return event.code === 'KeyE' && !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target);
}
/** Listens for the use key on `keyboard` (default window). `owned()` false means another surface owns E right now. */
export function bindUseKey(onUse: () => void, options: { readonly keyboard?: EventTarget; readonly owned?: () => boolean } = {}): () => void {
  const keyboard = options.keyboard ?? window;
  const keydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (!isUsePress(key) || options.owned?.() === false) return;
    key.preventDefault();
    onUse();
  };
  keyboard.addEventListener('keydown', keydown);
  return () => keyboard.removeEventListener('keydown', keydown);
}
