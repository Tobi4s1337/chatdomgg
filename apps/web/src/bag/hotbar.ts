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
}
export interface Hotbar { refresh(): void; dispose(): void }

const SLOTS = 9;

interface Slot { readonly key: number; readonly item: ItemRecord }
interface Cell { readonly button: HTMLButtonElement; readonly canvas: HTMLCanvasElement; readonly number: HTMLElement; item: ItemRecord; key: number }

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
 * or in hand. Digit1 to Digit9 or a tap chooses; choosing the chosen tool again puts it down. The host should be the
 * positioned HUD layer; the rail places itself at its bottom centre and never takes pointer events outside itself.
 */
export function mountHotbar(host: HTMLElement, store: BagStore, options: HotbarOptions): Hotbar {
  let disposed = false;
  const cells = new Map<string, Cell>();
  const size = options.compact ? 40 : 34;
  const root = el('div', 'cdh cd-kit');
  root.dataset.compact = String(options.compact);
  const bar = el('div', 'cdh-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Your belt');
  root.append(bar);
  root.hidden = true;

  const choose = (itemId: string) => {
    const next = options.selected() === itemId ? null : itemId;
    options.sound?.(next ? 'brass' : 'wood');
    options.onSelect(next);
    paint();
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
    button.addEventListener('click', () => choose(button.dataset.itemId!));
    void paintItemPortrait(canvas, slot.item.defId, size).then(drawn => { socket.dataset.portrait = drawn ? 'drawn' : 'empty'; });
    return { button, canvas, number, item: slot.item, key: slot.key };
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

  const refresh = () => {
    if (disposed) return;
    const slots = hotbarSlots(store.items());
    const live = new Set(slots.map(slot => slot.item.id));
    for (const [id, cell] of cells) if (!live.has(id)) { cell.button.remove(); cells.delete(id); }
    slots.forEach((slot, index) => {
      let cell = cells.get(slot.item.id);
      if (!cell) { cell = make(slot); cells.set(slot.item.id, cell); }
      if (cell.item.defId !== slot.item.defId) {
        void paintItemPortrait(cell.canvas, slot.item.defId, size);
      }
      cell.item = slot.item; cell.key = slot.key;
      cell.button.dataset.itemId = slot.item.id;
      cell.button.dataset.place = slot.item.place;
      cell.number.textContent = String(slot.key);
      const where = slot.item.place === 'hand' ? 'in hand' : 'on your belt';
      cell.button.setAttribute('aria-label', `${titleOf(slot.item.defId)}, ${where}, key ${slot.key}`);
      cell.button.setAttribute('aria-keyshortcuts', String(slot.key));
      if (bar.children[index] !== cell.button) bar.insertBefore(cell.button, bar.children[index] ?? null);
    });
    root.hidden = slots.length === 0;
    paint();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    const match = /^Digit([1-9])$/.exec(event.code);
    if (!match) return;
    const key = Number(match[1]);
    for (const cell of cells.values()) if (cell.key === key) { event.preventDefault(); choose(cell.item.id); return; }
  };
  window.addEventListener('keydown', onKey);
  const unsubscribe = store.subscribe(refresh);
  host.append(root);
  refresh();

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
