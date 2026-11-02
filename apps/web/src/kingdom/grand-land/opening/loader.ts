import './opening.css';
import type { OpeningJournal, OpeningState } from './journal';
import { createOpeningPainter } from './painter';
import { openingView, type OpeningBeat } from './view';

export interface OpeningLoaderOptions {
  /** `stream` keeps clear of an OBS layout and never shows controls; `page` is the kingdom, walk and grand view. */
  readonly variant?: 'page' | 'stream';
  /** Shown above the map until the journal knows the kingdom's name. */
  readonly name?: string;
  /** Called once the loader has dissolved into the drawn kingdom and removed itself. */
  readonly onGone?: () => void;
}
export interface OpeningLoader {
  readonly element: HTMLElement;
  /** Show this journal (a new attempt replaces the previous one; the parchment stays unrolled). */
  follow(journal: OpeningJournal): void;
  dispose(): void;
}

const LIT_HOLD_MS = 900, LEAVE_MS = 700;

/**
 * The opening loader: a parchment map of the kingdom that unrolls, inks the verified streets, draws the real
 * coast and high ground when the land's surface arrives, washes colour over each region as its mesh enters the
 * scene, and lights the window when the first frame is drawn, then dissolves into the kingdom. It is a plain DOM
 * module so any surface can mount it (the kingdom, the stream, the grand view, the entry gate, the Chronicle,
 * the panel); it reads only an opening journal.
 */
export function mountOpeningLoader(host: HTMLElement, options: OpeningLoaderOptions = {}): OpeningLoader {
  const root = document.createElement('div');
  root.className = `opening opening-${options.variant ?? 'page'}`;
  root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
  root.innerHTML = `<div class="opening-sheet"><div class="opening-paper" aria-hidden="true"></div>
    <header class="opening-cartouche"><p class="opening-eyebrow">The map of</p><h2 class="opening-name"></h2></header>
    <div class="opening-map"><canvas aria-hidden="true"></canvas><svg class="opening-compass" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13"/><path d="M20 3 23 20 20 37 17 20Z"/><path class="opening-north" d="M20 3 23 20H17Z"/><text x="20" y="2.6">N</text></svg></div>
    <footer class="opening-legend"><p class="opening-line"></p><p class="opening-detail"></p><div class="opening-rule" aria-hidden="true"><i></i></div></footer>
    <div class="opening-roll" aria-hidden="true"></div></div>`;
  host.append(root);
  const name = root.querySelector<HTMLElement>('.opening-name')!, line = root.querySelector<HTMLElement>('.opening-line')!;
  const detail = root.querySelector<HTMLElement>('.opening-detail')!, rule = root.querySelector<HTMLElement>('.opening-rule i')!;
  const map = root.querySelector<HTMLElement>('.opening-map')!, painter = createOpeningPainter(root.querySelector('canvas')!);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let journal: OpeningJournal | undefined, off: (() => void) | undefined, frame = 0, disposed = false, leaving: number | undefined;
  let lastBeat: OpeningBeat | undefined, lastText = '';
  name.textContent = options.name ?? '';
  function text(state: OpeningState) {
    const view = openingView(state);
    if (state.name) name.textContent = state.name;
    const key = `${view.line}|${view.detail}|${view.ink}`;
    if (key !== lastText) {
      lastText = key;
      if (view.beat !== lastBeat) { line.classList.remove('opening-new'); void line.offsetWidth; line.classList.add('opening-new'); lastBeat = view.beat; }
      line.textContent = view.line; detail.textContent = view.detail ?? '';
      rule.style.transform = `scaleX(${view.ink ?? 0})`;
      root.dataset.beat = view.beat; root.classList.toggle('opening-failed', !!state.failed);
    }
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || !journal) return;
    const state = journal.state, box = map.getBoundingClientRect();
    painter.draw(state, { width: box.width, height: box.height, dpr: Math.min(2, window.devicePixelRatio || 1), now, reduced });
    if (state.at.lit !== undefined && leaving === undefined) {
      leaving = window.setTimeout(() => {
        root.classList.add('opening-leaving');
        leaving = window.setTimeout(() => { dispose(); options.onGone?.(); }, reduced ? 0 : LEAVE_MS);
      }, reduced ? 0 : LIT_HOLD_MS);
    }
    frame = requestAnimationFrame(tick);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; off?.(); cancelAnimationFrame(frame); clearTimeout(leaving); painter.dispose(); root.remove();
  }
  return {
    element: root,
    follow(next) {
      if (disposed || next === journal) return;
      off?.(); journal = next; lastText = ''; lastBeat = undefined;
      if (leaving !== undefined) { clearTimeout(leaving); leaving = undefined; root.classList.remove('opening-leaving'); }
      next.step('gate');
      text(next.state);
      off = next.subscribe(text);
      if (!frame) frame = requestAnimationFrame(tick);
    },
    dispose,
  };
}
