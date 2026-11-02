import '@chatdom/ui/kit.css';
import './book.css';
import type { FishSpecies, PierAlmanac, PierAlmanacMark } from '@chatdom/shared';
import { FISH_SPECIES } from '../../../../packages/content/src/fish/species';
import {
  bookLayout, buildLeaves, contentsWords, leafId, leafIndex, navKey, speciesWords, stepIndex, swipeAction,
  type AnyLeaf, type ContentsWords, type Leaf, type SpeciesWords,
} from './pages';
import { paintFish, plateArt, type PlateTint } from './plate';
import type { AlmanacSound } from './sound';
import { placeName } from './words';

export interface AlmanacOptions {
  readonly almanac: PierAlmanac;
  /** The reader's own marks; null or absent for a watcher, who sees no personal marks. */
  readonly marks?: readonly PierAlmanacMark[] | null;
  readonly mode: 'walker' | 'watcher';
  /** The page to open on: the contents, or a species id. */
  readonly open?: 'contents' | string;
  /** Asked when the reader closes the book (Esc or the brass stud). Without it the book has no close. */
  readonly onClose?: () => void;
  readonly sound?: AlmanacSound;
  /** Told the page after every turn, with its id ('contents' or a species id). */
  readonly onPage?: (page: string) => void;
  /** The authored species; the content catalogue by default. */
  readonly species?: readonly FishSpecies[];
  /** Open at rest, without the cover swinging open (review stills). */
  readonly still?: boolean;
}

export interface AlmanacHandle {
  /** Turns to a page: 'contents' or a species id. */
  show(page: 'contents' | string): void;
  /** New facts from the realm; the open page is redrawn in place. Marks left out keep the ones the book has. */
  update(almanac: PierAlmanac, marks?: readonly PierAlmanacMark[] | null): void;
  dispose(): void;
  /** Settles once the book is open and its first pages, renders included, are drawn. */
  readonly ready: Promise<void>;
  /** The open page: 'contents' or a species id. */
  readonly page: string;
}

type Side = 'left' | 'right' | 'single';
interface Face { readonly el: HTMLElement; paint(): Promise<unknown> }

const TURN_MS = 480, SINGLE_TURN_MS = 440, OPEN_MS = 760, FADE_MS = 170;
const TURN_EASE = 'cubic-bezier(.42, .02, .22, 1)';
let books = 0;

/* ---------- Small DOM helpers ---------- */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Static, authored markup only: never a person's words. */
function art(className: string, viewBox: string, body: string): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('class', className);
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.innerHTML = body;
  return node;
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function seeded(text: string): () => number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return () => { hash = Math.imul(hash ^ (hash >>> 15), 2246822507); hash = Math.imul(hash ^ (hash >>> 13), 3266489909); return ((hash ^= hash >>> 16) >>> 0) / 4294967296; };
}

/* ---------- Drawn marks ---------- */

const FISH_PATH = 'M11.6 20c2.6-3.4 6.1-4.8 9.7-4.1 1.9.4 3.5 1.4 4.8 2.7l2.8-2.4-.5 3.8.5 3.8-2.8-2.4c-1.3 1.3-2.9 2.3-4.8 2.7-3.6.7-7.1-.7-9.7-4.1Z';
const WAX_PATH = 'M20 1.9c2.7 0 3.9 1.9 6.3 2.5 2.6.6 4.9-.6 6.8 1.2s.9 4 1.7 6.4c.8 2.4 2.9 3.6 2.9 6.6s-2 4-2.6 6.4c-.6 2.6.6 4.8-1.2 6.6s-4.2 1-6.6 1.8c-2.4.8-3.6 2.8-6.6 2.8s-4.2-2-6.6-2.8c-2.4-.8-4.8 0-6.6-1.8s-.8-4-1.6-6.6C5.2 24.2 2 22.8 2 20s2.4-4.2 3-6.6c.6-2.4-.6-4.8 1.2-6.6 1.8-1.8 4-.8 6.4-1.6C15.2 4.4 17 1.9 20 1.9Z';

/** The kingdom's first: red wax pressed over two silk tails, a fish in relief and a ring of beads from the matrix. */
function sealMarkup(): string {
  let beads = '';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    beads += `<circle cx="${(20 + Math.sin(a) * 10.4).toFixed(2)}" cy="${(20 - Math.cos(a) * 10.4).toFixed(2)}" r=".42"/>`;
  }
  return `<path class="alm-seal-tail" d="M33 44 20 92l8.4-5.6L33 96l11-48Z"/><path class="alm-seal-tail alm-seal-tail-r" d="M47 44l13 48-8.4-5.6L47 96 36 48Z"/>
  <path class="alm-seal-tail-fold" d="M33 44 20 92M47 44l13 48"/>
  <g transform="translate(4 4) scale(1.8)"><path class="alm-seal-wax" d="${WAX_PATH}"/><circle class="alm-seal-face" cx="20" cy="20" r="12.6"/>
  <circle class="alm-seal-rim" cx="20" cy="20" r="12.6"/><g class="alm-seal-beads">${beads}</g><path class="alm-seal-fish" d="${FISH_PATH}"/>
  <circle class="alm-seal-eye" cx="15.6" cy="19.2" r=".95"/><path class="alm-seal-shine" d="M12.4 9.6c2.4-1.7 5.6-2.4 8.6-1.9"/></g>`;
}

