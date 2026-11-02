/** The surface a control is made of; the kingdom's audio plays its matching knock, ring or rustle. */
export type BagSurface = 'wood' | 'brass' | 'parchment';
export type BagSound = (surface: BagSurface) => void;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
export function svg(className: string, viewBox: string, body: string): SVGSVGElement {
  const node = document.createElementNS(SVG, 'svg');
  node.setAttribute('class', className);
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  // Static, authored markup only: never interpolate a person's words here.
  node.innerHTML = body;
  return node;
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A pressed wax seal: an uneven disc, a rim from the matrix and an embossed star. */
export const SEAL_MARKUP = '<path class="cd-seal-wax" d="M12 1.6c1.6.2 2.5 1.2 4 1.3 1.4.5 1.8 2 3 2.9 1 1 .8 2.5 1.6 3.7.5 1.4-.4 2.6-.3 4 .2 1.5-1 2.4-1.6 3.6-.6 1.3-2 1.6-3 2.6-1.1.8-2.6.5-3.8 1.1-1.4.3-2.6-.6-4-.6-1.4-.3-2.1-1.6-3.2-2.4-1.2-.8-1.3-2.3-2-3.5-.5-1.3.3-2.6.1-4-.1-1.4 1-2.3 1.6-3.5.6-1.3 2-1.6 3.1-2.6 1.1-.8 2.6-.4 3.8-1z"/><circle class="cd-seal-rim" cx="12" cy="12" r="6.6"/><path class="cd-seal-glyph" d="M12 7.6l1.2 2.7 2.9.3-2.2 1.9.7 2.9L12 13.9l-2.6 1.5.7-2.9-2.2-1.9 2.9-.3z"/>';
