import type { ItemEvent, ItemRecord } from '@chatdom/shared';
import './bag.css';
import { el, SEAL_MARKUP, svg, type BagSound } from './dom';
import { eventWords, isFish, kindLabel, loreOf, titleOf } from './kinds';
import { paintItemPortrait } from './portrait';
import { formatLength, formatMoment, formatOrigin, formatTally, formatWeight, formatWhere } from './words';

export interface ItemCardOptions {
  readonly viewerPersonId?: string;
  readonly history?: () => Promise<readonly ItemEvent[]>;
  readonly onClose?: () => void;
  /** The picture's size in CSS pixels. By default it follows the space the card has. */
  readonly portraitSize?: number;
  readonly sound?: BagSound;
}

const SHOWN_EVENTS = 6;
let cards = 0;

const num = (value: string | number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;

/** A small seeded deckle: paper torn by hand, the same for the same thing every time. */
function deckle(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const j = () => (rand() * 1.8).toFixed(2);
  const cut = 22, steps = 14, points: string[] = [];
  points.push(`${j()}px ${cut}px`, `${cut}px ${j()}px`);
  for (let i = 1; i < steps; i++) points.push(`calc(${cut}px + (100% - ${cut * 2}px) * ${(i / steps).toFixed(3)}) ${j()}px`);
  points.push(`calc(100% - ${cut}px) ${j()}px`, `calc(100% - ${j()}px) ${cut}px`);
  for (let i = 1; i < steps; i++) points.push(`calc(100% - ${j()}px) calc(${cut}px + (100% - ${cut}px) * ${(i / steps).toFixed(3)})`);
  points.push(`calc(100% - ${j()}px) calc(100% - ${j()}px)`);
  for (let i = steps - 1; i > 0; i--) points.push(`calc(100% * ${(i / steps).toFixed(3)}) calc(100% - ${j()}px)`);
  points.push(`${j()}px calc(100% - ${j()}px)`);
  for (let i = steps - 1; i > 0; i--) points.push(`${j()}px calc(${cut}px + (100% - ${cut}px) * ${(i / steps).toFixed(3)})`);
  return `polygon(${points.join(', ')})`;
}

function facts(item: ItemRecord, owner: boolean): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const stack = item.count > 1;
  const best = num(item.detail.bestWeightG) ?? num(item.detail.weightG);
  const weight = best === null ? '' : formatWeight(best);
  if (weight) out.push({ label: stack ? 'Best weight' : 'Weight', value: weight });
  const length = stack ? '' : formatLength(num(item.detail.lengthMm) ?? NaN);
  if (length) out.push({ label: 'Length', value: length });
  if (item.number !== null && Number.isInteger(item.number) && item.number > 0) out.push({ label: 'Keepsake', value: `No. ${item.number}` });
  const latest = num(item.detail.lastCaughtAt);
  if (stack && latest !== null && latest !== item.story.at) {
    const moment = formatMoment(latest);
    if (moment) out.push({ label: isFish(item.defId) ? 'Latest catch' : 'Latest found', value: moment });
  }
  const where = owner ? formatWhere(item) : '';
  if (where) out.push({ label: 'Where it is now', value: where });
  return out;
}

function historyList(events: readonly ItemEvent[], defId: string): HTMLElement {
  const list = el('ol', 'cdc-events');
  const shown: (ItemEvent | number)[] = events.length <= SHOWN_EVENTS ? [...events]
    : [events[0]!, events.length - SHOWN_EVENTS + 1, ...events.slice(-(SHOWN_EVENTS - 2))];
  for (const entry of shown) {
    const row = el('li', 'cdc-event');
    if (typeof entry === 'number') {
      row.classList.add('cdc-event-gap');
      row.append(el('span', 'cdc-event-words', entry === 1 ? 'One more moment along the way' : `${entry} more moments along the way`));
    } else {
      const when = formatMoment(entry.at);
      const time = el('time', 'cdc-event-when', when);
      if (Number.isFinite(entry.at)) time.dateTime = new Date(entry.at).toISOString();
      row.append(time, el('span', 'cdc-event-words', eventWords(entry, defId)));
    }
    list.append(row);
  }
  return list;
}

/**
 * The story card: a parchment tag with the real render of the thing, its name, its line of lore, where it came from,
 * the server's sentence, its facts, where it lives now and, when asked for, its dated history.
 */
