import '@chatdom/ui/kit.css';
import '../bag.css';
import './shelf.css';
import type { ItemRecord, ShelfPiece } from '@chatdom/shared';
import { mountItemCard } from '../card';
import { el, svg, type BagSurface } from '../dom';
import { titleOf } from '../kinds';
import { paintItemPortrait } from '../portrait';
import { baysFor, drawerItems, keepsakeCount, neighbourSlot, pageOfSlot, placeWords, shelfPlacements, slotAtPoint, visitTitle,
  type Direction, type Insets, type Placement } from './layout';
import { mountPieceCard } from './piece-card';
import { createShelfScene, SCENE_WORDS, type ScreenPlace, type ShelfScene } from './scene';
import type { MountShelf, ShelfResult } from './types';

export type { MountShelf, OwnShelfSource, ShelfResult, ShelfViewOptions, VisitShelfSource } from './types';
export { mountPieceCard, pieceOrigin, pieceFacts } from './piece-card';
export { drawerItems, shelfPlacements, baysFor, placeWords, visitTitle } from './layout';

/** Pixels a mouse must travel to lift, a finger must hold to lift, and a swipe must cover to turn a section. */
const DRAG_START = 8, LONG_PRESS = 320, SWIPE = 44;
const CARD_ROOM = 420;
const REFUSAL_MS = 6000;
const UNREACHABLE = 'The kingdom could not be reached just now. Try again in a moment.';
const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

let views = 0;

interface Lift { readonly id: string; readonly from: 'shelf' | 'bag'; readonly defId: string }
interface Gesture {
  readonly pointer: number; readonly kind: string; readonly x0: number; readonly y0: number;
  readonly slot: number | null; readonly item: Placement | null;
  mode: 'press' | 'drag' | 'swipe'; timer: ReturnType<typeof setTimeout> | null;
}
interface DrawerDrag { readonly pointer: number; readonly kind: string; readonly x0: number; readonly y0: number; readonly id: string; started: boolean }

/**
 * Your keepsakes on the carved shelf at home, or a neighbour's shelf seen from their door. A full-window layer over the
 * world: the real render of the alcove and every keepsake in it, places you can tap, drag and walk with the keys,
 * the story tag one tap away, and (on your own shelf) the drawer of keepsakes still in your bag and the door's toggle.
 */
