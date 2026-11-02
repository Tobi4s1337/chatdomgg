import '@chatdom/ui/kit.css';
import './book.css';
import './page.css';
import type { PierAlmanac } from '@chatdom/shared';
import { mountAlmanac, type AlmanacHandle } from './book';
import { almanacFailure, loadAlmanac } from './fetch';
import type { AlmanacSound } from './sound';
import { placeName } from './words';

export type AlmanacReadyWindow = Window & { __chatdomReady?: boolean; __chatdomAlmanac?: AlmanacHandle };

export interface AlmanacPageOptions {
  readonly kingdomId: string;
  /** Where the book comes from; the realm by default. */
  readonly load?: (kingdomId: string, signal: AbortSignal) => Promise<PierAlmanac>;
  readonly sound?: AlmanacSound;
  /** The page to open on. */
  readonly open?: string;
  readonly still?: boolean;
}

const EMBLEM = (() => {
  let beads = '';
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    beads += `<circle cx="${(60 + Math.sin(a) * 51).toFixed(2)}" cy="${(60 - Math.cos(a) * 51).toFixed(2)}" r="${i % 4 === 0 ? 1.5 : .8}"/>`;
  }
  return `<circle class="alm-em-ring" cx="60" cy="60" r="56"/><circle class="alm-em-ring alm-em-thin" cx="60" cy="60" r="46"/><g class="alm-em-beads">${beads}</g>
  <g transform="translate(-4 2) scale(3.2) translate(-.6 -2)"><path class="alm-em-fish" d="M11.6 20c2.6-3.4 6.1-4.8 9.7-4.1 1.9.4 3.5 1.4 4.8 2.7l2.8-2.4-.5 3.8.5 3.8-2.8-2.4c-1.3 1.3-2.9 2.3-4.8 2.7-3.6.7-7.1-.7-9.7-4.1Z"/><circle class="alm-em-eye" cx="15.6" cy="19.2" r=".8"/></g>`;
})();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The closed Almanac on the desk, its cover tooled in gilt: what a reader sees while it is fetched, or cannot be. */
function closedBook(subtitle: string): HTMLElement {
  const book = el('div', 'almp-closed');
  book.setAttribute('aria-hidden', 'true');
  const cover = el('div', 'almp-cover');
  const emblem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  emblem.setAttribute('class', 'alm-front-emblem');
  emblem.setAttribute('viewBox', '0 0 120 120');
  emblem.innerHTML = EMBLEM;
  cover.append(emblem, el('p', 'alm-front-title', 'The Almanac'), el('p', 'alm-front-sub', subtitle));
  book.append(el('i', 'almp-pages'), cover, el('i', 'almp-band'));
  return book;
}

/**
 * The public Almanac for watchers: the closed book while it is fetched, then the book itself, read-only. Every state
 * says what is happening in the kingdom's words; nothing is ever a blank panel. Returns the teardown.
 */
export function mountAlmanacPage(host: HTMLElement, options: AlmanacPageOptions): () => void {
  const W = window as AlmanacReadyWindow;
  W.__chatdomReady = false;
  const root = el('div', 'almp alm cd-kit');
  host.append(root);
  let book: AlmanacHandle | null = null, controller: AbortController | null = null, ended = false;

  function settle(state: string): void {
    root.dataset.state = state;
  }

  function slip(lines: readonly string[], retry: boolean): void {
    const card = el('div', 'almp-slip');
    card.setAttribute('role', 'alert');
    lines.forEach((line, i) => card.append(el('p', i === 0 ? 'almp-slip-head' : 'almp-slip-line', line)));
    if (retry) {
      const again = el('button', 'almp-again', 'Try again');
      again.type = 'button';
      again.addEventListener('click', () => open());
      card.append(again);
      queueMicrotask(() => again.focus({ preventScroll: true }));
    }
    root.querySelector('.almp-desk')?.append(card);
  }

  function desk(subtitle: string): HTMLElement {
    root.replaceChildren();
    const table = el('div', 'almp-desk');
    table.append(closedBook(subtitle));
    root.append(table);
    return table;
  }

  function open(): void {
    controller?.abort();
    book?.dispose(); book = null;
    const abort = new AbortController();
    controller = abort;
    W.__chatdomReady = false;
    settle('loading');
    const table = desk('of the waters');
    const note = el('p', 'almp-note', 'Taking the Almanac down from its shelf…');
    note.setAttribute('role', 'status');
    table.append(note);
    const load = options.load ?? ((id: string, signal: AbortSignal) => loadAlmanac(id, { signal }));
    load(options.kingdomId, abort.signal).then(almanac => {
      if (ended || abort.signal.aborted) return;
      const name = placeName(almanac.kingdom);
      if (almanac.water === null && almanac.catches === 0) {
        settle('no-pier');
        desk(name ? `of ${name}` : 'of the waters');
        slip([name ? `${name} has no pier yet.` : 'This kingdom has no pier yet.', 'When one is built, every fish caught there will fill this book.'], false);
        W.__chatdomReady = true;
        return;
      }
      settle('open');
      root.replaceChildren();
      const handle = mountAlmanac(root, {
        almanac, mode: 'watcher', marks: null, ...(options.open ? { open: options.open } : {}),
        ...(options.sound ? { sound: options.sound } : {}), ...(options.still ? { still: true } : {}),
      });
      book = handle;
      W.__chatdomAlmanac = handle;
      void handle.ready.then(() => { if (book === handle) W.__chatdomReady = true; });
    }, (error: unknown) => {
      if (ended || abort.signal.aborted) return;
      settle('error');
      desk('of the waters');
      slip([almanacFailure(error)], true);
      W.__chatdomReady = true;
    });
  }

  open();
  return () => {
    ended = true;
    controller?.abort();
    book?.dispose();
    root.remove();
    delete W.__chatdomAlmanac;
  };
}