const FLEURON = `<path class="alm-fl-line" d="M6 10H96M144 10h90"/><path class="alm-fl-line alm-fl-thin" d="M30 13.5H96M144 13.5h66"/>
  <path class="alm-fl-curl" d="M96 10c3-6 10-7 13-2 2 3-1 6-4 5M144 10c-3-6-10-7-13-2-2 3 1 6 4 5"/>
  <path class="alm-fl-gem" d="M120 3.5l6.5 6.5-6.5 6.5-6.5-6.5Z"/><circle class="alm-fl-dot" cx="120" cy="10" r="1.6"/>
  <circle class="alm-fl-dot" cx="4" cy="10" r="1.5"/><circle class="alm-fl-dot" cx="236" cy="10" r="1.5"/>`;
const CHEVRON = '<path d="M9.5 4.5 17 12l-7.5 7.5"/>';
const CLOSE = '<path d="M6 6l12 12M18 6 6 18"/>';
const TICK = '<path class="alm-tick-ring" d="M9 26c-2.4-9.6 5-18.4 15.6-18.6 9.8-.2 17.2 6.6 16.4 16.2-.8 9.8-8.8 16.6-18 16.2C15.2 39.4 10.4 33.8 9 26.8"/><path class="alm-tick-mark" d="M15.5 24.5c2.2 1.6 4.4 4 6 6.6 3.4-6.4 8.6-12.6 14.6-17"/>';
const STAR = '<path d="M12 2.6l2.7 6.2 6.7.6-5.1 4.4 1.6 6.6L12 16.9l-5.9 3.5 1.6-6.6-5.1-4.4 6.7-.6Z"/>';
const TALLY_FISH = '<path d="M1.6 7c2.4-3.3 6-4.6 9.6-4 1.7.3 3.2 1.1 4.4 2.3L18.4 3l-.4 4 .4 4-2.8-2.3c-1.2 1.2-2.7 2-4.4 2.3-3.6.6-7.2-.7-9.6-4Z"/>';
const EMBLEM = (() => {
  let beads = '';
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    beads += `<circle cx="${(60 + Math.sin(a) * 51).toFixed(2)}" cy="${(60 - Math.cos(a) * 51).toFixed(2)}" r="${i % 4 === 0 ? 1.5 : .8}"/>`;
  }
  return `<circle class="alm-em-ring" cx="60" cy="60" r="56"/><circle class="alm-em-ring alm-em-thin" cx="60" cy="60" r="46"/><g class="alm-em-beads">${beads}</g>
  <g transform="translate(-4 2) scale(3.2) translate(-.6 -2)"><path class="alm-em-fish" d="M11.6 20c2.6-3.4 6.1-4.8 9.7-4.1 1.9.4 3.5 1.4 4.8 2.7l2.8-2.4-.5 3.8.5 3.8-2.8-2.4c-1.3 1.3-2.9 2.3-4.8 2.7-3.6.7-7.1-.7-9.7-4.1Z"/><circle class="alm-em-eye" cx="15.6" cy="19.2" r=".8"/></g>`;
})();

/* ---------- The book ---------- */

