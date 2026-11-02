import type { PlayHost } from '../host';
import { actionCode, bindableCode, DEFAULT_KEYS, PLAY_ACTIONS, type PlaySettingsPatch } from '../settings';
import {
  actionBindings, availableLedgerPages, forgeEntry, onSlotsChanged,
  type CursorLease, type ForgeEntry, type LedgerPageProvider, type PlayAction, type PlaySettings,
} from '../slots';

/**
 * The ledger without its drawing: which pages exist, which one is open, the key being captured, and the order in
 * which Escape peels the layers away. The view only reads this state and calls these verbs, so every rule here is
 * the same for mouse, keyboard and touch, and is tested without a browser.
 */

export interface LedgerTab {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  /** A registered page from another lane; null for the ledger's own pages. */
  readonly provider: LedgerPageProvider | null;
}

/** The ledger's own pages. They are always there; Build says honestly when building is not open. */
export const OWN_PAGES: readonly LedgerTab[] = Object.freeze([
  { id: 'settings', title: 'Settings', order: 10, provider: null },
  { id: 'way-home', title: 'Way home', order: 20, provider: null },
  { id: 'build', title: 'Build', order: 30, provider: null },
  { id: 'help', title: 'Help', order: 90, provider: null },
]);
/**
 * Own pages shown only where they have something real to show (PL12): your card for a signed-in walker, the map
 * where the walk lends one. Never a disabled stand-in.
 */
export const CARD_PAGE: LedgerTab = Object.freeze({ id: 'card', title: 'Your card', order: 15, provider: null });
export const MAP_PAGE: LedgerTab = Object.freeze({ id: 'map', title: 'Map', order: 22, provider: null });
const OWN_IDS = new Set([...OWN_PAGES, CARD_PAGE, MAP_PAGE].map(page => page.id));
/** The ledger's own pages for this walk. */
export function ownPages(play: Pick<PlayHost, 'ctx' | 'map'>): readonly LedgerTab[] {
  const pages = [...OWN_PAGES];
  if (play.ctx.self && play.ctx.mode !== 'stream') pages.push(CARD_PAGE);
  if (play.map) pages.push(MAP_PAGE);
  return pages;
}

/**
 * A key plate: one of play's own actions ('forward', 'jump', ...) or another lane's registered binding, written
 * 'binding:<id>' ('binding:bag'). Play's actions never contain a colon, so the two never meet.
 */
export type KeyTarget = PlayAction | `binding:${string}`;
export const bindingTarget = (id: string): KeyTarget => `binding:${id}`;
export const bindingOf = (target: KeyTarget): string | null => target.startsWith('binding:') ? target.slice(8) : null;

/** What happened to the last key pressed on a capture plate, said in words under the keys. */
export type KeyNote =
  /** Bound. `moved` is a plate that gave its key up: a play action took this plate's old key, a binding is left without one. */
  | { readonly kind: 'bound'; readonly target: KeyTarget; readonly code: string; readonly moved?: KeyTarget }
  /** A key the browser or the ledger keeps (Escape, Tab, the system keys). The plate keeps listening. */
  | { readonly kind: 'reserved'; readonly target: KeyTarget; readonly code: string }
  /** A binding cannot take one of play's own keys; the plate keeps listening. */
  | { readonly kind: 'taken'; readonly target: KeyTarget; readonly code: string; readonly holder: PlayAction }
  | { readonly kind: 'restored' };

export interface LedgerState {
  readonly open: boolean;
  readonly page: string;
  readonly tabs: readonly LedgerTab[];
  /** The Forge as a way out of the ledger: only when forge-wish offers it and registers no page of its own. */
  readonly forge: ForgeEntry | null;
  /** The key plate that is listening, or null. */
  readonly capture: KeyTarget | null;
  readonly note: KeyNote | null;
  /** The last page turn: 1 forward, -1 back; `n` counts turns so the view can play each one. */
  readonly turn: { readonly dir: 1 | -1; readonly n: number };
}

export interface Ledger {
  readonly state: LedgerState;
  subscribe(listener: (state: LedgerState) => void): () => void;
  open(page?: string): void;
  close(): void;
  select(id: string): void;
  /** Keyboard roaming in the contents: the tab an arrow, Home or End lands on, or null for any other key. */
  step(from: string, key: string): string | null;
  /** Closes the top layer: a listening key plate first, then the ledger. True when something closed. */
  escape(): boolean;
  /** Back to the street. Only a trusted click or tap may capture the mouse again. */
  resume(event: { readonly isTrusted: boolean }): boolean;
  openForge(): void;
  openBuild(): void;
  /** Must run inside the click or key press that asked for it, so the browser allows fullscreen. */
  toggleFullscreen(): void;
  /** Write settings through the store (so they apply live and persist) and sound the fitting that moved. */
  change(patch: PlaySettingsPatch, cue: 'wood' | 'brass' | 'parchment'): void;
  beginCapture(target: KeyTarget): void;
  /** A key pressed while a plate listens (KeyboardEvent.code). Escape cancels; a reserved key keeps it listening. */
  pressKey(code: string): KeyNote | 'cancelled' | null;
  cancelCapture(): void;
  restoreKeys(): void;
  /** Re-read the slots (availability can change without a registration, for example when the stream goes live). */
  refresh(): void;
  dispose(): void;
}

