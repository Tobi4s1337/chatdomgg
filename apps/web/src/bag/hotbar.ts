import type { ItemRecord } from '@chatdom/shared';
import './bag.css';
import { el, reducedMotion, type BagSound } from './dom';
import { groupOf, titleOf } from './kinds';
import { paintItemPortrait } from './portrait';
import type { BagStore } from './store';

export interface HotbarOptions {
  selected(): string | null;
  onSelect(itemId: string | null): void;
  readonly compact: boolean;
  readonly sound?: BagSound;
  /**
   * Moves a belt tool to another belt place (0..8); a tool already there takes its old place. Without it the belt
   * cannot be rearranged. Resolves with the kingdom's words when it refuses.
   */
  arrange?(itemId: string, slot: number): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** A few words after the tool's name for its key's label, as "34 fish landed". */
  note?(item: ItemRecord): string | null;
}
export interface Hotbar {
  refresh(): void;
  /** Chooses the tool under key 1..9, as its number key does; choosing the chosen tool puts it down. False when the key is empty. */
  press(key: number): boolean;
  dispose(): void;
}

export const HOTBAR_SLOTS = 9;
const SLOTS = HOTBAR_SLOTS;
const DRAG_PX = 6, HOLD_MS = 320, HOLD_SLOP_PX = 9, NOTE_MS = 4200;

interface Slot { readonly key: number; readonly item: ItemRecord }
interface Cell { readonly button: HTMLButtonElement; readonly canvas: HTMLCanvasElement; readonly number: HTMLElement; item: ItemRecord; key: number }
interface Drag { readonly cell: Cell; readonly pointerId: number; readonly x: number; readonly y: number; live: boolean; target: number; hold: ReturnType<typeof setTimeout> | null }

/** Tools on the belt and in the hand, keyed 1 to 9 by their belt place. A tool in hand takes the first free key. */
export function hotbarSlots(items: readonly ItemRecord[]): readonly Slot[] {
  const belt = items.filter(item => groupOf(item) === 'tools' && item.place === 'hotbar' && item.slot !== null && item.slot >= 0 && item.slot < SLOTS)
    .sort((a, b) => a.slot! - b.slot! || (a.id < b.id ? -1 : 1));
  const taken = new Set<number>(), slots: Slot[] = [];
  for (const item of belt) if (!taken.has(item.slot!)) { taken.add(item.slot!); slots.push({ key: item.slot! + 1, item }); }
  for (const item of items.filter(entry => groupOf(entry) === 'tools' && entry.place === 'hand')) {
    let key = 1;
    while (taken.has(key - 1) && key <= SLOTS) key++;
    if (key > SLOTS) break;
    taken.add(key - 1); slots.push({ key, item });
  }
  return slots.sort((a, b) => a.key - b.key);
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement);

/**
 * The hotbar: a small, quiet carved rail at the bottom centre of the HUD with the tools the person owns on their belt
 * or in hand; with nothing owned there is no rail at all. Digit1 to Digit9 or a tap chooses; choosing the chosen tool
 * again puts it down. With `arrange`, a belt tool is dragged to another place (a mouse drags at once, a finger after a
 * short hold), or moved with Shift and an arrow key; while it moves, all nine places show so any of them can take it.
 * The host should be the positioned HUD layer; the rail places itself at its bottom centre and never takes pointer
 * events outside itself.
 */