export function mountAlmanac(host: HTMLElement, options: AlmanacOptions): AlmanacHandle {
  const id = `alm-${(books += 1)}`;
  const species = options.species ?? FISH_SPECIES;
  const watcher = options.mode === 'watcher';
  let almanac = options.almanac;
  let marks: readonly PierAlmanacMark[] | null = watcher ? null : options.marks ?? null;
  let leaves: AnyLeaf[] = buildLeaves(almanac, species, marks);
  let index = leafIndex(leaves, options.open);
  let layout: 'spread' | 'single' = bookLayout(host.clientWidth, host.clientHeight);
  let disposed = false;

  const restorePosition = getComputedStyle(host).position === 'static';
  if (restorePosition) host.style.position = 'relative';

  const kingdom = () => placeName(almanac.kingdom);
  const context = () => ({ kingdom: kingdom(), asOf: almanac.asOf, watcher });

  /* The frame: a scrim, the stage, the boards, the page block and the fittings around it. */
  const root = el('section', 'alm cd-kit');
  root.dataset.mode = options.mode;
  root.setAttribute('aria-roledescription', 'book');
  root.tabIndex = -1;
  const defs = art('alm-defs', '0 0 1 1', `<defs><filter id="${id}-pencil" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="5" result="g"/>
    <feDisplacementMap in="SourceGraphic" in2="g" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>
    <linearGradient id="${id}-gilt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8e6327"/><stop offset=".3" stop-color="#f3d68c"/>
    <stop offset=".5" stop-color="#c9993f"/><stop offset=".72" stop-color="#fbe7ad"/><stop offset="1" stop-color="#9b6d2c"/></linearGradient></defs>`);
  root.append(defs);
  const stage = el('div', 'alm-stage');
  const book = el('div', 'alm-book');
  const boards = el('div', 'alm-boards');
  boards.setAttribute('aria-hidden', 'true');
  boards.append(el('i', 'alm-spine'), ...['tl', 'tr', 'bl', 'br'].map(corner => el('i', `alm-brass alm-brass-${corner}`)));
  const block = el('div', 'alm-block');
  const spread = el('div', 'alm-spread');
  const slotLeft = el('div', 'alm-slot alm-slot-left');
  const slotRight = el('div', 'alm-slot alm-slot-right');
  const gutter = el('div', 'alm-gutter');
  gutter.setAttribute('aria-hidden', 'true');
  spread.append(slotLeft, slotRight, gutter);
  block.append(spread);

  const control = (className: string, label: string, body: SVGSVGElement | null, onPress: () => void): HTMLButtonElement => {
    const button = el('button', `alm-control ${className}`);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    if (body) button.append(body);
    button.addEventListener('click', event => { event.stopPropagation(); onPress(); });
    return button;
  };
  const prevTab = control('alm-tab alm-tab-prev', 'Previous page', art('alm-tab-mark', '0 0 24 24', CHEVRON), () => go(index - 1));
  const nextTab = control('alm-tab alm-tab-next', 'Next page', art('alm-tab-mark', '0 0 24 24', CHEVRON), () => go(index + 1));
  const prevCorner = control('alm-curl alm-curl-prev', 'Previous page', null, () => go(index - 1));
  const nextCorner = control('alm-curl alm-curl-next', 'Next page', null, () => go(index + 1));
  prevCorner.tabIndex = -1; nextCorner.tabIndex = -1;
  const ribbon = control('alm-ribbon', 'Contents', null, () => go(0));
  ribbon.append(el('span', 'alm-ribbon-silk'), el('span', 'alm-ribbon-words', 'Contents'));
  const closer = options.onClose ? control('alm-close', 'Close the Almanac', art('alm-close-mark', '0 0 24 24', CLOSE), () => close()) : null;
  book.append(boards, block, prevCorner, nextCorner, prevTab, nextTab, ribbon);
  if (closer) book.append(closer);
  stage.append(book);
  const announcer = el('p', 'alm-sr');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  root.append(stage, announcer);
  host.append(root);

  /* ---------- Sizing ---------- */

  function size(): void {
    const width = host.clientWidth, height = host.clientHeight;
    layout = bookLayout(width, height);
    root.dataset.layout = layout;
    let w: number, h: number;
    if (layout === 'spread') {
      const availW = Math.max(320, width - 170), availH = Math.max(320, height - 124);
      h = Math.min(availH, availW / 1.56, 900);
      w = h * 1.56;
    } else {
      const availW = Math.max(240, width - 16), availH = Math.max(360, height - 16);
      h = Math.min(availH, 940);
      w = Math.min(availW, h * 0.74, 560);
    }
    book.style.width = `${Math.round(w)}px`;
    book.style.height = `${Math.round(h)}px`;
  }

  /* ---------- Pages ---------- */

  function tintOf(leaf: Leaf): PlateTint { return leaf.plate.chapter; }

  function paper(side: Side, legend: boolean, seed: string): HTMLElement {
    const face = el('div', 'alm-face');
    face.dataset.side = side;
    if (legend) face.dataset.legend = 'true';
    // A few faint foxing marks, the same on the same page every time.
    const random = seeded(seed + side);
    const spots = Array.from({ length: 3 }, () => `radial-gradient(circle at ${(8 + random() * 84).toFixed(1)}% ${(6 + random() * 88).toFixed(1)}%, #a0743c${Math.round(8 + random() * 10).toString(16).padStart(2, '0')} 0, transparent ${(14 + random() * 26).toFixed(0)}px)`);
    face.style.setProperty('--alm-fox', spots.join(', '));
    return face;
  }

  function folioLine(text: string, side: Side): HTMLElement {
    const line = el('p', 'alm-folio', text);
    line.dataset.side = side;
    line.setAttribute('aria-hidden', 'true');
    return line;
  }

  function plateFigure(leaf: Leaf, words: SpeciesWords): { node: HTMLElement; paint: () => Promise<unknown> } {
    const figure = el('figure', 'alm-plate');
    figure.dataset.status = leaf.status;
    if (words.legend) figure.dataset.legend = 'true';
    const frame = el('div', 'alm-plate-frame');
    const canvas = el('canvas', 'alm-plate-art');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', leaf.status === 'caught' ? `A drawing of the ${words.title}` : leaf.status === 'waiting' ? 'The dark shape of an unknown fish' : 'A pencil sketch of an unknown fish');
    const empty = el('p', 'alm-plate-empty');
    empty.append(art('alm-plate-empty-mark', '0 0 240 20', FLEURON));
    if (import.meta.env.DEV) empty.append(el('span', 'alm-plate-empty-words', 'This plate is still being drawn.'));
    frame.append(canvas, empty);
    if (words.legend) frame.append(art('alm-plate-star', '0 0 24 24', STAR));
    figure.append(frame, el('figcaption', 'alm-plate-caption', words.caption));
    if (leaf.status === 'caught' && leaf.entry.first) {
      const seal = art('alm-seal', '0 0 80 100', sealMarkup());
      figure.append(seal);
      figure.dataset.seal = 'true';
    }
    return {
      node: figure,
      paint: async () => {
        const width = canvas.clientWidth, height = canvas.clientHeight;
        if (!width || !height) return;
        const margin = leaf.status === 'caught' ? 0.06 : 0.14;
        const drawn = await paintFish(canvas, leaf.plate.species.id, leaf.status, width, height, { tint: tintOf(leaf), margin, wash: true });
        frame.dataset.art = drawn ? 'drawn' : 'none';
      },
    };
  }

  function speciesText(words: SpeciesWords, container: HTMLElement): void {
    const head = el('header', 'alm-heading');
    const eyebrow = el('p', 'alm-eyebrow');
    if (words.legend) eyebrow.append(art('alm-eyebrow-star', '0 0 24 24', STAR));
    eyebrow.append(document.createTextNode(words.eyebrow));
    const title = el('h2', words.status === 'caught' ? 'alm-name' : 'alm-name alm-name-riddle', words.title);
    title.tabIndex = -1;
    title.id = `${id}-title-${words.id.replace(/[^a-z0-9-]/gi, '')}`;
    head.append(eyebrow, title, art('alm-fleuron', '0 0 240 20', FLEURON));
    container.append(head);
    if (words.lore) container.append(el('p', 'alm-lore', words.lore));
    if (words.hint) {
      // One sentence to a line, so a narrow page never breaks a thought in half.
      const hint = el('p', 'alm-hint');
      for (const sentence of words.hint.match(/[^.!?]+[.!?]+/g) ?? [words.hint]) hint.append(el('span', 'alm-hint-line', sentence.trim()));
      container.append(hint);
    }

    const where = el('section', 'alm-section');
    where.append(el('h3', 'alm-label', 'Where it bites'), el('p', 'alm-prose', [words.whereWhen, words.size].filter(Boolean).join(' ')));
    container.append(where);

    if (words.status === 'caught') {
      const record = el('section', 'alm-section alm-record');
      record.append(el('h3', 'alm-label', kingdom() ? `In ${kingdom()}` : 'In this kingdom'));
      // One paragraph under a rubric initial, as a chronicle would set it.
      const story = [words.first, words.biggest, words.count, words.mounts].filter(Boolean).join(' ');
      if (story) record.append(el('p', words.first ? 'alm-prose alm-first' : 'alm-prose', story));
      container.append(record);
    }
    if (words.mark) {
      const mark = el('aside', 'alm-mark');
      mark.setAttribute('aria-label', [words.mark.head, ...words.mark.lines].join(', '));
      const tick = art('alm-tick', '0 0 48 48', TICK);
      tick.querySelectorAll('path').forEach(path => path.setAttribute('filter', `url(#${id}-pencil)`));
      const lines = el('div', 'alm-mark-words');
      lines.setAttribute('aria-hidden', 'true');
      lines.append(el('p', 'alm-mark-head', words.mark.head), ...words.mark.lines.map(line => el('p', 'alm-mark-line', line)));
      mark.append(tick, lines);
      container.append(mark);
    }
  }

  function speciesFace(leaf: Leaf, side: Side): Face {
    const words = speciesWords(leaf, context());
    const face = paper(side, words.legend, leaf.plate.species.id);
    face.dataset.status = leaf.status;
    const inner = el('div', 'alm-in');
    face.append(inner);
    let paintPlate: (() => Promise<unknown>) | null = null;
    if (side === 'left' || side === 'single') {
      if (side === 'left') inner.append(el('p', 'alm-running alm-running-plate', words.plateLabel));
      else inner.append(el('p', 'alm-running alm-running-plate', `${words.plateLabel} · ${words.runningHead}`));
      const plate = plateFigure(leaf, words);
      paintPlate = plate.paint;
      inner.append(plate.node);
    }
    if (side === 'right' || side === 'single') {
      if (side === 'right') inner.append(el('p', 'alm-running', words.runningHead));
      const text = el('div', 'alm-text');
      speciesText(words, text);
      inner.append(text);
    }
    if (side !== 'single') inner.append(folioLine(side === 'left' ? words.folios[0] : words.folios[1], side));
    return { el: face, paint: () => (paintPlate ? paintPlate() : Promise.resolve()) };
  }

  function titlePage(words: ContentsWords, container: HTMLElement, compact: boolean): void {
    const top = el('header', 'alm-title-block');
    top.append(art('alm-fleuron alm-fleuron-top', '0 0 240 20', FLEURON));
    if (!compact) top.append(el('p', 'alm-title-kicker', 'Being a true record of the fish'));
    top.append(el('h1', 'alm-title', words.title), el('p', 'alm-title-sub', words.sub), art('alm-fleuron', '0 0 240 20', FLEURON));
    container.append(top);

    const tally = el('section', 'alm-tally');
    tally.setAttribute('aria-label', words.summary);
    const count = el('p', 'alm-tally-words');
    count.setAttribute('aria-hidden', 'true');
    count.append(el('span', 'alm-tally-num', String(words.known)), el('span', 'alm-tally-of', ` of ${words.total} known ${kingdom() ? `in ${kingdom()}` : 'here'}`));
    const shoal = el('div', 'alm-shoal');
    shoal.setAttribute('aria-hidden', 'true');
    for (const leaf of leaves) if (leaf.kind === 'species') {
      const fish = art('alm-shoal-fish', '0 0 20 14', TALLY_FISH);
      fish.dataset.status = leaf.status;
      if (leaf.plate.species.legend) fish.dataset.legend = 'true';
      shoal.append(fish);
    }
    tally.append(count, shoal);
    container.append(tally);

    const notes = el('div', 'alm-title-notes');
    notes.append(el('p', 'alm-prose', words.catches), el('p', 'alm-prose', words.water));
    if (words.marks) {
      const pencil = el('p', 'alm-pencil', words.marks);
      notes.append(pencil);
    }
    container.append(notes);

    const key = el('ul', 'alm-key');
    key.setAttribute('aria-label', 'How to read the marks');
    for (const item of words.key) {
      const row = el('li', 'alm-key-row');
      const mark = el('span', 'alm-key-mark');
      mark.dataset.mark = item.mark;
      if (item.mark === 'seal') mark.append(art('alm-seal alm-seal-key', '4 4 72 72', sealMarkup()));
      else if (item.mark === 'tick') { const t = art('alm-tick', '0 0 48 48', TICK); t.querySelectorAll('path').forEach(path => path.setAttribute('filter', `url(#${id}-pencil)`)); mark.append(t); }
      else mark.append(art('alm-key-fish', '0 0 20 14', TALLY_FISH));
      row.append(mark, el('span', 'alm-key-words', item.words));
      key.append(row);
    }
    container.append(key);
    if (words.asOf) container.append(el('p', 'alm-asof', words.asOf));
  }

  function indexPage(words: ContentsWords, container: HTMLElement, side: Side): (() => Promise<unknown>)[] {
    if (side !== 'single') container.append(el('p', 'alm-running', 'The plates'));
    const columns = el('div', 'alm-index');
    type Item = { kind: 'head'; title: string } | { kind: 'row'; row: ContentsWords['chapters'][number]['rows'][number] };
    const items: Item[] = words.chapters.flatMap(chapter => [{ kind: 'head' as const, title: chapter.title }, ...chapter.rows.map(row => ({ kind: 'row' as const, row }))]);
    let split = side === 'single' ? items.length : Math.ceil(items.length / 2);
    while (split > 1 && items[split - 1]!.kind === 'head') split -= 1;
    const paints: (() => Promise<unknown>)[] = [];
    for (const part of [items.slice(0, split), items.slice(split)]) {
      if (!part.length) continue;
      const column = el('div', 'alm-index-col');
      for (const item of part) {
        if (item.kind === 'head') { column.append(el('h3', 'alm-chapter', item.title)); continue; }
        const { row } = item;
        const button = el('button', 'alm-row');
        button.type = 'button';
        button.dataset.status = row.status;
        if (row.legend) button.dataset.legend = 'true';
        button.setAttribute('aria-label', row.label);
        const thumb = el('canvas', 'alm-row-art');
        thumb.setAttribute('aria-hidden', 'true');
        const name = el('span', 'alm-row-name', row.name);
        if (row.mine) name.append(art('alm-tick alm-tick-small', '0 0 48 48', TICK));
        const wordsBox = el('span', 'alm-row-words');
        wordsBox.append(name, el('span', 'alm-row-state', row.state));
        button.append(el('span', 'alm-row-plate', row.plate), thumb, wordsBox, el('span', 'alm-row-leader'), el('span', 'alm-row-folio', row.folio));
        button.addEventListener('click', event => { event.stopPropagation(); go(leafIndex(leaves, row.id)); });
        column.append(button);
        const leaf = leaves[leafIndex(leaves, row.id)] as Leaf;
        paints.push(() => thumb.clientWidth ? paintFish(thumb, row.id, row.status, thumb.clientWidth, thumb.clientHeight, { tint: leaf.plate.chapter, margin: 0.04 }) : Promise.resolve(false));
      }
      columns.append(column);
    }
    container.append(columns);
    if (side !== 'single') container.append(folioLine('2', side));
    return paints;
  }

  function contentsFace(side: Side): Face {
    const words = contentsWords(leaves, almanac, { ...context(), marks });
    const face = paper(side, false, 'contents');
    face.dataset.contents = 'true';
    const inner = el('div', 'alm-in');
    face.append(inner);
    let paints: (() => Promise<unknown>)[] = [];
    if (side === 'left') titlePage(words, inner, false);
    if (side === 'single') {
      const top = el('div', 'alm-single-title');
      titlePage(words, top, true);
      inner.append(top);
    }
    if (side === 'right' || side === 'single') paints = indexPage(words, inner, side);
    return { el: face, paint: () => Promise.all(paints.map(paint => paint())) };
  }

  function face(leaf: AnyLeaf, side: Side): Face {
    return leaf.kind === 'contents' ? contentsFace(side) : speciesFace(leaf, side);
  }

  /** A turned leaf's other side when only one page shows: the back of the paper, with a ghost of the print through it. */
  function blankFace(): Face {
    const face = paper('single', false, 'verso');
    face.dataset.verso = 'true';
    return { el: face, paint: () => Promise.resolve() };
  }

  /* ---------- Placing pages ---------- */

  const faces: { left: Face | null; right: Face | null } = { left: null, right: null };

  function within(ms: number, work: Promise<unknown>): Promise<unknown> {
    return Promise.race([work, new Promise(resolve => setTimeout(resolve, ms))]);
  }

  function attach(slot: HTMLElement, made: Face): void {
    slot.replaceChildren(made.el);
  }

  function markScroll(made: Face | null): void {
    const inner = made?.el.querySelector<HTMLElement>('.alm-in');
    if (!inner) return;
    const face = made!.el;
    const read = (): void => {
      const rest = inner.scrollHeight - inner.clientHeight - inner.scrollTop;
      face.dataset.scroll = inner.scrollHeight > inner.clientHeight + 4 && rest > 4 ? 'true' : 'false';
    };
    read();
    if (!inner.dataset.watched) {
      inner.dataset.watched = 'true';
      inner.addEventListener('scroll', read, { passive: true });
    }
  }

  function chrome(): void {
    const leaf = leaves[index]!;
    const last = leaves.length - 1;
    const atStart = index === 0, atEnd = index === last;
    for (const button of [prevTab, prevCorner]) { button.disabled = atStart; button.dataset.hidden = atStart ? 'true' : 'false'; }
    for (const button of [nextTab, nextCorner]) { button.disabled = atEnd; button.dataset.hidden = atEnd ? 'true' : 'false'; }
    const name = (at: number) => { const l = leaves[at]; return !l ? '' : l.kind === 'contents' ? 'the contents' : l.status === 'caught' ? l.plate.species.name : 'an unknown fish'; };
    prevTab.setAttribute('aria-label', atStart ? 'Previous page' : `Previous page: ${name(index - 1)}`);
    nextTab.setAttribute('aria-label', atEnd ? 'Next page' : `Next page: ${name(index + 1)}`);
    ribbon.dataset.here = leaf.kind === 'contents' ? 'true' : 'false';
    ribbon.setAttribute('aria-current', leaf.kind === 'contents' ? 'page' : 'false');
    root.dataset.page = leafId(leaf);
    root.setAttribute('aria-label', kingdom() ? `The Almanac of ${kingdom()}` : 'The Almanac');
    // Each spread's paper stack: the turned pages pile on the left, the rest wait on the right.
    const share = leaves.length > 1 ? index / (leaves.length - 1) : 0;
    book.style.setProperty('--alm-stack-l', (1 + share * 5).toFixed(2));
    book.style.setProperty('--alm-stack-r', (1 + (1 - share) * 5).toFixed(2));
    book.dataset.legend = leaf.kind === 'species' && leaf.plate.species.legend ? 'true' : 'false';
  }

  /** Lays the spread for the current page at rest. Resolves when its pictures are drawn. */
  function place(): Promise<unknown> {
    const leaf = leaves[index]!;
    spread.dataset.layout = layout;
    let work: Promise<unknown>;
    if (layout === 'spread') {
      faces.left = face(leaf, 'left'); faces.right = face(leaf, 'right');
      attach(slotLeft, faces.left); attach(slotRight, faces.right);
      slotLeft.hidden = false;
      work = Promise.all([faces.left.paint(), faces.right.paint()]);
    } else {
      faces.left = null; faces.right = face(leaf, 'single');
      slotLeft.replaceChildren(); slotLeft.hidden = true;
      attach(slotRight, faces.right);
      work = faces.right.paint();
    }
    markScroll(faces.left); markScroll(faces.right);
    chrome();
    return work;
  }

  /** Warms the next and previous plates so a turn never waits on a render. */
  function warm(): void {
    for (const at of [index + 1, index - 1, index + 2]) {
      const leaf = leaves[at];
      if (leaf?.kind !== 'species') continue;
      const canvas = slotRight.querySelector<HTMLCanvasElement>('.alm-plate-art') ?? slotLeft.querySelector<HTMLCanvasElement>('.alm-plate-art');
      const width = canvas?.clientWidth || 420;
      void plateArt(leaf.plate.species.id, leaf.status, Math.min(1024, Math.max(48, width * 1.06))).catch(() => undefined);
    }
  }

  /* ---------- Turning ---------- */

  let turning: { finish(): void } | null = null;
  let pending: number | null = null;

  function announce(): void {
    const leaf = leaves[index]!;
    if (leaf.kind === 'contents') announcer.textContent = contentsWords(leaves, almanac, { ...context(), marks }).announce;
    else announcer.textContent = speciesWords(leaf, context()).announce;
  }

  function settleFocus(hadFocus: boolean): void {
    if (!hadFocus) return;
    const target = root.querySelector<HTMLElement>('.alm-name') ?? root;
    target.focus({ preventScroll: true });
  }

  function go(target: number): void {
    if (disposed) return;
    const to = stepIndex(target, 0, leaves.length);
    if (turning) { pending = to; turning.finish(); return; }
    if (to === index) return;
    turn(to);
  }

  function turn(to: number): void {
    const from = index, forward = to > from;
    const hadFocus = root.contains(document.activeElement) && document.activeElement !== root
      && !(document.activeElement instanceof HTMLButtonElement && document.activeElement.closest('.alm-tab, .alm-ribbon, .alm-close'));
    const target = leaves[to]!;
    options.sound?.turn();
    index = to;

    const done = () => {
      turning = null;
      chrome();
      announce();
      warm();
      settleFocus(hadFocus);
      options.onPage?.(leafId(leaves[index]!));
      if (pending !== null) { const next = pending; pending = null; if (next !== index) turn(next); }
    };

    if (reducedMotion()) {
      void place();
      for (const node of spread.querySelectorAll<HTMLElement>('.alm-face')) node.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
      done();
      return;
    }

    const animations: Animation[] = [];
    let finished = false;
    const cleanups: (() => void)[] = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      for (const animation of animations) { try { animation.cancel(); } catch { /* already gone */ } }
      for (const cleanup of cleanups) cleanup();
      done();
    };
    turning = { finish };

    const leaf = el('div', 'alm-leaf');
    const front = el('div', 'alm-leaf-side alm-leaf-front');
    const back = el('div', 'alm-leaf-side alm-leaf-back');
    const frontShade = el('i', 'alm-leaf-shade'), backShade = el('i', 'alm-leaf-shade');
    const cast = el('i', 'alm-cast');
    leaf.append(front, back);

    if (layout === 'spread') {
      const nextLeft = face(target, 'left'), nextRight = face(target, 'right');
      const turningFace = forward ? faces.right! : faces.left!;
      leaf.dataset.dir = forward ? 'next' : 'prev';
      front.append(turningFace.el, frontShade);
      back.append((forward ? nextLeft : nextRight).el, backShade);
      // Underneath: the page that stays, and the far page of the spread we are turning to.
      if (forward) attach(slotRight, nextRight); else attach(slotLeft, nextLeft);
      (forward ? slotRight : slotLeft).append(cast);
      spread.append(leaf);
      cleanups.push(() => {
        leaf.remove(); cast.remove();
        attach(slotLeft, nextLeft); attach(slotRight, nextRight);
        faces.left = nextLeft; faces.right = nextRight;
        markScroll(faces.left); markScroll(faces.right);
      });
      const run = () => {
        if (finished) return;
        const sign = forward ? -1 : 1, duration = TURN_MS;
        animations.push(leaf.animate([
          { transform: 'rotateY(0deg) translateZ(0.1px)' },
          { transform: `rotateY(${sign * 62}deg) translateZ(0.1px) scaleX(1.012)`, offset: 0.36 },
          { transform: `rotateY(${sign * 180}deg) translateZ(0.1px)` },
        ], { duration, easing: TURN_EASE, fill: 'forwards' }));
        animations.push(frontShade.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.48 }, { opacity: 0.9 }], { duration, easing: TURN_EASE, fill: 'forwards' }));
        animations.push(backShade.animate([{ opacity: 0.9 }, { opacity: 0.5, offset: 0.52 }, { opacity: 0 }], { duration, easing: TURN_EASE, fill: 'forwards' }));
        animations.push(cast.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration, easing: 'ease-in-out', fill: 'forwards' }));
        const main = animations[0]!;
        main.onfinish = finish;
      };
      void within(220, Promise.all([nextLeft.paint(), nextRight.paint()])).then(run);
    } else {
      const next = face(target, 'single');
      leaf.dataset.dir = forward ? 'next' : 'prev';
      leaf.dataset.single = 'true';
      const verso = blankFace();
      if (forward) {
        front.append(faces.right!.el, frontShade);
        back.append(verso.el, backShade);
        attach(slotRight, next);
      } else {
        front.append(next.el, frontShade);
        back.append(verso.el, backShade);
      }
      slotRight.append(cast);
      spread.append(leaf);
      cleanups.push(() => {
        leaf.remove(); cast.remove();
        attach(slotRight, next);
        faces.right = next;
        markScroll(next);
      });
      const run = () => {
        if (finished) return;
        const duration = SINGLE_TURN_MS;
        const frames = forward
          ? [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-70deg) scaleX(1.01)', opacity: 1, offset: 0.42 }, { transform: 'rotateY(-150deg)', opacity: 0 }]
          : [{ transform: 'rotateY(-150deg)', opacity: 0 }, { transform: 'rotateY(-70deg) scaleX(1.01)', opacity: 1, offset: 0.58 }, { transform: 'rotateY(0deg)', opacity: 1 }];
        animations.push(leaf.animate(frames, { duration, easing: TURN_EASE, fill: 'forwards' }));
        animations.push(frontShade.animate(forward ? [{ opacity: 0 }, { opacity: 0.8 }] : [{ opacity: 0.8 }, { opacity: 0 }], { duration, easing: TURN_EASE, fill: 'forwards' }));
        animations.push(cast.animate(forward ? [{ opacity: 0.9 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0.9 }], { duration, easing: 'ease-in-out', fill: 'forwards' }));
        animations[0]!.onfinish = finish;
      };
      void within(220, next.paint()).then(run);
    }
  }

  /* ---------- Opening and closing ---------- */

  let opening: Animation[] = [];
  function openCover(): Promise<void> {
    if (options.still || reducedMotion() || typeof book.animate !== 'function') {
      book.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: options.still ? 0 : 200, fill: 'backwards' });
      return Promise.resolve();
    }
    const cover = el('div', 'alm-front');
    cover.setAttribute('aria-hidden', 'true');
    const outside = el('div', 'alm-front-side alm-front-out');
    outside.append(art('alm-front-emblem', '0 0 120 120', EMBLEM), el('p', 'alm-front-title', 'The Almanac'),
      el('p', 'alm-front-sub', kingdom() ? `of ${kingdom()}` : 'of the waters'));
    const inside = el('div', 'alm-front-side alm-front-in');
    cover.append(outside, inside);
    cover.dataset.single = layout === 'single' ? 'true' : 'false';
    book.append(cover);
    root.dataset.opening = 'true';
    opening = [
      book.animate([{ transform: 'translateY(18px) scale(.975)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }),
      cover.animate(layout === 'spread'
        ? [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-150deg)', offset: 0.82 }, { transform: 'rotateY(-180deg)' }]
        : [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-120deg)', opacity: 1, offset: 0.7 }, { transform: 'rotateY(-160deg)', opacity: 0 }],
      { duration: OPEN_MS, delay: 220, easing: 'cubic-bezier(.5,.02,.3,1)', fill: 'both' }),
    ];
    // The board's marbled inside dissolves as it lands, so the first plate shows through rather than cutting in. Only
    // the inner face fades: opacity on the turning board itself would flatten its 3D and show the cover mirrored.
    if (layout === 'spread') opening.push(inside.animate([{ opacity: 1 }, { opacity: 1, offset: 0.66 }, { opacity: 0.7, offset: 0.84 }, { opacity: 0 }],
      { duration: OPEN_MS, delay: 220, easing: 'cubic-bezier(.5,.02,.3,1)', fill: 'both' }));
    const left = slotLeft.animate([{ opacity: 0 }, { opacity: 0, offset: 0.62 }, { opacity: 1 }], { duration: OPEN_MS + 220, easing: 'linear', fill: 'backwards' });
    opening.push(left);
    // A closed book shows only its front board: the back board comes into view as the cover swings over it.
    if (layout === 'spread') opening.push(boards.animate([{ clipPath: 'inset(-60px -60px -60px 50%)' }, { clipPath: 'inset(-60px -60px -60px 50%)', offset: 0.5 },
      { clipPath: 'inset(-60px -60px -60px 0%)', offset: 0.78 }, { clipPath: 'inset(-60px -60px -60px 0%)' }], { duration: OPEN_MS + 220, easing: 'ease-out', fill: 'backwards' }));
    return opening[1]!.finished.then(() => undefined, () => undefined).finally(() => {
      cover.remove(); delete root.dataset.opening; opening = [];
    });
  }

  function close(): void {
    if (disposed) return;
    options.sound?.close();
    options.onClose?.();
  }

  /* ---------- Input ---------- */

  function onKey(event: KeyboardEvent): void {
    if (disposed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const action = navKey(event.key);
    if (!action) return;
    if (action === 'close') { if (options.onClose) { event.preventDefault(); close(); } return; }
    event.preventDefault();
    if (action === 'next') go(index + 1);
    else if (action === 'prev') go(index - 1);
    else if (action === 'contents') go(0);
    else go(leaves.length - 1);
  }
  window.addEventListener('keydown', onKey);

  let swipe: { id: number; x: number; y: number; at: number } | null = null;
  const onDown = (event: PointerEvent) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
  };
  const onUp = (event: PointerEvent) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const action = swipeAction(event.clientX - swipe.x, event.clientY - swipe.y, performance.now() - swipe.at);
    swipe = null;
    if (action === 'next') go(index + 1); else if (action === 'prev') go(index - 1);
  };
  const onCancel = () => { swipe = null; };
  block.addEventListener('pointerdown', onDown);
  block.addEventListener('pointerup', onUp);
  block.addEventListener('pointercancel', onCancel);

  let lastLayout = layout;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (disposed) return;
    size();
    if (layout !== lastLayout) { lastLayout = layout; turning?.finish(); void place(); }
    else { markScroll(faces.left); markScroll(faces.right); }
  }) : null;

  /* ---------- Start ---------- */

  size();
  lastLayout = layout;
  const first = place();
  announce();
  options.sound?.open();
  const opened = openCover();
  observer?.observe(host);
  root.focus({ preventScroll: true });
  const ready = Promise.all([within(60_000, first), opened]).then(() => {
    // Fonts settle the layout; the scroll hints are read once they have.
    markScroll(faces.left); markScroll(faces.right);
    warm();
  });

  return {
    show(page) { go(leafIndex(leaves, page)); },
    update(next, nextMarks) {
      if (disposed) return;
      almanac = next;
      if (nextMarks !== undefined) marks = watcher ? null : nextMarks;
      const current = leafId(leaves[index]!);
      leaves = buildLeaves(almanac, species, marks);
      turning?.finish();
      index = leafIndex(leaves, current);
      void place();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      turning?.finish();
      for (const animation of opening) animation.cancel();
      window.removeEventListener('keydown', onKey);
      observer?.disconnect();
      root.remove();
      if (restorePosition) host.style.position = '';
    },
    ready,
    get page() { return leafId(leaves[index]!); },
  };
}