const sameTabs = (a: readonly LedgerTab[], b: readonly LedgerTab[]) =>
  a.length === b.length && a.every((tab, i) => tab.id === b[i]!.id && tab.title === b[i]!.title && tab.provider === b[i]!.provider);

export function createLedger(play: PlayHost): Ledger {
  let lease: CursorLease | null = null;
  let remembered = 'settings';
  const listeners = new Set<(state: LedgerState) => void>();
  let state: LedgerState = { open: false, page: 'settings', tabs: ownPages(play), forge: null, capture: null, note: null, turn: { dir: 1, n: 0 } };

  const emit = () => { for (const listener of [...listeners]) listener(state); };
  const put = (patch: Partial<LedgerState>) => { state = { ...state, ...patch }; emit(); };
  const cue = (surface: 'wood' | 'brass' | 'parchment') => { try { play.cue(surface); } catch (error) { console.error('A ledger sound failed', error); } };

  function readTabs(): { tabs: readonly LedgerTab[]; forge: ForgeEntry | null } {
    const registered = availableLedgerPages(play.ctx).filter(page => !OWN_IDS.has(page.id))
      .map(provider => ({ id: provider.id, title: provider.title, order: provider.order, provider }));
    // Own pages first on an equal order, so a page from another lane never pushes Settings out of first place.
    const tabs = [...ownPages(play), ...registered].sort((a, b) => a.order - b.order || (a.provider ? 1 : 0) - (b.provider ? 1 : 0));
    const entry = forgeEntry(play.ctx);
    return { tabs, forge: entry && !tabs.some(tab => tab.id === 'forge') ? entry : null };
  }

  /** The page to keep when the tabs change: the same one, else the nearest earlier page, else the first. */
  function keep(page: string, before: readonly LedgerTab[], after: readonly LedgerTab[]): string {
    if (after.some(tab => tab.id === page)) return page;
    const order = before.find(tab => tab.id === page)?.order ?? Number.NEGATIVE_INFINITY;
    return [...after].reverse().find(tab => tab.order <= order)?.id ?? after[0]!.id;
  }

  function refresh() {
    const next = readTabs();
    if (sameTabs(next.tabs, state.tabs) && next.forge === state.forge) return;
    const page = keep(state.page, state.tabs, next.tabs);
    put({ tabs: next.tabs, forge: next.forge, page });
  }

  const stopSlots = onSlotsChanged(refresh);

  function open(page?: string) {
    if (play.ctx.mode === 'stream') return;
    if (state.open) { if (page) select(page); return; }
    const next = readTabs();
    const wanted = page ?? remembered;
    const chosen = next.tabs.some(tab => tab.id === wanted) ? wanted : next.tabs[0]!.id;
    try { lease = play.ctx.requestCursor('ledger'); } catch (error) { lease = null; console.error('The ledger could not take the cursor', error); }
    cue('wood');
    put({ open: true, page: chosen, tabs: next.tabs, forge: next.forge, capture: null, note: null });
  }

  function close(quiet = false) {
    if (!state.open) return;
    remembered = state.page;
    const held = lease; lease = null;
    put({ open: false, capture: null, note: null });
    try { held?.release(); } catch (error) { console.error('The ledger could not hand the cursor back', error); }
    if (!quiet) cue('wood');
  }

  function select(id: string) {
    if (!state.open || id === state.page) { if (state.capture) cancelCapture(); return; }
    const to = state.tabs.findIndex(tab => tab.id === id);
    if (to < 0) return;
    const from = state.tabs.findIndex(tab => tab.id === state.page);
    cue('parchment');
    put({ page: id, capture: null, note: null, turn: { dir: to >= from ? 1 : -1, n: state.turn.n + 1 } });
  }

  function step(from: string, key: string): string | null {
    const ids = state.tabs.map(tab => tab.id), at = Math.max(0, ids.indexOf(from)), last = ids.length - 1;
    switch (key) {
      case 'ArrowDown': case 'ArrowRight': return ids[at === last ? 0 : at + 1]!;
      case 'ArrowUp': case 'ArrowLeft': return ids[at === 0 ? last : at - 1]!;
      case 'Home': return ids[0]!;
      case 'End': return ids[last]!;
      default: return null;
    }
  }

  function cancelCapture() {
    if (!state.capture) return;
    cue('brass');
    put({ capture: null });
  }

  function escape(): boolean {
    if (state.capture) { cancelCapture(); return true; }
    if (state.open) { close(); return true; }
    return false;
  }

  function resume(event: { readonly isTrusted: boolean }): boolean {
    if (!event || event.isTrusted !== true) return false;
    close();
    play.resume(event);
    return true;
  }

  /** Leave the ledger for another panel: hand over first, so the cursor passes straight from one lease to the next. */
  function leaveFor(go: () => void) {
    try { go(); } catch (error) { console.error('That panel could not open', error); return; }
    close();
  }

  /** A slider dragged across many stops ticks at most every 45 ms, so a fast drag rings like a ratchet, not a buzz. */
  let lastTick = Number.NEGATIVE_INFINITY;
  function change(patch: PlaySettingsPatch, surface: 'wood' | 'brass' | 'parchment') {
    const before: Readonly<PlaySettings> = play.settings.current;
    if (play.settings.set(patch) === before) return;
    if (surface !== 'brass') { cue(surface); return; }
    const now = Date.now();
    if (now - lastTick >= 45) { cue(surface); lastTick = now; }
  }

  const knownTarget = (target: KeyTarget) => {
    const id = bindingOf(target);
    return id === null ? PLAY_ACTIONS.includes(target as PlayAction) : actionBindings().some(binding => binding.id === id);
  };

  function beginCapture(target: KeyTarget) {
    if (!state.open || !knownTarget(target)) return;
    if (state.capture === target) { cancelCapture(); return; }
    cue('brass');
    put({ capture: target, note: null });
  }

  function pressKey(code: string): KeyNote | 'cancelled' | null {
    const target = state.capture;
    if (!target) return null;
    if (code === 'Escape') { cancelCapture(); return 'cancelled'; }
    const listen = (note: KeyNote) => { cue('brass'); put({ note }); return note; };
    if (!bindableCode(code)) return listen({ kind: 'reserved', target, code });
    const before = play.settings.current, bindings = actionBindings();
    const boundTo = (b: { readonly id: string; readonly defaultCode: string }) => actionCode(before, b);
    const id = bindingOf(target);
    let moved: KeyTarget | undefined;
    if (id === null) {
      const action = target as PlayAction;
      if (before.keys[action] === code) { cue('wood'); const note: KeyNote = { kind: 'bound', target, code }; put({ capture: null, note }); return note; }
      // A play action that held the key swaps to this plate's old key; a binding that held it is left needing one.
      const swapped = PLAY_ACTIONS.find(other => other !== action && before.keys[other] === code);
      const displaced = bindings.find(binding => boundTo(binding) === code);
      if (!play.settings.bind(action, code)) return listen({ kind: 'reserved', target, code });
      moved = swapped ?? (displaced ? bindingTarget(displaced.id) : undefined);
    } else {
      const holder = PLAY_ACTIONS.find(action => before.keys[action] === code);
      if (holder) return listen({ kind: 'taken', target, code, holder });
      const displaced = bindings.find(binding => binding.id !== id && boundTo(binding) === code);
      const defaults = Object.fromEntries(bindings.map(binding => [binding.id, binding.defaultCode]));
      if (!play.settings.bindAction(id, code, defaults)) return listen({ kind: 'reserved', target, code });
      moved = displaced ? bindingTarget(displaced.id) : undefined;
    }
    const note: KeyNote = moved ? { kind: 'bound', target, code, moved } : { kind: 'bound', target, code };
    cue('wood');
    put({ capture: null, note });
    return note;
  }

  function restoreKeys() {
    const note: KeyNote = { kind: 'restored' };
    const before = play.settings.current;
    play.settings.set({ keys: DEFAULT_KEYS, actionKeys: {} });
    cue(play.settings.current === before ? 'brass' : 'wood');
    put({ capture: null, note });
  }

  return {
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    open, close: () => close(), select, step, escape, resume, refresh, change, beginCapture, pressKey, cancelCapture, restoreKeys,
    toggleFullscreen() { if (!play.cursor.canFullscreen) return; cue('brass'); play.toggleFullscreen(); },
    openForge() { const entry = state.forge; if (entry) leaveFor(() => entry.openForge({ from: 'ledger', ctx: play.ctx })); },
    openBuild() { const go = play.build.open; if (go) leaveFor(go); },
    dispose() { stopSlots(); close(true); listeners.clear(); },
  };
}
