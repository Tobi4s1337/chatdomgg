import type { ItemRecord } from '@chatdom/shared';
import './bag.css';
import { mountItemCard, type ItemCardOptions } from './card';
import { el, reducedMotion, SEAL_MARKUP, svg, type BagSound } from './dom';
import { compareItems, GROUP_TITLES, groupOf, isFish, titleOf, type BagGroup } from './kinds';
import { paintItemPortrait } from './portrait';
import type { BagStore } from './store';
import { formatKinds } from './words';

export interface BagOptions {
  readonly viewerPersonId?: string;
  /** Phone layout: the card opens as a sheet over the grid instead of beside it. */
  readonly compact: boolean;
  readonly onClose?: () => void;
  /** Opens this thing's card as soon as it is in the bag. */
  readonly openItemId?: string;
  readonly sound?: BagSound;
  /** Facts another part of the kingdom knows about one of your things, shown on its card. */
  readonly facts?: ItemCardOptions['facts'];
}

const GROUPS: readonly BagGroup[] = ['tools', 'catch', 'keepsakes', 'other'];
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const REFUSAL_MS = 6000;

interface Tile { readonly button: HTMLButtonElement; readonly canvas: HTMLCanvasElement; item: ItemRecord }

function placeTag(item: ItemRecord): string {
  if (item.place === 'hand') return 'In hand';
  if (item.place === 'hotbar' && item.slot !== null) return `Belt ${item.slot + 1}`;
  if (item.place === 'away') return 'Put away';
  if (item.place === 'shelf') return 'On the shelf';
  return '';
}

function tileLabel(item: ItemRecord): string {
  const parts = [titleOf(item.defId)];
  if (item.count > 1) parts.push(`${item.count} in your bag`);
  if (item.storied) parts.push('kept for good');
  const tag = placeTag(item);
  if (tag) parts.push(tag.toLowerCase());
  return parts.join(', ');
}

function tally(items: readonly ItemRecord[]): string {
  let tools = 0, fish = 0, keepsakes = 0, other = 0;
  for (const item of items) {
    const group = groupOf(item);
    if (group === 'tools') tools++;
    else if (group === 'keepsakes') keepsakes++;
    else if (group === 'catch' && isFish(item.defId)) fish += item.count;
    else other += item.count;
  }
  return formatKinds([{ count: tools, one: 'tool', many: 'tools' }, { count: fish, one: 'fish', many: 'fish' },
    { count: keepsakes, one: 'keepsake', many: 'keepsakes' }, { count: other, one: 'other thing', many: 'other things' }]);
}

/**
 * The bag: a stitched leather satchel with each thing drawn as its own lit render. Choosing one opens its tag beside
 * the satchel, or as a sheet over it on a phone. Arrow keys move, Enter opens, Escape closes the tag and then the bag.
 */