export const mountShelf: MountShelf = (host, source, options) => {
  const own = source.mode === 'own' ? source : null;
  const visit = source.mode === 'visit' ? source : null;
  const compact = options.compact;
  const sound = (surface: BagSurface) => options.sound?.(surface);
  const titleId = `cdsh-title-${++views}`;
  let disposed = false;

  // ---------- The layer ----------
  const root = el('div', 'cdsh cd-kit');
  root.dataset.mode = source.mode;
  root.dataset.compact = String(compact);
  root.dataset.ready = 'false';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', titleId);
  root.tabIndex = -1;

  const canvas = el('canvas', 'cdsh-canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const glow = el('div', 'cdsh-glow');
  glow.setAttribute('aria-hidden', 'true');
  const shade = el('div', 'cdsh-shade');
  const placesLayer = el('div', 'cdsh-places');
  placesLayer.setAttribute('role', 'group');
  placesLayer.setAttribute('aria-labelledby', titleId);
  const tagsLayer = el('div', 'cdsh-tags');
  tagsLayer.setAttribute('aria-hidden', 'true');

  const head = el('header', 'cdsh-head');
  const plate = el('div', 'cdsh-plate');
  const title = el('h2', 'cdsh-title', own ? 'Your shelf' : visitTitle(visit!.name));
  title.id = titleId;
  const sub = el('p', 'cdsh-sub');
  plate.append(title, sub);
  const close = el('button', 'cdsh-close cd-focus');
  close.type = 'button';
  close.setAttribute('aria-label', own ? 'Close your shelf' : 'Step back from the shelf');
  close.append(svg('cdsh-close-mark', '0 0 20 20', '<path d="M5.5 5.8c3 2.6 5.8 5.6 9 8.6M14.6 5.4c-3.1 3-5.8 6-9.1 9"/>'));
  close.addEventListener('click', () => { sound('wood'); options.onClose(); });
  head.append(plate);

  // The door's toggle: a brass slide on a carved rail.
  let doorSwitch: HTMLButtonElement | null = null, doorState: HTMLElement | null = null, doorBusy = false;
  if (own) {
    const door = el('div', 'cdsh-door');
    const labelId = `${titleId}-door`;
    doorSwitch = el('button', 'cdsh-switch cd-focus');
    doorSwitch.type = 'button';
    doorSwitch.setAttribute('role', 'switch');
    doorSwitch.setAttribute('aria-labelledby', labelId);
    const rail = el('span', 'cdsh-switch-rail');
    rail.append(el('span', 'cdsh-switch-knob'));
    doorSwitch.append(rail);
    const words = el('span', 'cdsh-door-words');
    const label = el('span', 'cdsh-door-label', 'Show my shelf at my door');
    label.id = labelId;
    doorState = el('span', 'cdsh-door-state');
    doorState.setAttribute('aria-live', 'polite');
    words.append(label, doorState);
    door.append(doorSwitch, words);
    head.append(door);
    doorSwitch.addEventListener('click', () => { void toggleDoor(); });
  }
  head.append(close);

  const turnPrev = el('button', 'cdsh-turn cd-focus');
  turnPrev.type = 'button'; turnPrev.dataset.dir = 'prev';
  turnPrev.setAttribute('aria-label', 'The section to the left');
  turnPrev.append(svg('cdsh-turn-mark', '0 0 24 24', '<path d="M14.5 5.5 8 12l6.5 6.5"/>'));
  const turnNext = el('button', 'cdsh-turn cd-focus');
  turnNext.type = 'button'; turnNext.dataset.dir = 'next';
  turnNext.setAttribute('aria-label', 'The section to the right');
  turnNext.append(svg('cdsh-turn-mark', '0 0 24 24', '<path d="M9.5 5.5 16 12l-6.5 6.5"/>'));
  const dots = el('div', 'cdsh-dots');
  dots.setAttribute('aria-hidden', 'true');
  const section = el('p', 'cdsh-sr');
  section.setAttribute('aria-live', 'polite');

  const note = el('div', 'cdsh-note');
  note.hidden = true;
  const noteLine = el('p', 'cdsh-note-line'), noteSoft = el('p', 'cdsh-note-soft');
  note.append(noteLine, noteSoft);

  const hint = el('div', 'cdsh-hint');
  hint.setAttribute('role', 'status');
  hint.hidden = true;
  const hintName = el('p', 'cdsh-hint-name'), hintWords = el('p', 'cdsh-hint-words');
  const hintCancel = el('button', 'cdsh-hint-cancel cd-focus');
  hintCancel.type = 'button';
  hintCancel.addEventListener('click', () => setDown());
  const hintText = el('div', 'cdsh-hint-text');
  hintText.append(hintName, hintWords);
  hint.append(hintText, hintCancel);

  const refusal = el('p', 'cdsh-refusal');
  refusal.setAttribute('role', 'alert');
  refusal.hidden = true;
  const status = el('p', 'cdsh-status', own ? 'Setting out your shelf…' : 'Lighting the candles…');
  status.setAttribute('role', 'status');

  let drawer: HTMLElement | null = null, drawerList: HTMLUListElement | null = null;
  if (own) {
    drawer = el('section', 'cdsh-drawer');
    const drawerTitle = el('h3', 'cdsh-drawer-title', 'Waiting in your bag');
    drawerTitle.id = `${titleId}-drawer`;
    drawer.setAttribute('aria-labelledby', drawerTitle.id);
    const drawerHead = el('div', 'cdsh-drawer-head');
    drawerHead.append(drawerTitle, el('p', 'cdsh-drawer-hint', compact ? 'Tap one, then its place.' : 'Choose one, then its place on the shelf.'));
    drawerList = el('ul', 'cdsh-drawer-list');
    drawer.append(drawerHead, drawerList);
    drawer.hidden = true;
  }

  const ghost = el('div', 'cdsh-ghost');
  ghost.hidden = true;
  const ghostCanvas = el('canvas', 'cdsh-ghost-portrait');
  ghost.append(ghostCanvas);

  root.append(canvas, glow, shade, placesLayer, tagsLayer, note, head, turnPrev, turnNext, dots, section, hint, refusal, status);
  if (drawer) root.append(drawer);
  root.append(ghost);
  host.append(root);

  // ---------- State ----------
  let items: readonly ItemRecord[] = [];
  let placements: Placement[] = [];
  let waiting: ItemRecord[] = [];
  let bays = 0;
  let lift: Lift | null = null;
  let pending = false;
  let focusSlot = 0;
  let screen: readonly ScreenPlace[] = [];
  let gesture: Gesture | null = null;
  let drawerDrag: DrawerDrag | null = null;
  let suppressDrawerClick = false;
  let card: { readonly id: string; readonly close: () => void; readonly holder: HTMLElement } | null = null;
  let refusalTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let readyFired = false;
  const buttons = new Map<number, HTMLButtonElement>();
  const tags = new Map<number, HTMLSpanElement>();
  const drawerButtons = new Map<string, HTMLButtonElement>();

  let scene: ShelfScene | null = null;
  try { scene = createShelfScene(canvas, { compact, ...(options.hour !== undefined ? { hour: options.hour } : {}) }); }
  catch { status.textContent = SCENE_WORDS.noWebgl; root.dataset.state = 'unavailable'; }

  const placementAt = (slot: number | null) => slot === null ? null : placements.find(item => item.slot === slot) ?? null;
  const placementOf = (id: string) => placements.find(item => item.id === id) ?? null;
  const markReady = () => {
    if (readyFired || disposed) return;
    readyFired = true;
    root.dataset.ready = 'true';
    options.onReady?.();
  };

  function read(): void {
    if (own) {
      items = own.items();
      placements = shelfPlacements(items);
      waiting = drawerItems(items);
    } else {
      placements = shelfPlacements(visit!.pieces);
    }
    if (lift) {
      const stillOurs = lift.from === 'shelf' ? placementOf(lift.id) : waiting.find(item => item.id === lift!.id);
      if (!stillOurs) { lift = null; scene?.lift(null); }
    }
    if (card && !placementOf(card.id)) closeCard(false);
  }

  // ---------- Words and controls around the shelf ----------
  function renderDom(): void {
    const count = placements.length;
    const counted = keepsakeCount(count);
    const home = own && options.kingdomName ? `At home in ${options.kingdomName}` : '';
    sub.textContent = [counted, home].filter(Boolean).join(' · ') || (own ? 'At home' : '');
    sub.hidden = !sub.textContent;

    if (count === 0 && root.dataset.state !== 'unavailable') {
      note.hidden = false;
      if (own) {
        noteLine.textContent = 'Rare catches and firsts are kept here.';
        noteSoft.textContent = waiting.length ? 'Choose one from your bag below and give it a place.'
          : 'When the water gives you one, it waits in your bag until you set it out.';
      } else {
        noteLine.textContent = 'Nothing stands on this shelf yet.';
        noteSoft.textContent = 'Its keepsakes will be set out here.';
      }
    } else note.hidden = true;

    if (own && doorSwitch && doorState) {
      const settings = own.settings();
      doorSwitch.disabled = !settings || doorBusy;
      doorSwitch.setAttribute('aria-checked', String(!!settings?.shown));
      doorSwitch.dataset.busy = String(doorBusy);
      doorState.textContent = !settings ? 'Asking the kingdom…' : settings.shown ? 'Visitors can look from your door' : 'Kept to yourself';
    }
    renderDrawer();
    renderLift();
  }

  function renderDrawer(): void {
    if (!drawer || !drawerList) return;
    drawer.hidden = waiting.length === 0;
    const keep = new Set(waiting.map(item => item.id));
    for (const [id, button] of drawerButtons) if (!keep.has(id)) { button.parentElement?.remove(); drawerButtons.delete(id); }
    const size = compact ? 52 : 64;
    for (const [index, item] of waiting.entries()) {
      let button = drawerButtons.get(item.id);
      if (!button) {
        button = el('button', 'cdsh-drawer-item cd-focus');
        button.type = 'button';
        button.dataset.id = item.id;
        const well = el('span', 'cdsh-drawer-well');
        const portrait = el('canvas', 'cdsh-drawer-portrait');
        portrait.setAttribute('aria-hidden', 'true');
        well.append(portrait);
        button.append(well, el('span', 'cdsh-drawer-name', titleOf(item.defId)));
        if (item.number !== null && item.number > 0) button.append(el('span', 'cdsh-drawer-no', `No. ${item.number}`));
        void paintItemPortrait(portrait, item.defId, size).then(drawn => { well.dataset.portrait = drawn ? 'drawn' : 'empty'; });
        button.addEventListener('click', event => {
          if (suppressDrawerClick) { suppressDrawerClick = false; event.preventDefault(); return; }
          pickFromBag(item.id);
        });
        button.addEventListener('pointerdown', event => drawerDown(event, item.id));
        drawerButtons.set(item.id, button);
        const li = el('li', 'cdsh-drawer-cell');
        li.append(button);
        drawerList.append(li);
      }
      const li = button.parentElement!;
      if (drawerList.children[index] !== li) drawerList.insertBefore(li, drawerList.children[index] ?? null);
      const name = `${titleOf(item.defId)}${item.number !== null && item.number > 0 ? `, No. ${item.number}` : ''}`;
      button.setAttribute('aria-label', lift?.id === item.id ? `${name}, chosen. Now choose its place on the shelf.` : `Set out ${name}`);
      button.setAttribute('aria-pressed', String(lift?.id === item.id));
    }
  }

  function renderLift(): void {
    root.dataset.lifting = String(!!lift);
    if (!lift) { hint.hidden = true; return; }
    hint.hidden = false;
    hintName.textContent = titleOf(lift.defId);
    hintWords.textContent = lift.from === 'shelf' ? 'Choose its new place. A taken place swaps the two.' : 'Choose its place on the shelf.';
    hintCancel.textContent = lift.from === 'shelf' ? 'Put it back' : 'Keep it in the bag';
  }

  function renderPages(): void {
    if (!scene) return;
    const pages = scene.pages(), current = scene.page();
    const many = pages.length > 1;
    turnPrev.hidden = turnNext.hidden = dots.hidden = !many;
    turnPrev.disabled = current <= 0;
    turnNext.disabled = current >= pages.length - 1;
    while (dots.children.length > pages.length) dots.lastElementChild!.remove();
    while (dots.children.length < pages.length) dots.append(el('span', 'cdsh-dot'));
    [...dots.children].forEach((dot, index) => { (dot as HTMLElement).dataset.current = String(index === current); });
  }

  // ---------- The overlay that follows the render ----------
  function labelFor(slot: number, item: Placement | null): string {
    const where = placeWords(slot, bays);
    if (item) {
      const name = `${titleOf(item.defId)}${item.number ? `, No. ${item.number}` : ''}`;
      if (lift && lift.id === item.id) return `${name}, lifted. Press Enter to set it back. ${where}.`;
      if (lift) return `Swap with ${name}. ${where}.`;
      return `${name}. ${where}.`;
    }
    return lift ? `Place it here. ${where}.` : `An empty place. ${where}.`;
  }

  function layoutOverlay(): void {
    if (!scene || disposed) return;
    screen = scene.places();
    const bySlot = new Map(placements.map(item => [item.slot, item]));
    const seen = new Set<number>();
    for (const place of screen) {
      const item = bySlot.get(place.slot) ?? null;
      if (!own && !item) continue;
      seen.add(place.slot);
      let button = buttons.get(place.slot);
      if (!button) {
        button = el('button', 'cdsh-place');
        button.type = 'button';
        button.dataset.slot = String(place.slot);
        buttons.set(place.slot, button);
        placesLayer.append(button);
      }
      Object.assign(button.style, { left: `${place.x}px`, top: `${place.y}px`, width: `${place.w}px`, height: `${place.h}px` });
      button.hidden = !place.onPage;
      button.dataset.filled = String(!!item);
      button.dataset.lifted = String(!!item && lift?.id === item.id);
      button.dataset.target = String(!!lift && !(item && item.id === lift.id));
      button.tabIndex = place.slot === focusSlot ? 0 : -1;
      button.setAttribute('aria-label', labelFor(place.slot, item));
      const missing = !!item && !scene.drawn(item.id) && root.dataset.ready === 'true';
      let slip = button.querySelector<HTMLElement>('.cdsh-missing');
      if (missing && !slip) { slip = el('span', 'cdsh-missing', titleOf(item!.defId)); button.append(slip); }
      if (!missing && slip) slip.remove();
      // The brass number tag on the board's edge below a numbered keepsake.
      let tag = tags.get(place.slot);
      if (item?.number && place.onPage) {
        if (!tag) { tag = el('span', 'cdsh-tag'); tags.set(place.slot, tag); tagsLayer.append(tag); }
        tag.textContent = `No. ${item.number}`;
        Object.assign(tag.style, { left: `${place.tag.x}px`, top: `${place.tag.y}px` });
        tag.dataset.lifted = String(lift?.id === item.id);
      } else if (tag) { tag.remove(); tags.delete(place.slot); }
    }
    for (const [slot, button] of buttons) if (!seen.has(slot)) { button.remove(); buttons.delete(slot); }
    for (const [slot, tag] of tags) if (!seen.has(slot)) { tag.remove(); tags.delete(slot); }
    if (!buttons.has(focusSlot)) {
      const first = placements.find(item => buttons.has(item.slot))?.slot ?? buttons.keys().next().value;
      if (first !== undefined) { focusSlot = first; buttons.get(first)!.tabIndex = 0; }
    }
    // The kind words sit on the middle tier, between its two centre places.
    if (!note.hidden) {
      const page = scene.page();
      const pair = screen.filter(place => place.onPage && [0, 1, 12, 13, 24, 25, 36, 37, 48, 49, 60, 61].includes(place.slot));
      const centre = pair.length ? pair : screen.filter(place => place.onPage);
      if (centre.length) {
        const x0 = Math.min(...centre.map(place => place.x)), x1 = Math.max(...centre.map(place => place.x + place.w));
        const y0 = Math.min(...centre.map(place => place.y)), y1 = Math.max(...centre.map(place => place.y + place.h));
        Object.assign(note.style, { left: `${(x0 + x1) / 2}px`, top: `${(y0 + y1) / 2}px` });
      }
      note.dataset.page = String(page);
    }
    // Candle halos: soft light over the flames, breathing a little.
    const flames = scene.flames();
    while (glow.children.length > flames.length) glow.lastElementChild!.remove();
    while (glow.children.length < flames.length) {
      const halo = el('span', 'cdsh-halo');
      halo.style.animationDelay = `${-(glow.children.length * 1.37) % 4}s`;
      glow.append(halo);
    }
    flames.forEach((flame, index) => {
      const halo = glow.children[index] as HTMLElement;
      Object.assign(halo.style, { left: `${flame.x}px`, top: `${flame.y}px`, width: `${flame.size}px`, height: `${flame.size}px` });
    });
    renderPages();
    if (scene.lost()) { status.hidden = false; status.textContent = SCENE_WORDS.lost; root.dataset.state = 'lost'; }
  }

  function focusPlace(slot: number): void {
    if (!scene) return;
    focusSlot = slot;
    const page = pageOfSlot(scene.pages(), slot);
    if (page !== scene.page()) { sound('wood'); scene.setPage(page, true); announcePage(); }
    layoutOverlay();
    buttons.get(slot)?.focus({ preventScroll: true });
  }

  function announcePage(): void {
    if (!scene) return;
    const pages = scene.pages();
    section.textContent = pages.length > 1 ? `Section ${scene.page() + 1} of ${pages.length}` : '';
  }

  function turn(delta: number): void {
    if (!scene) return;
    const pages = scene.pages();
    const next = Math.max(0, Math.min(pages.length - 1, scene.page() + delta));
    if (next === scene.page()) return;
    sound('wood');
    scene.setPage(next, true);
    announcePage();
    const onPage = scene.places().filter(place => place.onPage);
    const first = onPage.find(place => placementAt(place.slot)) ?? (own ? onPage[0] : undefined);
    if (first) focusSlot = first.slot;
    layoutOverlay();
  }
  turnPrev.addEventListener('click', () => turn(-1));
  turnNext.addEventListener('click', () => turn(1));

  // ---------- Lifting, placing and the story tag ----------
  function setDown(): void {
    if (!lift) return;
    lift = null;
    scene?.lift(null);
    sound('wood');
    renderDrawer(); renderLift(); layoutOverlay();
  }

  function liftFromShelf(id: string): void {
    const item = placementOf(id);
    if (!own || !item) return;
    closeCard(false);
    lift = { id, from: 'shelf', defId: item.defId };
    scene?.lift(id);
    sound('wood');
    renderDrawer(); renderLift(); layoutOverlay();
  }

  function pickFromBag(id: string): void {
    const item = waiting.find(entry => entry.id === id);
    if (!own || !item || pending) return;
    if (lift?.id === id) { setDown(); return; }
    closeCard(false);
    scene?.lift(null);
    lift = { id, from: 'bag', defId: item.defId };
    sound('wood');
    renderDrawer(); renderLift();
    // Keyboard and switch users go straight to the shelf: the first free place on this section, else the focused one.
    const free = screen.find(place => place.onPage && !placementAt(place.slot));
    focusPlace(free?.slot ?? focusSlot);
  }

  function showRefusal(message: string): void {
    refusal.textContent = message;
    refusal.hidden = false;
    if (refusalTimer) clearTimeout(refusalTimer);
    refusalTimer = setTimeout(() => { refusal.hidden = true; }, REFUSAL_MS);
  }

  async function answer(job: () => Promise<ShelfResult>): Promise<ShelfResult> {
    try { return await job(); } catch { return { ok: false, message: UNREACHABLE }; }
  }

  async function arrangeTo(id: string, slot: number): Promise<void> {
    if (!own || pending) return;
    const from = placementOf(id);
    if (from?.slot === slot) { setDown(); return; }
    pending = true;
    root.dataset.pending = 'true';
    sound('wood');
    const result = await answer(() => own.arrange(id, slot));
    if (disposed) return;
    pending = false;
    root.dataset.pending = 'false';
    lift = null;
    focusSlot = slot;
    if (!result.ok) { scene?.lift(null); showRefusal(result.message); }
    else {
      // The kingdom's answer moves it; if the change has not arrived by now, set it down where it was.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { if (!lift) scene?.lift(null); }, 1500);
    }
    renderDrawer(); renderLift(); layoutOverlay();
    if (root.contains(document.activeElement) || document.activeElement === document.body) buttons.get(slot)?.focus({ preventScroll: true });
  }

  async function takeDown(id: string): Promise<void> {
    if (!own || pending) return;
    pending = true;
    root.dataset.pending = 'true';
    sound('wood');
    const result = await answer(() => own.takeDown(id));
    if (disposed) return;
    pending = false;
    root.dataset.pending = 'false';
    if (result.ok) closeCard(true); else showRefusal(result.message);
  }

  async function toggleDoor(): Promise<void> {
    const settings = own?.settings();
    if (!own || !settings || doorBusy) return;
    doorBusy = true;
    sound('brass');
    renderDom();
    const result = await answer(() => own.show(!settings.shown));
    if (disposed) return;
    doorBusy = false;
    if (!result.ok) showRefusal(result.message);
    renderDom();
  }

  function cardHolder(): { holder: HTMLElement; body: HTMLElement } {
    if (compact) {
      const holder = el('div', 'cdsh-sheet');
      const scrim = el('div', 'cdsh-scrim');
      scrim.addEventListener('click', () => { sound('parchment'); closeCard(true); });
      const body = el('div', 'cdsh-sheet-body');
      holder.append(scrim, body);
      return { holder, body };
    }
    const holder = el('div', 'cdsh-side');
    return { holder, body: holder };
  }

  function openCard(id: string): void {
    if (disposed) return;
    closeCard(false);
    const { holder, body } = cardHolder();
    root.append(holder);
    let unmount: () => void;
    if (own) {
      const record = items.find(item => item.id === id);
      if (!record) { holder.remove(); return; }
      unmount = mountItemCard(body, record, { viewerPersonId: own.personId, history: () => own.history(id), onClose: () => closeCard(true), sound });
      const paper = body.querySelector('.cdc-paper');
      if (paper) {
        const actions = el('div', 'cdsh-actions');
        const move = el('button', 'cdsh-action cd-focus', 'Move');
        move.type = 'button';
        move.addEventListener('click', () => { liftFromShelf(id); focusPlace(placementOf(id)?.slot ?? focusSlot); });
        const down = el('button', 'cdsh-action cd-focus', 'Take it down');
        down.type = 'button';
        down.dataset.kind = 'down';
        down.addEventListener('click', () => { void takeDown(id); });
        actions.append(move, down);
        paper.append(actions);
      }
    } else {
      const piece: ShelfPiece | undefined = visit!.pieces.find(entry => entry.id === id);
      if (!piece) { holder.remove(); return; }
      unmount = mountPieceCard(body, piece, { onClose: () => closeCard(true), sound });
    }
    card = { id, close: unmount, holder };
    root.dataset.card = 'open';
    sound('parchment');
    resize(true);
    body.querySelector<HTMLElement>('.cdc-title')?.focus({ preventScroll: true });
  }

  function closeCard(restore: boolean): void {
    if (!card) return;
    const { close: unmount, holder } = card;
    card = null;
    unmount();
    holder.remove();
    root.dataset.card = 'closed';
    resize(true);
    if (restore && !disposed) buttons.get(focusSlot)?.focus({ preventScroll: true });
  }

  function tapSlot(slot: number | null): void {
    if (slot === null || pending) return;
    focusSlot = slot;
    const item = placementAt(slot);
    if (own && lift) {
      if (item && item.id === lift.id) { setDown(); return; }
      void arrangeTo(lift.id, slot);
      return;
    }
    if (item) openCard(item.id);
  }

  // ---------- Pointer: tap, drag and swipe over the shelf ----------
  const local = (event: PointerEvent) => {
    const box = root.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const visibleRects = () => screen.filter(place => place.onPage && (own || placementAt(place.slot)))
    .map(place => ({ slot: place.slot, x: place.x, y: place.y, w: place.w, h: place.h }));
  const slotUnder = (x: number, y: number) => slotAtPoint(visibleRects(), x, y);
  function markTarget(slot: number | null): void {
    for (const [n, button] of buttons) button.dataset.over = String(n === slot);
  }

  function beginDrag(point: { x: number; y: number }): void {
    if (!gesture?.item || !own || !scene) return;
    gesture.mode = 'drag';
    if (gesture.timer) { clearTimeout(gesture.timer); gesture.timer = null; }
    closeCard(false);
    lift = { id: gesture.item.id, from: 'shelf', defId: gesture.item.defId };
    root.dataset.dragging = 'true';
    sound('wood');
    scene.hold(gesture.item.id, point.x, point.y);
    renderLift(); layoutOverlay();
  }

  placesLayer.addEventListener('pointerdown', event => {
    if (gesture || pending || event.button > 0 || !scene) return;
    const point = local(event);
    const slot = slotUnder(point.x, point.y);
    const item = placementAt(slot);
    gesture = { pointer: event.pointerId, kind: event.pointerType, x0: point.x, y0: point.y, slot, item, mode: 'press', timer: null };
    try { placesLayer.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
    if (own && item && event.pointerType === 'touch') gesture.timer = setTimeout(() => { if (gesture?.mode === 'press') beginDrag(point); }, LONG_PRESS);
  });
  placesLayer.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer || !scene) return;
    const point = local(event), dx = point.x - gesture.x0, dy = point.y - gesture.y0, distance = Math.hypot(dx, dy);
    if (gesture.mode === 'drag') { scene.hold(gesture.item!.id, point.x, point.y); markTarget(slotUnder(point.x, point.y)); return; }
    if (gesture.mode === 'swipe') return;
    if (gesture.kind !== 'touch' && own && gesture.item && !lift && distance > DRAG_START) { beginDrag(point); return; }
    if (distance > 10 && gesture.timer) { clearTimeout(gesture.timer); gesture.timer = null; }
    if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.2 && (gesture.kind === 'touch' || !gesture.item)) gesture.mode = 'swipe';
  });
  const endGesture = (event: PointerEvent, cancelled: boolean) => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const done = gesture;
    gesture = null;
    if (done.timer) clearTimeout(done.timer);
    const point = local(event), dx = point.x - done.x0, distance = Math.hypot(dx, point.y - done.y0);
    if (done.mode === 'drag') {
      root.dataset.dragging = 'false';
      markTarget(null);
      const slot = cancelled ? null : slotUnder(point.x, point.y);
      if (slot === null || slot === done.item!.slot) { setDown(); return; }
      void arrangeTo(done.item!.id, slot);
      return;
    }
    if (cancelled) return;
    if (done.mode === 'swipe' || (!done.item && Math.abs(dx) > SWIPE)) { if (Math.abs(dx) > SWIPE) turn(dx < 0 ? 1 : -1); return; }
    if (distance < 12) tapSlot(done.slot);
  };
  placesLayer.addEventListener('pointerup', event => endGesture(event, false));
  placesLayer.addEventListener('pointercancel', event => endGesture(event, true));
  placesLayer.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.cdsh-place');
    if (!button) return;
    event.preventDefault();
    // A click with no pointer behind it comes from a screen reader or a switch: treat it as a tap.
    if (event.detail === 0) tapSlot(Number(button.dataset.slot));
  });
  placesLayer.addEventListener('keydown', event => {
    const slot = Number((event.target as HTMLElement).dataset.slot);
    if (!Number.isInteger(slot)) return;
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      const points = screen.filter(place => own || placementAt(place.slot)).map(place => ({ slot: place.slot, x: place.cell.x, y: place.cell.y }));
      const next = neighbourSlot(points, slot, direction);
      if (next !== null) focusPlace(next);
      return;
    }
    // Enter acts here; Space arrives as a pointerless click below.
    if (event.key === 'Enter') { event.preventDefault(); tapSlot(slot); }
  });
  placesLayer.addEventListener('focusin', event => {
    const slot = Number((event.target as HTMLElement).dataset.slot);
    if (Number.isInteger(slot) && slot !== focusSlot) { focusSlot = slot; for (const [n, button] of buttons) button.tabIndex = n === slot ? 0 : -1; }
  });

  // ---------- Pointer: dragging a keepsake up out of the drawer ----------
  function drawerDown(event: PointerEvent, id: string): void {
    if (drawerDrag || pending || event.button > 0) return;
    drawerDrag = { pointer: event.pointerId, kind: event.pointerType, x0: event.clientX, y0: event.clientY, id, started: false };
  }
  const onDrawerMove = (event: PointerEvent) => {
    if (!drawerDrag || event.pointerId !== drawerDrag.pointer) return;
    const dx = event.clientX - drawerDrag.x0, dy = event.clientY - drawerDrag.y0;
    if (!drawerDrag.started) {
      const go = drawerDrag.kind === 'touch' ? dy < -14 && Math.abs(dy) > Math.abs(dx) : Math.hypot(dx, dy) > DRAG_START;
      if (!go) { if (drawerDrag.kind === 'touch' && Math.abs(dx) > 14) drawerDrag = null; return; }
      drawerDrag.started = true;
      const item = waiting.find(entry => entry.id === drawerDrag!.id);
      if (!item) { drawerDrag = null; return; }
      closeCard(false);
      scene?.lift(null);
      lift = { id: item.id, from: 'bag', defId: item.defId };
      sound('wood');
      ghost.hidden = false;
      void paintItemPortrait(ghostCanvas, item.defId, 84);
      root.dataset.dragging = 'true';
      renderDrawer(); renderLift(); layoutOverlay();
    }
    event.preventDefault();
    const box = root.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
    ghost.style.translate = `${x}px ${y}px`;
    markTarget(slotUnder(x, y));
  };
  const onDrawerUp = (event: PointerEvent, cancelled: boolean) => {
    if (!drawerDrag || event.pointerId !== drawerDrag.pointer) return;
    const done = drawerDrag;
    drawerDrag = null;
    if (!done.started) return;
    suppressDrawerClick = true;
    setTimeout(() => { suppressDrawerClick = false; }, 0);
    ghost.hidden = true;
    root.dataset.dragging = 'false';
    markTarget(null);
    const box = root.getBoundingClientRect();
    const slot = cancelled ? null : slotUnder(event.clientX - box.left, event.clientY - box.top);
    if (slot === null) { setDown(); return; }
    void arrangeTo(done.id, slot);
  };
  const onWindowUp = (event: PointerEvent) => onDrawerUp(event, false);
  const onWindowCancel = (event: PointerEvent) => onDrawerUp(event, true);
  window.addEventListener('pointermove', onDrawerMove, { passive: false });
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('pointercancel', onWindowCancel);

  // ---------- Keys for the whole layer ----------
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (gesture?.mode === 'drag' || drawerDrag?.started) {
      gesture = null; drawerDrag = null;
      ghost.hidden = true; root.dataset.dragging = 'false'; markTarget(null);
      setDown();
      return;
    }
    if (lift) { setDown(); buttons.get(focusSlot)?.focus({ preventScroll: true }); return; }
    if (card) { sound('parchment'); closeCard(true); return; }
    options.onClose();
  });

  // ---------- Size, framing and the kingdom's changes ----------
  function insetsNow(): Insets {
    const box = root.getBoundingClientRect();
    const headBox = head.getBoundingClientRect();
    const drawerBox = drawer && !drawer.hidden ? drawer.getBoundingClientRect() : null;
    const many = (scene?.pages().length ?? 1) > 1;
    const side = compact ? 6 : many ? 78 : 30;
    return {
      top: Math.max(0, headBox.bottom - box.top) + (compact ? 4 : 8),
      bottom: (drawerBox ? box.bottom - drawerBox.top : 0) + (many ? (compact ? 30 : 34) : compact ? 12 : 22),
      left: side,
      right: side + (!compact && card ? CARD_ROOM : 0),
    };
  }
  function resize(animate = false): void {
    if (!scene || disposed) return;
    const box = root.getBoundingClientRect();
    const insets = insetsNow();
    // The arrows, the hint and the section dots sit in the room the head and the drawer leave.
    const headBox = head.getBoundingClientRect();
    const drawerBox = drawer && !drawer.hidden ? drawer.getBoundingClientRect() : null;
    root.style.setProperty('--cdsh-head', `${Math.round(Math.max(0, headBox.bottom - box.top))}px`);
    root.style.setProperty('--cdsh-drawer', `${Math.round(drawerBox ? Math.max(0, box.bottom - drawerBox.top) : 0)}px`);
    scene.setSize(box.width, box.height, insets, animate);
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize(false)) : null;
  observer?.observe(root);
  if (drawer) observer?.observe(drawer);
  observer?.observe(head);
  scene?.onLayout(layoutOverlay);

  let chain: Promise<void> = Promise.resolve();
  const settleScene = (animate: boolean) => {
    chain = chain.then(async () => {
      if (!scene || disposed) return;
      const want = baysFor(placements.map(item => item.slot), waiting.length);
      if (want !== bays) {
        bays = want;
        await scene.setBays(want);
        resize(false);
        renderPages();
      }
      await scene.setKeepsakes(placements, animate);
      layoutOverlay();
    });
    return chain;
  };

  read();
  renderDom();
  const firstPlaced = placements[0]?.slot;
  if (firstPlaced !== undefined) focusSlot = firstPlaced;
  if (scene) {
    resize(false);
    void settleScene(false).then(async () => {
      if (!scene || disposed) return;
      const opening = options.openItemId ? placementOf(options.openItemId) : null;
      const start = opening?.slot ?? firstPlaced;
      if (start !== undefined) scene.setPage(pageOfSlot(scene.pages(), start), false);
      resize(false);
      await scene.draw();
      if (disposed) return;
      status.hidden = true;
      root.dataset.state = 'drawn';
      layoutOverlay();
      renderDom();
      if (opening) openCard(opening.id);
      else buttons.get(focusSlot)?.focus({ preventScroll: true });
      // Let the overlay and halos land on the drawn frame before saying so.
      requestAnimationFrame(() => requestAnimationFrame(markReady));
    }).catch((error: unknown) => {
      if (disposed) return;
      status.hidden = false;
      // Only our own sentences reach the person; anything else from the GPU or a worker reads as a plain failure.
      const words: readonly string[] = Object.values(SCENE_WORDS);
      status.textContent = error instanceof Error && words.includes(error.message) ? error.message : SCENE_WORDS.failed;
      root.dataset.state = 'unavailable';
      markReady();
    });
  } else {
    root.focus({ preventScroll: true });
    markReady();
  }

  const unsubscribe = own?.subscribe(() => {
    if (disposed) return;
    read();
    renderDom();
    void settleScene(true).catch(() => undefined);
  }) ?? null;

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    observer?.disconnect();
    if (refusalTimer) clearTimeout(refusalTimer);
    if (settleTimer) clearTimeout(settleTimer);
    if (gesture?.timer) clearTimeout(gesture.timer);
    window.removeEventListener('pointermove', onDrawerMove);
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowCancel);
    if (card) { card.close(); card.holder.remove(); card = null; }
    scene?.dispose();
    root.remove();
  };
};
