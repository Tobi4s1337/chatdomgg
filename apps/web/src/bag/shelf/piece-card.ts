import type { ShelfPiece } from '@chatdom/shared';
import '../bag.css';
import { fishOfMount } from '../../../../../packages/content/src/keepsakes/mount';
import { el, SEAL_MARKUP, svg, type BagSound } from '../dom';
import { loreOf, titleOf } from '../kinds';
import { paintItemPortrait } from '../portrait';
import { formatDay, formatLength, formatWeight } from '../words';

export interface PieceCardOptions {
  readonly onClose?: () => void;
  readonly sound?: BagSound;
  readonly portraitSize?: number;
}

let cards = 0;

const num = (value: string | number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : null;

/** The same hand-torn edge as the bag's tags, seeded by the piece so it never changes between visits. */
function deckle(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const j = () => (rand() * 1.8).toFixed(2);
  const cut = 22, steps = 14, points: string[] = [`${j()}px ${cut}px`, `${cut}px ${j()}px`];
  for (let i = 1; i < steps; i++) points.push(`calc(${cut}px + (100% - ${cut * 2}px) * ${(i / steps).toFixed(3)}) ${j()}px`);
  points.push(`calc(100% - ${cut}px) ${j()}px`, `calc(100% - ${j()}px) ${cut}px`);
  for (let i = 1; i < steps; i++) points.push(`calc(100% - ${j()}px) calc(${cut}px + (100% - ${cut}px) * ${(i / steps).toFixed(3)})`);
  points.push(`calc(100% - ${j()}px) calc(100% - ${j()}px)`);
  for (let i = steps - 1; i > 0; i--) points.push(`calc(100% * ${(i / steps).toFixed(3)}) calc(100% - ${j()}px)`);
  points.push(`${j()}px calc(100% - ${j()}px)`);
  for (let i = steps - 1; i > 0; i--) points.push(`${j()}px calc(${cut}px + (100% - ${cut}px) * ${(i / steps).toFixed(3)})`);
  return `polygon(${points.join(', ')})`;
}

/** "Caught by Juniper at Willowmere pier on 2 November." for a catch; "Brought home from the tavern on 2 November." else. */
export function pieceOrigin(piece: Pick<ShelfPiece, 'defId' | 'story'>): string {
  const { name, where, at } = piece.story;
  const day = formatDay(at), on = day ? ` on ${day}` : '';
  const place = where?.trim();
  if (!place) return '';
  const who = name?.trim();
  if (fishOfMount(piece.defId)) return `Caught${who ? ` by ${who}` : ''} at ${place}${on}.`;
  return who ? `${who} brought it home from ${place}${on}.` : `Brought home from ${place}${on}.`;
}

export function pieceFacts(piece: Pick<ShelfPiece, 'number' | 'detail'>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const weight = formatWeight(num(piece.detail.weightG) ?? NaN);
  if (weight) out.push({ label: 'Weight', value: weight });
  const length = formatLength(num(piece.detail.lengthMm) ?? NaN);
  if (length) out.push({ label: 'Length', value: length });
  if (piece.number !== null && Number.isInteger(piece.number) && piece.number > 0) out.push({ label: 'Keepsake', value: `No. ${piece.number}` });
  return out;
}

/**
 * A visitor's tag for a keepsake on someone's shelf: the same parchment as the bag's story tag, read-only, with the
 * real render of the thing, its name and lore, the story's sentence and its facts. Never an owner's id.
 */
export function mountPieceCard(host: HTMLElement, piece: ShelfPiece, options: PieceCardOptions = {}): () => void {
  const title = titleOf(piece.defId);
  const id = `cdsp-${++cards}`;
  let disposed = false;

  const card = el('article', 'cdc cd-kit');
  card.setAttribute('aria-labelledby', `${id}-title`);
  card.dataset.storied = 'true';
  card.append(svg('cdc-twine', '0 0 60 40', '<path d="M30 39c-1-9-9-12-13-19-4-8 2-15 9-17"/><path d="M30 39c1-8 6-13 12-18 6-6 4-14-2-17"/>'));
  const paper = el('div', 'cdc-paper');
  paper.style.clipPath = deckle(piece.id);
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
  titles.append(el('p', 'cdc-kind', 'Keepsake'));
  const heading = el('h2', 'cdc-title', title);
  heading.id = `${id}-title`;
  heading.tabIndex = -1;
  titles.append(heading);
  head.append(frame, titles);
  paper.append(head);

  paper.append(el('p', 'cdc-lore', loreOf(piece.defId)));
  paper.append(svg('cdc-rule', '0 0 220 12', '<path d="M4 6h88M128 6h88"/><path d="M110 1.5l4.5 4.5-4.5 4.5-4.5-4.5z"/><circle cx="98" cy="6" r="1.3"/><circle cx="122" cy="6" r="1.3"/>'));
  const line = piece.story.line?.trim();
  const origin = pieceOrigin(piece);
  const opening = (text: string) => text.toLowerCase().split(/\s+/).slice(0, 2).join(' ');
  if (line && !(origin && opening(line) === opening(origin))) paper.append(el('p', 'cdc-line', line));
  if (origin) paper.append(el('p', 'cdc-origin', origin));

  const list = pieceFacts(piece);
  if (list.length) {
    const dl = el('dl', 'cdc-facts');
    for (const fact of list) {
      const row = el('div', 'cdc-fact');
      row.append(el('dt', 'cdc-fact-label', fact.label), el('dd', 'cdc-fact-value', fact.value));
      dl.append(row);
    }
    paper.append(dl);
  }

  const kept = el('p', 'cdc-kept');
  kept.append(svg('cd-seal', '0 0 24 24', SEAL_MARKUP));
  const words = el('span', 'cdc-kept-words');
  words.append(el('span', 'cdc-kept-word', 'Kept for good'), el('span', 'cdc-kept-note', 'Set out on this shelf for visitors to see.'));
  kept.append(words);
  paper.append(kept);

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
  void paintItemPortrait(canvas, piece.defId, size).then(drawn => { if (!disposed) frame.dataset.portrait = drawn ? 'drawn' : 'empty'; });

  return () => {
    if (disposed) return;
    disposed = true;
    card.remove();
  };
}
