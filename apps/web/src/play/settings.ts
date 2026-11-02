import type { PlayAction, PlaySettings, PlaySettingsReader } from './slots';

/**
 * Per-device play settings. Sensitivity, volumes and keys belong to the hands and the speakers in front of this
 * screen, so they live in local storage; the look and everything about the person live on the server. Every value
 * is clamped on the way in and on the way out of storage, so a hand-edited or older record can never break play.
 */

export const PLAY_SETTINGS_KEY = 'chatdom.play.settings.v1';

export const PLAY_ACTIONS: readonly PlayAction[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'use', 'view', 'ledger', 'fullscreen'];

export const DEFAULT_KEYS: Readonly<Record<PlayAction, string>> = Object.freeze({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft',
  use: 'KeyE', view: 'KeyV', ledger: 'KeyP', fullscreen: 'KeyF',
});

/** Keys that can never be bound: the browser, the ledger's own Escape, and modifiers that change meaning. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['Escape', 'Tab', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'ContextMenu', 'F5', 'F11', 'F12', 'CapsLock', 'NumLock', 'ScrollLock', 'PrintScreen', 'Pause']);

export const DEFAULT_PLAY_SETTINGS: Readonly<PlaySettings> = Object.freeze({
  view: 'third', sensitivity: 1, invertY: false, fov: 74,
  volume: Object.freeze({ master: .9, world: .8, voice: .9, interface: .7 }),
  labels: 'all', bubbles: 'all', reducedMotion: false, keys: DEFAULT_KEYS, actionKeys: Object.freeze({}),
});

export const SETTING_LIMITS = { sensitivity: [.25, 4], fov: [55, 90] } as const;

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback;

/** A key a person may bind: a real KeyboardEvent.code that is not reserved. */
export function bindableCode(code: unknown): code is string {
  return typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9A-Za-z]+|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Enter|Backspace|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|F([1-9]|10)|Insert|Delete|Home|End|PageUp|PageDown|IntlBackslash)$/.test(code)
    && !RESERVED_CODES.has(code);
}

/** Every action keeps a key; a duplicate falls back to its default, and a default already taken is left unbound. */
function normaliseKeys(value: unknown): Readonly<Record<PlayAction, string>> {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const keys = {} as Record<PlayAction, string>, used = new Set<string>();
  for (const action of PLAY_ACTIONS) {
    const wanted = input[action];
    if (bindableCode(wanted) && !used.has(wanted)) { keys[action] = wanted; used.add(wanted); }
  }
  for (const action of PLAY_ACTIONS) {
    if (keys[action]) continue;
    const fallback = DEFAULT_KEYS[action];
    keys[action] = used.has(fallback) ? '' : fallback;
    if (keys[action]) used.add(fallback);
  }
  return Object.freeze(keys);
}

/** The single parser for anything that claims to be play settings. Unknown fields are dropped. */
export function normalisePlaySettings(value: unknown): Readonly<PlaySettings> {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const volume = input.volume && typeof input.volume === 'object' ? input.volume as Record<string, unknown> : {};
  const base = DEFAULT_PLAY_SETTINGS;
  return Object.freeze({
    view: oneOf(input.view, ['third', 'first'] as const, base.view),
    sensitivity: clamp(input.sensitivity, ...SETTING_LIMITS.sensitivity, base.sensitivity),
    invertY: typeof input.invertY === 'boolean' ? input.invertY : base.invertY,
    fov: clamp(input.fov, ...SETTING_LIMITS.fov, base.fov),
    volume: Object.freeze({
      master: clamp(volume.master, 0, 1, base.volume.master), world: clamp(volume.world, 0, 1, base.volume.world),
      voice: clamp(volume.voice, 0, 1, base.volume.voice), interface: clamp(volume.interface, 0, 1, base.volume.interface),
    }),
    labels: oneOf(input.labels, ['all', 'nearby', 'few'] as const, base.labels),
    bubbles: oneOf(input.bubbles, ['all', 'nearby', 'few'] as const, base.bubbles),
    reducedMotion: typeof input.reducedMotion === 'boolean' ? input.reducedMotion : base.reducedMotion,
    keys: normaliseKeys(input.keys),
    actionKeys: normaliseActionKeys(input.actionKeys),
  });
}

