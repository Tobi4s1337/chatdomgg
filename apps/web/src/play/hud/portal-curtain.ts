import '@chatdom/ui/kit.css';
import './portal.css';
import type { PortalCurtain } from '../portal';

/** Closing over the street, and stepping out into the lamplight beyond the door. Reduced motion only fades. */
export const CURTAIN_CLOSE_MS = 560, CURTAIN_OPEN_MS = 720, CURTAIN_FADE_MS = 160, CURTAIN_NOTE_MS = 3600;

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  parent?.append(element);
  return element;
}
function el<K extends keyof HTMLElementTagNameMap>(name: K, className: string, parent?: Element): HTMLElementTagNameMap[K] {
  const element = document.createElement(name);
  element.className = className;
  parent?.append(element);
  return element;
}

/** An arched oak door standing open onto lamplight, drawn in the kit's brass line. */
function doorway(parent: Element): SVGSVGElement {
  const root = svg('svg', { class: 'pl-portal-door', viewBox: '0 0 120 150', 'aria-hidden': 'true' }, parent);
  const defs = svg('defs', {}, root);
  const light = svg('radialGradient', { id: 'pl-portal-light', cx: '50%', cy: '62%', r: '62%' }, defs);
  svg('stop', { offset: '0', 'stop-color': '#ffe7b0' }, light);
  svg('stop', { offset: '.45', 'stop-color': '#f2b765' }, light);
  svg('stop', { offset: '1', 'stop-color': '#a8582a' }, light);
  // The lit opening, the threshold stone, the door leaf swung inward, its planks and ring, and the brass arch.
  svg('path', { class: 'pl-portal-opening', d: 'M24 142V62a36 36 0 0 1 72 0v80Z', fill: 'url(#pl-portal-light)' }, root);
  svg('path', { class: 'pl-portal-spill', d: 'M24 142h72l18 6H6Z' }, root);
  // The leaf is a whole door hinged on the left jamb; it swings in by foreshortening to a sliver.
  const leaf = svg('g', { class: 'pl-portal-leaf' }, root);
  svg('path', { class: 'pl-portal-leaf-wood', d: 'M24 142V62a36 36 0 0 1 72 0v80Z' }, leaf);
  svg('path', { class: 'pl-portal-plank', d: 'M42 31v111M60 26v116M78 31v111M24 78h72M24 120h72' }, leaf);
  svg('circle', { class: 'pl-portal-ring', cx: '86', cy: '96', r: '3.6' }, leaf);
  svg('path', { class: 'pl-portal-arch', d: 'M18 144V62a42 42 0 0 1 84 0v82' }, root);
  svg('path', { class: 'pl-portal-arch pl-portal-arch-inner', d: 'M24 142V62a36 36 0 0 1 72 0v80' }, root);
  svg('path', { class: 'pl-portal-keystone', d: 'M54 18.5h12l-2 9h-8Z' }, root);
  svg('path', { class: 'pl-portal-sill', d: 'M10 144h100' }, root);
  return root;
}

export interface PortalCurtainOptions {
  /** Where the layer lives; the page's body by default. It must outlive the scene it covers. */
  readonly parent?: HTMLElement;
  readonly reducedMotion?: () => boolean;
}

/**
 * The real curtain: a full-window layer with the destination's stage under it. It is created per journey and
 * removed when you are back outside, so nothing of it lingers over the street.
 */
export function createPortalCurtain(options: PortalCurtainOptions = {}): PortalCurtain {
  const parent = options.parent ?? document.body;
  const reduced = () => options.reducedMotion?.() ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = el('div', 'pl-portal cd-kit');
  root.dataset.state = 'open';
  const stage = el('div', 'pl-portal-stage', root);
  const curtain = el('div', 'pl-portal-curtain', root);
  curtain.setAttribute('role', 'status');
  curtain.setAttribute('aria-live', 'polite');
  el('div', 'pl-portal-glow', curtain);
  const card = el('div', 'pl-portal-card', curtain);
  doorway(card);
  const label = el('p', 'pl-portal-label', card);
  const title = el('h2', 'pl-portal-title', card);
  el('div', 'pl-portal-rule', card).setAttribute('aria-hidden', 'true');
  const words = el('p', 'pl-portal-words', card);
  const retry = el('button', 'pl-portal-retry', card);
  retry.type = 'button';
  retry.textContent = 'Try the door again';
  retry.hidden = true;
  words.hidden = true;
  const note = el('p', 'pl-portal-note', root);
  note.setAttribute('role', 'status');
  parent.append(root);
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, noteTimer: ReturnType<typeof setTimeout> | undefined;
  let onRetry: (() => void) | null = null;
  retry.addEventListener('click', () => { const run = onRetry; if (!run) return; onRetry = null; retry.hidden = true; words.hidden = true; run(); });

  const after = (ms: number) => new Promise<void>(resolve => { clearTimeout(timer); timer = setTimeout(resolve, ms); });
  const motion = () => { root.dataset.reduced = String(reduced()); return reduced(); };

  return {
    stage,
    async close(next) {
      if (disposed) return;
      label.textContent = next.label;
      title.textContent = next.title;
      retry.hidden = true; words.hidden = true; onRetry = null;
      note.dataset.shown = 'false';
      const still = motion();
      root.dataset.state = 'closing';
      // Let the open state paint once so the swing has somewhere to start from.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (disposed) return;
      root.dataset.state = 'closed';
      await after(still ? CURTAIN_FADE_MS : CURTAIN_CLOSE_MS);
    },
    async open(text) {
      if (disposed) return;
      // A step that came good on its own while stranded leaves no retry behind on the way out.
      retry.hidden = true; words.hidden = true; onRetry = null;
      const still = motion();
      root.dataset.state = 'opening';
      if (text) {
        note.textContent = text;
        note.dataset.shown = 'true';
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => { note.dataset.shown = 'false'; }, CURTAIN_NOTE_MS);
      }
      await after(still ? CURTAIN_FADE_MS : CURTAIN_OPEN_MS);
      if (disposed) return;
      root.dataset.state = 'open';
    },
    stranded(run) {
      if (disposed) return;
      root.dataset.state = 'closed';
      label.textContent = 'Between two rooms';
      title.textContent = 'The way back is not open yet';
      words.textContent = 'Your place in the kingdom is kept. The door usually opens again in a moment.';
      words.hidden = false;
      retry.hidden = false;
      onRetry = run;
      retry.focus({ preventScroll: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      // A note on the opened street fades out on its own; the layer itself goes once it has.
      const lingering = note.dataset.shown === 'true';
      curtain.remove(); stage.remove();
      if (lingering) setTimeout(() => root.remove(), CURTAIN_NOTE_MS); else root.remove();
    },
  };
}
