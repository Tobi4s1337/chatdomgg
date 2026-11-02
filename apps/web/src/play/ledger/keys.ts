/**
 * The printed name of a key from its KeyboardEvent.code. Where the browser can read the keyboard's layout
 * (Chromium's Keyboard Map), letters and marks follow the keys actually printed on it, so an AZERTY board shows Z
 * where QWERTY shows W. Everything else has a fixed English name.
 */

export type KeyLayout = ReadonlyMap<string, string>;

const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Cmd', MetaRight: 'Right Cmd', Enter: 'Enter', Backspace: 'Backspace',
  Escape: 'Esc', Tab: 'Tab', CapsLock: 'Caps Lock', ArrowUp: 'Up arrow', ArrowDown: 'Down arrow', ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter', NumpadEqual: 'Num =', ContextMenu: 'Menu',
};

/** Codes whose printed mark depends on the layout. */
const PRINTED = /^(Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|IntlBackslash|Semicolon|Quote|Comma|Period|Slash)$/;

export function keyName(code: string, layout?: KeyLayout | null): string {
  if (!code) return '';
  if (layout && PRINTED.test(code)) {
    const mark = layout.get(code);
    if (mark && mark.trim() && [...mark].length === 1) return mark.toLocaleUpperCase();
  }
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED[code] ?? code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Read the keyboard's layout where the browser offers it; null elsewhere (Firefox, Safari) or when refused. */
export async function readKeyLayout(): Promise<KeyLayout | null> {
  try {
    const keyboard = (globalThis.navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<KeyLayout> } } | undefined)?.keyboard;
    return keyboard?.getLayoutMap ? await keyboard.getLayoutMap() : null;
  } catch { return null; }
}