const ACTION_ID = /^[a-z][a-z0-9.-]{0,39}$/;
function normaliseActionKeys(value: unknown): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}, used = new Set<string>();
  if (value && typeof value === 'object') {
    for (const [id, code] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
      if (ACTION_ID.test(id) && (code === '' || (bindableCode(code) && !used.has(code)))) { out[id] = code as string; if (code) used.add(code as string); }
    }
  }
  return Object.freeze(out);
}

/**
 * The key another lane's binding answers to: the person's choice, or its default. Play's own keys win: a code they
 * hold leaves the binding unbound (''), and the controls page shows it as needing a key.
 */
export function actionCode(settings: Pick<PlaySettings, 'keys' | 'actionKeys'>, binding: { readonly id: string; readonly defaultCode: string }): string {
  const code = settings.actionKeys[binding.id] ?? binding.defaultCode;
  if (!bindableCode(code)) return '';
  return Object.values(settings.keys).includes(code) ? '' : code;
}

export type PlaySettingsPatch = { readonly [K in keyof PlaySettings]?: K extends 'volume' ? Partial<PlaySettings['volume']> : K extends 'keys' ? Partial<PlaySettings['keys']> : K extends 'actionKeys' ? Readonly<Record<string, string>> : PlaySettings[K] };

export interface PlaySettingsStore extends PlaySettingsReader {
  readonly current: Readonly<PlaySettings>;
  /** Merge, clamp, save and tell every listener at once, so a change applies live. */
  set(patch: PlaySettingsPatch): Readonly<PlaySettings>;
  /** Bind `action` to `code`; an action that held `code` before swaps to this action's old key. */
  bind(action: PlayAction, code: string): boolean;
  /**
   * Bind another lane's binding (by id) to `code`. Refused when one of play's own keys holds it; another binding that
   * held it is left unbound. `defaults` are the registered bindings' default codes, so a default holder is seen too.
   */
  bindAction(id: string, code: string, defaults?: Readonly<Record<string, string>>): boolean;
  reset(): void;
}

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** The operating system's reduced-motion wish is the first value a new device sees. */
function systemReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function createPlaySettings(storage: StorageLike | null = defaultStorage()): PlaySettingsStore {
  let saved: unknown;
  try { const raw = storage?.getItem(PLAY_SETTINGS_KEY); saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  let current = normalisePlaySettings(saved ?? { reducedMotion: systemReducedMotion() });
  const listeners = new Set<(settings: Readonly<PlaySettings>) => void>();
  const commit = (next: Readonly<PlaySettings>) => {
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    current = next;
    try { storage?.setItem(PLAY_SETTINGS_KEY, JSON.stringify(current)); } catch { /* a full or private store keeps this session's value */ }
    for (const listener of [...listeners]) { try { listener(current); } catch (error) { console.error('A play setting listener failed', error); } }
    return current;
  };
  return {
    get current() { return current; },
    get(key) { return current[key]; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(patch) {
      return commit(normalisePlaySettings({ ...current, ...patch,
        volume: { ...current.volume, ...(patch.volume ?? {}) }, keys: { ...current.keys, ...(patch.keys ?? {}) } }));
    },
    bind(action, code) {
      if (!PLAY_ACTIONS.includes(action) || !bindableCode(code)) return false;
      const keys: Record<PlayAction, string> = { ...current.keys };
      const holder = PLAY_ACTIONS.find(other => other !== action && keys[other] === code);
      if (holder) keys[holder] = keys[action];
      keys[action] = code;
      commit(normalisePlaySettings({ ...current, keys }));
      return current.keys[action] === code;
    },
    bindAction(id, code, defaults = {}) {
      if (!ACTION_ID.test(id) || !bindableCode(code) || Object.values(current.keys).includes(code)) return false;
      const actionKeys: Record<string, string> = { ...current.actionKeys };
      for (const other of new Set([...Object.keys(actionKeys), ...Object.keys(defaults)])) {
        if (other !== id && (actionKeys[other] ?? defaults[other]) === code) actionKeys[other] = '';
      }
      actionKeys[id] = code;
      commit(normalisePlaySettings({ ...current, actionKeys }));
      return current.actionKeys[id] === code;
    },
    reset() { commit(normalisePlaySettings({ reducedMotion: systemReducedMotion() })); },
  };
}

let shared: PlaySettingsStore | null = null;
/** One store per page, so the ledger, the walk and every slot read the same values. */
export function sharedPlaySettings(): PlaySettingsStore { return shared ??= createPlaySettings(); }