export function mountItemCard(host: HTMLElement, item: ItemRecord, options: ItemCardOptions = {}): () => void {
  const title = titleOf(item.defId);
  const owner = !options.viewerPersonId || options.viewerPersonId === item.ownerId;
  const id = `cdc-${++cards}`;
  let disposed = false;

  const card = el('article', 'cdc cd-kit');
  card.setAttribute('aria-labelledby', `${id}-title`);
  card.dataset.storied = String(item.storied);
  card.append(svg('cdc-twine', '0 0 60 40', '<path d="M30 39c-1-9-9-12-13-19-4-8 2-15 9-17"/><path d="M30 39c1-8 6-13 12-18 6-6 4-14-2-17"/>'));
  const paper = el('div', 'cdc-paper');
  paper.style.clipPath = deckle(item.id);
  card.append(paper);
  paper.append(el('span', 'cdc-eyelet'));

  if (options.onClose) {
    const close = el('button', 'cdc-close cd-focus');
    close.type = 'button';
    close.setAttribute('aria-label', `Close the tag for ${title}`);
    close.append(svg('cdc-close-mark', '0 0 20 20', '<path d="M5.5 5.8c3 2.6 5.8 5.6 9 8.6M14.6 5.4c-3.1 3-5.8 6-9.1 9"/>'));
    close.addEventListener('click', () => { options.sound?.('parchment'); options.onClose?.(); });
    paper.append(close);
  }

  const head = el('header', 'cdc-head');
  const frame = el('div', 'cdc-frame');
  const canvas = el('canvas', 'cdc-portrait');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', title);
  frame.append(canvas);
  const titles = el('div', 'cdc-titles');
  titles.append(el('p', 'cdc-kind', kindLabel(item)));
  const heading = el('h2', 'cdc-title', title);
  heading.id = `${id}-title`;
  heading.tabIndex = -1;
  titles.append(heading);
  const tally = formatTally(item.count, isFish(item.defId));
  if (tally) titles.append(el('p', 'cdc-tally', tally));
  head.append(frame, titles);
  paper.append(head);

  paper.append(el('p', 'cdc-lore', loreOf(item.defId)));
  paper.append(svg('cdc-rule', '0 0 220 12', '<path d="M4 6h88M128 6h88"/><path d="M110 1.5l4.5 4.5-4.5 4.5-4.5-4.5z"/><circle cx="98" cy="6" r="1.3"/><circle cx="122" cy="6" r="1.3"/>'));
  const line = item.story.line?.trim();
  const origin = formatOrigin(item, options.viewerPersonId);
  // "Taken from the rod rack." and "Taken from the rack at…" say one thing; keep the fuller sentence.
  const opening = (text: string) => text.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
  if (line && !(origin && opening(line) === opening(origin))) paper.append(el('p', 'cdc-line', line));
  if (origin) paper.append(el('p', 'cdc-origin', origin));

  const list = facts(item, owner);
  if (list.length) {
    const dl = el('dl', 'cdc-facts');
    for (const fact of list) {
      const row = el('div', 'cdc-fact');
      row.append(el('dt', 'cdc-fact-label', fact.label), el('dd', 'cdc-fact-value', fact.value));
      dl.append(row);
    }
    paper.append(dl);
  }

  if (item.storied) {
    const kept = el('p', 'cdc-kept');
    kept.append(svg('cd-seal', '0 0 24 24', SEAL_MARKUP));
    const words = el('span', 'cdc-kept-words');
    words.append(el('span', 'cdc-kept-word', 'Kept for good'), el('span', 'cdc-kept-note', 'It can be put away, but never lost.'));
    kept.append(words);
    paper.append(kept);
  }

  if (options.history) {
    const section = el('section', 'cdc-history');
    section.dataset.history = 'loading';
    section.setAttribute('aria-labelledby', `${id}-history`);
    const label = el('h3', 'cdc-history-title', 'Its story so far');
    label.id = `${id}-history`;
    const note = el('p', 'cdc-history-note', 'Reading its story…');
    note.setAttribute('role', 'status');
    section.append(label, note);
    paper.append(section);
    options.history().then(events => {
      if (disposed) return;
      const ordered = [...events].filter(event => event && Number.isFinite(event.at)).sort((a, b) => a.at - b.at);
      if (!ordered.length) { section.remove(); return; }
      note.remove();
      section.append(historyList(ordered, item.defId));
      section.dataset.history = 'ready';
    }, () => {
      if (disposed) return;
      note.textContent = 'Its story could not be read just now.';
      section.dataset.history = 'failed';
    });
  }

  card.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !options.onClose) return;
    event.preventDefault(); event.stopPropagation();
    options.sound?.('parchment');
    options.onClose();
  });

  host.append(card);
  const size = options.portraitSize ?? (host.clientWidth > 0 && host.clientWidth < 380 ? 112 : 176);
  canvas.style.width = canvas.style.height = `${size}px`;
  frame.style.setProperty('--cdc-portrait', `${size}px`);
  void paintItemPortrait(canvas, item.defId, size).then(drawn => { if (!disposed) frame.dataset.portrait = drawn ? 'drawn' : 'empty'; });

  return () => {
    if (disposed) return;
    disposed = true;
    card.remove();
  };
}