export function mountHotbar(host: HTMLElement, store: BagStore, options: HotbarOptions): Hotbar {
  let disposed = false, drag: Drag | null = null, swallowClick = false, noteTimer: ReturnType<typeof setTimeout> | null = null, moving = false;
  const cells = new Map<string, Cell>();
  const size = options.compact ? 40 : 34;
  const root = el('div', 'cdh cd-kit');
  root.dataset.compact = String(options.compact);
  const bar = el('div', 'cdh-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', options.arrange ? 'Your belt. Shift and an arrow key moves a tool.' : 'Your belt');
  const note = el('p', 'cdh-note');
  note.setAttribute('role', 'status');
  note.hidden = true;
  root.append(note, bar);
  root.hidden = true;
  // The nine places, shown only while a tool is being moved.
  const sockets = Array.from({ length: SLOTS }, (_, index) => {
    const socket = el('span', 'cdh-slot cdh-empty');
    socket.setAttribute('aria-hidden', 'true');
    socket.append(el('span', 'cdh-socket'), el('span', 'cdh-key', String(index + 1)));
    return socket;
  });

  const say = (words: string) => {
    note.textContent = words; note.hidden = false;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; noteTimer = null; }, NOTE_MS);
  };

  const choose = (itemId: string) => {
    const next = options.selected() === itemId ? null : itemId;
    options.sound?.(next ? 'brass' : 'wood');
    options.onSelect(next);
    paint();
  };

  const movable = (cell: Cell) => !!options.arrange && cell.item.place === 'hotbar' && cell.item.slot !== null;
  /** Ask the kingdom to move a belt tool; the rail redraws from the bag when the move is pushed back. */
  const move = async (cell: Cell, slot: number) => {
    if (!options.arrange || moving || slot === cell.item.slot || slot < 0 || slot >= SLOTS) return;
    moving = true; root.dataset.moving = 'true';
    options.sound?.('wood');
    try {
      const result = await options.arrange(cell.item.id, slot);
      if (disposed) return;
      if (!result.ok) say(result.message);
      else say(`${titleOf(cell.item.defId)} now answers to ${slot + 1}.`);
    } catch {
      if (!disposed) say('The kingdom could not move it just now.');
    } finally {
      moving = false; delete root.dataset.moving;
    }
  };

  const make = (slot: Slot): Cell => {
    const button = el('button', 'cdh-slot cd-focus');
    button.type = 'button';
    const socket = el('span', 'cdh-socket');
    const canvas = el('canvas', 'cdh-portrait');
    canvas.setAttribute('aria-hidden', 'true');
    socket.append(canvas);
    const number = el('span', 'cdh-key');
    number.setAttribute('aria-hidden', 'true');
    button.append(socket, number);
    const cell: Cell = { button, canvas, number, item: slot.item, key: slot.key };
    button.addEventListener('click', event => {
      if (swallowClick) { swallowClick = false; event.preventDefault(); return; }
      choose(cell.item.id);
    });
    button.addEventListener('pointerdown', event => startDrag(cell, event));
    button.addEventListener('keydown', event => onCellKey(cell, event));
    void paintItemPortrait(canvas, slot.item.defId, size).then(drawn => { socket.dataset.portrait = drawn ? 'drawn' : 'empty'; });
    return cell;
  };

  const paint = () => {
    const chosen = options.selected();
    for (const cell of cells.values()) {
      const on = cell.item.id === chosen;
      if (cell.button.getAttribute('aria-pressed') === String(on)) continue;
      cell.button.setAttribute('aria-pressed', String(on));
      if (on && !reducedMotion() && typeof cell.button.animate === 'function') {
        cell.button.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(-4px)' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      }
    }
  };

  /** The rail's children in order: the tools alone at rest; every place, filled or empty, while one moves. */
  const layout = () => {
    const ordered = [...cells.values()].sort((a, b) => a.key - b.key);
    const wanted: HTMLElement[] = [];
    if (drag?.live) {
      for (let index = 0; index < SLOTS; index++) {
        const there = ordered.find(cell => cell.key === index + 1);
        const node = there?.button ?? sockets[index]!;
        node.dataset.target = String(drag.target === index);
        wanted.push(node);
      }
    } else for (const cell of ordered) { delete cell.button.dataset.target; wanted.push(cell.button); }
    wanted.forEach((node, index) => { if (bar.children[index] !== node) bar.insertBefore(node, bar.children[index] ?? null); });
    while (bar.children.length > wanted.length) bar.lastElementChild!.remove();
  };

  const refresh = () => {
    if (disposed) return;
    const slots = hotbarSlots(store.items());
    const live = new Set(slots.map(slot => slot.item.id));
    for (const [id, cell] of cells) if (!live.has(id)) {
      if (drag?.cell === cell) endDrag(false);
      cell.button.remove(); cells.delete(id);
    }
    for (const slot of slots) {
      let cell = cells.get(slot.item.id);
      if (!cell) { cell = make(slot); cells.set(slot.item.id, cell); }
      if (cell.item.defId !== slot.item.defId) {
        void paintItemPortrait(cell.canvas, slot.item.defId, size);
      }
      cell.item = slot.item; cell.key = slot.key;
      cell.button.dataset.itemId = slot.item.id;
      cell.button.dataset.place = slot.item.place;
      cell.button.dataset.movable = String(movable(cell));
      cell.number.textContent = String(slot.key);
      const where = slot.item.place === 'hand' ? 'in hand' : 'on your belt';
      const extra = options.note?.(slot.item);
      cell.button.setAttribute('aria-label', `${titleOf(slot.item.defId)}${extra ? `, ${extra}` : ''}, ${where}, key ${slot.key}`);
      cell.button.setAttribute('aria-keyshortcuts', String(slot.key));
    }
    layout();
    root.hidden = slots.length === 0;
    paint();
  };

  // Dragging: the pressed tool lifts and follows the pointer along the rail; the place under it is the target.
  const targetAt = (x: number): number => {
    let best = drag?.target ?? 0, distance = Infinity;
    for (let index = 0; index < SLOTS; index++) {
      const node = [...cells.values()].find(cell => cell.key === index + 1)?.button ?? sockets[index]!;
      const box = node.getBoundingClientRect();
      const d = Math.abs(box.left + box.width / 2 - x);
      if (d < distance) { distance = d; best = index; }
    }
    return best;
  };
  const lift = () => {
    if (!drag || drag.live) return;
    drag.live = true; drag.target = drag.cell.item.slot ?? 0;
    root.dataset.dragging = 'true'; drag.cell.button.dataset.lifted = 'true';
    try { drag.cell.button.setPointerCapture(drag.pointerId); } catch { /* the pointer already left */ }
    options.sound?.('brass');
    layout();
  };
  const startDrag = (cell: Cell, event: PointerEvent) => {
    if (!movable(cell) || moving || event.button !== 0 || drag) return;
    drag = { cell, pointerId: event.pointerId, x: event.clientX, y: event.clientY, live: false, target: cell.item.slot ?? 0, hold: null };
    // A finger lifts the tool after a short, still hold, so a quick tap still chooses it.
    if (event.pointerType === 'touch') drag.hold = setTimeout(() => { if (drag?.cell === cell) { drag.hold = null; lift(); } }, HOLD_MS);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.live) {
      if (drag.hold) { if (Math.hypot(dx, dy) > HOLD_SLOP_PX) { clearTimeout(drag.hold); drag = null; } return; }
      if (Math.hypot(dx, dy) < DRAG_PX) return;
      lift();
    }
    if (!drag?.live) return;
    event.preventDefault();
    drag.cell.button.style.translate = `${dx}px ${Math.min(0, dy) * .35 - 8}px`;
    const target = targetAt(event.clientX);
    if (target !== drag.target) { drag.target = target; layout(); }
  };
  const endDrag = (commit: boolean) => {
    const current = drag;
    if (!current) return;
    drag = null;
    if (current.hold) clearTimeout(current.hold);
    if (!current.live) return;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    current.cell.button.style.translate = '';
    delete current.cell.button.dataset.lifted; delete root.dataset.dragging;
    layout();
    if (commit) void move(current.cell, current.target);
  };
  const onPointerUp = (event: PointerEvent) => { if (drag && event.pointerId === drag.pointerId) endDrag(true); };
  const onPointerCancel = (event: PointerEvent) => { if (drag && event.pointerId === drag.pointerId) endDrag(false); };
  const onContext = (event: Event) => { if (drag) event.preventDefault(); };

  const onCellKey = (cell: Cell, event: KeyboardEvent) => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); endDrag(false); return; }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    event.preventDefault();
    if (event.shiftKey && movable(cell)) { void move(cell, Math.max(0, Math.min(SLOTS - 1, cell.item.slot! + step))); return; }
    // Plain arrows walk along the rail.
    const ordered = [...cells.values()].sort((a, b) => a.key - b.key);
    const next = ordered[ordered.indexOf(cell) + step];
    next?.button.focus();
  };

  const press = (key: number) => {
    for (const cell of cells.values()) if (cell.key === key) { choose(cell.item.id); return true; }
    return false;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    const match = /^Digit([1-9])$/.exec(event.code);
    if (!match) return;
    if (press(Number(match[1]))) event.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  bar.addEventListener('contextmenu', onContext);
  const unsubscribe = store.subscribe(refresh);
  host.append(root);
  refresh();

  return {
    refresh,
    press,
    dispose() {
      if (disposed) return;
      disposed = true;
      endDrag(false);
      if (noteTimer) clearTimeout(noteTimer);
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      root.remove();
    },
  };
}