export function mountBag(host: HTMLElement, store: BagStore, options: BagOptions): () => void {
  const compact = options.compact;
  const tileSize = compact ? 60 : 72;
  const mountedAt = Date.now();
  let disposed = false;
  let selected: string | null = null;
  let pendingOpen = options.openItemId ?? null;
  let focusId: string | null = null;
  let closeCard: (() => void) | null = null;
  let shownRevision = -1;
  let refusalTimer: ReturnType<typeof setTimeout> | null = null;
  let shownRefusal: string | null = null;
  const tiles = new Map<string, Tile>();
  const running = new Set<Animation>();

  const root = el('section', 'cdb cd-kit');
  root.dataset.compact = String(compact);
  root.dataset.card = 'closed';
  root.setAttribute('aria-label', 'Your bag');
  const satchel = el('div', 'cdb-satchel');
  const flap = el('header', 'cdb-flap');
  const titles = el('div', 'cdb-flap-titles');
  const title = el('h2', 'cdb-title', 'Your bag');
  const count = el('p', 'cdb-tally');
  titles.append(title, count);
  flap.append(titles);
  if (options.onClose) {
    const close = el('button', 'cdb-close cd-focus');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close your bag');
    close.append(svg('cdb-close-mark', '0 0 20 20', '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'));
    close.addEventListener('click', () => { options.sound?.('brass'); leave(); });
    flap.append(close);
  }
  const buckle = el('span', 'cdb-buckle');
  buckle.setAttribute('aria-hidden', 'true');
  buckle.append(el('span', 'cdb-buckle-pin'));
  flap.append(buckle);
  const pocket = el('div', 'cdb-pocket');
  const groups = el('div', 'cdb-groups');
  const note = el('div', 'cdb-note');
  note.setAttribute('role', 'status');
  const refusal = el('p', 'cdb-refusal');
  refusal.setAttribute('role', 'status');
  refusal.hidden = true;
  pocket.append(groups, note);
  satchel.append(flap, pocket, refusal);
  root.append(satchel);

  const side = el('div', compact ? 'cdb-sheet' : 'cdb-side');
  const scrim = el('div', 'cdb-scrim');
  const sheetBody = el('div', 'cdb-sheet-body');
  if (compact) {
    sheetBody.setAttribute('role', 'dialog');
    sheetBody.setAttribute('aria-modal', 'true');
    side.append(scrim, sheetBody);
    scrim.addEventListener('click', () => hideCard(true));
  }

  const groupNodes = new Map<BagGroup, { section: HTMLElement; list: HTMLUListElement }>();
  for (const group of GROUPS) {
    const section = el('section', 'cdb-group');
    section.dataset.group = group;
    const heading = el('h3', 'cdb-group-title', GROUP_TITLES[group]);
    const list = el('ul', 'cdb-grid');
    list.setAttribute('role', 'list');
    section.append(heading, list);
    section.hidden = true;
    groups.append(section);
    groupNodes.set(group, { section, list });
  }

  /** Leaving motions hold their last frame until the leaving is finished and they are cancelled. */
  const exiting = new Set<Animation>();
  const animate = (node: Element, frames: Keyframe[], duration: number, leaving = false): Animation | null => {
    if (reducedMotion() || typeof node.animate !== 'function') return null;
    const animation = node.animate(frames, { duration, easing: EASE, fill: leaving ? 'forwards' : 'none' });
    if (leaving) exiting.add(animation);
    running.add(animation);
    const end = () => running.delete(animation);
    animation.onfinish = end; animation.oncancel = end;
    return animation;
  };

  const ordered = (): HTMLButtonElement[] => {
    const out: HTMLButtonElement[] = [];
    for (const group of GROUPS) for (const node of groupNodes.get(group)!.list.children) {
      const button = node.firstElementChild;
      if (button instanceof HTMLButtonElement) out.push(button);
    }
    return out;
  };
  const rove = (id: string | null) => {
    const buttons = ordered();
    const target = buttons.find(button => button.dataset.itemId === id) ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
    focusId = target?.dataset.itemId ?? null;
  };

  const makeTile = (item: ItemRecord): Tile => {
    const button = el('button', 'cdb-tile cd-focus');
    button.type = 'button';
    button.dataset.itemId = item.id;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const well = el('span', 'cdb-tile-well');
    const canvas = el('canvas', 'cdb-tile-portrait');
    canvas.setAttribute('aria-hidden', 'true');
    well.append(canvas);
    button.append(well, el('span', 'cdb-tile-name'), el('span', 'cdb-count'), el('span', 'cdb-tile-tag'));
    const mark = svg('cd-seal cd-seal-small cdb-tile-seal', '0 0 24 24', SEAL_MARKUP);
    button.append(mark);
    button.addEventListener('click', () => {
      const id = button.dataset.itemId!;
      options.sound?.('wood');
      if (selected === id) hideCard(true); else showCard(id, true);
    });
    button.addEventListener('focus', () => { focusId = button.dataset.itemId ?? null; rove(focusId); });
    void paintItemPortrait(canvas, item.defId, tileSize).then(drawn => { well.dataset.portrait = drawn ? 'drawn' : 'empty'; });
    return { button, canvas, item };
  };
  const updateTile = (tile: Tile, item: ItemRecord) => {
    tile.item = item;
    const { button } = tile;
    (button.querySelector('.cdb-tile-name') as HTMLElement).textContent = titleOf(item.defId);
    const coin = button.querySelector('.cdb-count') as HTMLElement;
    coin.textContent = item.count > 1 ? String(item.count) : '';
    coin.hidden = item.count < 2;
    const tag = button.querySelector('.cdb-tile-tag') as HTMLElement;
    tag.textContent = placeTag(item);
    tag.hidden = !tag.textContent;
    (button.querySelector('.cdb-tile-seal') as SVGElement).style.display = item.storied ? '' : 'none';
    button.dataset.storied = String(item.storied);
    button.dataset.place = item.place;
    button.setAttribute('aria-label', tileLabel(item));
  };

  const mountCard = (item: ItemRecord) => {
    const target = compact ? sheetBody : side;
    const previous = target.querySelector('.cdc');
    closeCard?.();
    previous?.remove();
    closeCard = mountItemCard(target, item, {
      ...(options.viewerPersonId === undefined ? {} : { viewerPersonId: options.viewerPersonId }),
      history: () => store.history(item.id),
      onClose: () => hideCard(true),
      ...(compact ? { portraitSize: 112 } : { portraitSize: 160 }),
      ...(options.sound ? { sound: options.sound } : {}),
      ...(options.facts ? { facts: options.facts } : {}),
    });
    shownRevision = item.revision;
    if (compact) sheetBody.setAttribute('aria-label', titleOf(item.defId));
  };

  const settleExits = () => { for (const animation of exiting) animation.cancel(); exiting.clear(); };

  const showCard = (id: string, focusCard: boolean) => {
    const item = store.item(id);
    if (!item) return;
    settleExits();
    const wasOpen = selected !== null;
    const before = !compact && !wasOpen ? satchel.getBoundingClientRect().left : 0;
    selected = id;
    for (const tile of tiles.values()) {
      const open = tile.item.id === id;
      tile.button.setAttribute('aria-expanded', String(open));
      tile.button.dataset.selected = String(open);
    }
    if (!side.isConnected) root.append(side);
    mountCard(item);
    root.dataset.card = 'open';
    const card = (compact ? sheetBody : side).querySelector('.cdc');
    if (compact) {
      if (!wasOpen) {
        animate(sheetBody, [{ transform: 'translateY(100%)' }, { transform: 'none' }], 240);
        animate(scrim, [{ opacity: 0 }, { opacity: 1 }], 200);
      }
      (card?.querySelector('.cdc-title') as HTMLElement | null)?.focus({ preventScroll: true });
    } else {
      if (!wasOpen) {
        const delta = before - satchel.getBoundingClientRect().left;
        if (delta) animate(satchel, [{ transform: `translateX(${delta}px)` }, { transform: 'none' }], 220);
        if (card) animate(card, [{ opacity: 0, transform: 'translateX(-14px) rotate(-1.2deg)' }, { opacity: 1, transform: 'none' }], 220);
      } else if (card) animate(card, [{ opacity: .35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], 160);
      if (focusCard && !wasOpen) rove(id);
    }
    options.sound?.('parchment');
  };

  const hideCard = (returnFocus: boolean) => {
    if (selected === null) return;
    const id = selected;
    selected = null;
    root.dataset.card = 'closed';
    for (const tile of tiles.values()) { tile.button.setAttribute('aria-expanded', 'false'); tile.button.dataset.selected = 'false'; }
    const finish = () => {
      if (selected !== null || disposed) return;
      closeCard?.(); closeCard = null; shownRevision = -1;
      const before = satchel.getBoundingClientRect().left;
      side.remove();
      settleExits();
      if (!compact) {
        const delta = before - satchel.getBoundingClientRect().left;
        if (delta) animate(satchel, [{ transform: `translateX(${delta}px)` }, { transform: 'none' }], 200);
      }
    };
    const card = (compact ? sheetBody : side).querySelector('.cdc');
    const out = compact ? animate(sheetBody, [{ transform: 'none' }, { transform: 'translateY(100%)' }], 200, true)
      : card ? animate(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-10px)' }], 180, true) : null;
    if (compact) animate(scrim, [{ opacity: 1 }, { opacity: 0 }], 200, true);
    if (out) out.finished.then(finish, finish); else finish();
    if (returnFocus) tiles.get(id)?.button.focus({ preventScroll: false });
  };

  const leave = () => {
    if (!options.onClose) return;
    const done = () => { if (!disposed) options.onClose?.(); };
    const out = animate(root, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.99)' }], 180, true);
    if (out) out.finished.then(done, done); else done();
  };

  const showRefusal = () => {
    const latest = store.refused().at(-1);
    if (!latest || latest.at < mountedAt || latest.id === shownRefusal) return;
    shownRefusal = latest.id;
    refusal.textContent = latest.message;
    refusal.hidden = false;
    animate(refusal, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 200);
    if (refusalTimer) clearTimeout(refusalTimer);
    refusalTimer = setTimeout(() => { refusal.hidden = true; }, REFUSAL_MS);
  };

  const render = () => {
    if (disposed) return;
    const status = store.status();
    const items = [...store.items()].filter(item => item.place !== 'spent').sort(compareItems);
    const live = new Set(items.map(item => item.id));
    for (const [id, tile] of tiles) if (!live.has(id)) { tile.button.parentElement?.remove(); tiles.delete(id); }
    const byGroup = new Map<BagGroup, ItemRecord[]>(GROUPS.map(group => [group, []]));
    for (const item of items) byGroup.get(groupOf(item))!.push(item);
    for (const group of GROUPS) {
      const { section, list } = groupNodes.get(group)!;
      const members = byGroup.get(group)!;
      section.hidden = members.length === 0;
      members.forEach((item, index) => {
        let tile = tiles.get(item.id);
        if (!tile) { tile = makeTile(item); tiles.set(item.id, tile); const li = el('li', 'cdb-cell'); li.append(tile.button); list.append(li); }
        if (tile.item !== item || !tile.button.getAttribute('aria-label')) updateTile(tile, item);
        const li = tile.button.parentElement!;
        // Move only what is out of place, so focus stays where it is.
        if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
      });
    }
    count.textContent = status === 'ready' ? tally(items) : '';
    count.hidden = !count.textContent;
    note.replaceChildren();
    note.hidden = true;
    if (!items.length) {
      note.hidden = false;
      if (status === 'loading') note.append(el('p', 'cdb-note-line', 'Opening your bag…'));
      else if (status === 'unavailable') {
        note.append(el('p', 'cdb-note-line', 'Your bag can’t be opened just now.'), el('p', 'cdb-note-soft', 'Your things are safe with the kingdom. Try again in a moment.'));
      } else {
        note.append(svg('cdb-note-mark', '0 0 64 40', '<path d="M6 34C20 30 38 18 58 4"/><path d="M58 4c-2 9-3 18-2 26"/><path d="M56 30c0 4-3 6-6 5-2-1-2-4 0-5"/>'));
        note.append(el('p', 'cdb-note-line', 'Nothing in your bag yet.'), el('p', 'cdb-note-soft', 'The rack at the pier lends a rod.'));
      }
    }
    groups.hidden = !items.length;
    rove(focusId);
    if (selected !== null) {
      const item = store.item(selected);
      if (!item || item.place === 'spent') hideCard(false);
      else if (item.revision !== shownRevision) mountCard(item);
    }
    if (pendingOpen && live.has(pendingOpen)) { const id = pendingOpen; pendingOpen = null; showCard(id, false); }
    // The bag opened before its things arrived: hand the keyboard to the first of them.
    if (document.activeElement === root && (!compact || selected === null)) ordered().find(button => button.tabIndex === 0)?.focus({ preventScroll: true });
    showRefusal();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (selected !== null) { options.sound?.('parchment'); hideCard(true); } else if (options.onClose) { options.sound?.('brass'); leave(); }
      return;
    }
    if (compact && selected !== null && event.key === 'Tab' && sheetBody.contains(event.target as Node)) {
      const focusable = [...sheetBody.querySelectorAll<HTMLElement>('button, [tabindex="-1"].cdc-title')];
      if (focusable.length) {
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const next = focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]!;
        event.preventDefault(); next.focus();
      }
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('cdb-tile')) return;
    const buttons = ordered();
    const index = buttons.indexOf(target);
    if (index < 0) return;
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowRight') next = buttons[index + 1];
    else if (event.key === 'ArrowLeft') next = buttons[index - 1];
    else if (event.key === 'Home') next = buttons[0];
    else if (event.key === 'End') next = buttons.at(-1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const from = target.getBoundingClientRect(), down = event.key === 'ArrowDown';
      const centre = from.left + from.width / 2;
      let rowTop: number | null = null;
      for (const button of buttons) {
        const top = button.getBoundingClientRect().top;
        if (down ? top > from.top + 4 : top < from.top - 4) if (rowTop === null || (down ? top < rowTop : top > rowTop)) rowTop = top;
      }
      if (rowTop !== null) {
        let best = Infinity;
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          if (Math.abs(rect.top - rowTop) > 4) continue;
          const distance = Math.abs(rect.left + rect.width / 2 - centre);
          if (distance < best) { best = distance; next = button; }
        }
      }
    } else return;
    event.preventDefault();
    if (!next) return;
    next.focus();
    // On a wide screen the tag follows the hand as you move through the bag.
    if (!compact && selected !== null && next.dataset.itemId) showCard(next.dataset.itemId, false);
  };
  root.addEventListener('keydown', onKey);

  host.append(root);
  animate(satchel, [{ opacity: 0, transform: 'translateY(10px) scale(.985)' }, { opacity: 1, transform: 'none' }], 220);
  const unsubscribe = store.subscribe(render);
  render();
  root.tabIndex = -1;
  if (!compact || selected === null) {
    const first = (selected !== null ? tiles.get(selected)?.button : undefined) ?? ordered().find(button => button.tabIndex === 0);
    (first ?? root).focus({ preventScroll: true });
  }

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (refusalTimer) clearTimeout(refusalTimer);
    for (const animation of [...running, ...exiting]) animation.cancel();
    running.clear(); exiting.clear();
    closeCard?.();
    root.removeEventListener('keydown', onKey);
    root.remove();
  };
}
